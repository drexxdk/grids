import { randomUUID, timingSafeEqual } from "node:crypto";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { parse, serialize } from "cookie";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  authProviderSchema,
  gridWriteSchema,
  presetWriteSchema,
  userSchema,
  type AuthProvider,
} from "@grids/contracts/cloud";
import type { Database, PoolClient } from "@grids/database";
import type { Config } from "./config.js";
import { authorizationUrl, exchangeCode, hash, randomToken, type Profile } from "./oauth.js";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const idSchema = z.uuid();
const day = 86400;

export function createApp(
  config: Config,
  db: Database,
  resolveProfile: (provider: AuthProvider, code: string, verifier: string) => Promise<Profile> =
    (provider, code, verifier) => exchangeCode(config, provider, code, verifier),
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);
  app.use(helmet({ referrerPolicy: { policy: "no-referrer" } }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, _res, next) => {
    if (!config.proxySecret || (req.path === "/health" && ["GET", "HEAD"].includes(req.method))) return next();
    const supplied = req.get("X-Grids-Proxy-Secret");
    if (!supplied || !timingSafeEqual(
      Buffer.from(hash(supplied), "hex"),
      Buffer.from(hash(config.proxySecret), "hex"),
    )) return next(new HttpError(403, "Access through the Gridz website is required."));
    next();
  });
  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (origin && origin !== config.webOrigin) return next(new HttpError(403, "Origin not allowed."));
    if (origin) {
      res.set("Access-Control-Allow-Origin", config.webOrigin);
      res.set("Access-Control-Allow-Credentials", "true");
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
      res.set("Access-Control-Allow-Headers", "Content-Type, X-Grids-Request, If-Match");
      return res.sendStatus(204);
    }
    if (!["GET", "HEAD"].includes(req.method) &&
      (origin !== config.webOrigin || req.get("X-Grids-Request") !== "1" ||
        (["POST", "PUT"].includes(req.method) && !req.is("application/json")))) {
      return next(new HttpError(403, "Invalid request origin or headers."));
    }
    next();
  });
  app.use("/api", rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again in a minute." },
  }));
  app.use(express.json({ limit: "1mb", strict: true }));

  const sessionCookie = config.secure ? "__Secure-grids-session" : "grids-session";
  const stateCookie = config.secure ? "__Secure-grids-oauth" : "grids-oauth";
  function setCookie(res: Response, name: string, value: string, maxAge: number, path = "/api") {
    res.append("Set-Cookie", serialize(name, value, {
      httpOnly: true, secure: config.secure, sameSite: "lax", path, maxAge,
    }));
  }
  function cookie(req: Request, name: string) {
    const value = parse(req.headers.cookie || "")[name];
    return tokenSchema.safeParse(value).success ? value! : null;
  }
  async function currentUser(req: Request, executor: Pick<Database, "query"> = db) {
    const token = cookie(req, sessionCookie);
    if (!token) return null;
    const result = await executor.query(
      `SELECT u.id, u.name, s.provider FROM users u JOIN sessions s ON s.user_id = u.id
       JOIN account_identities i ON i.user_id = u.id AND i.provider = s.provider
       WHERE s.token_hash = $1 AND s.expires_at > now()`, [hash(token)],
    );
    return result.rows[0] ? userSchema.parse(result.rows[0]) : null;
  }
  async function requireUser(req: Request, executor: Pick<Database, "query"> = db) {
    const user = await currentUser(req, executor);
    if (!user) throw new HttpError(401, "Sign in to save or manage your grids and presets.");
    return user;
  }
  const providers = authProviderSchema.options.filter((provider) => config.credentials[provider].id);
  async function accountChange<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Serialize identity changes, including first sign-in, across API processes.
      await client.query("SELECT pg_advisory_xact_lock(78421964)");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  function returnToAccount(res: Response, status?: string) {
    const url = new URL(config.webUrl);
    if (status) url.searchParams.set("auth", status);
    res.redirect(url.href);
  }
  async function checkMergeProviders(client: PoolClient, targetId: string, sourceId: string) {
    const overlap = await client.query(
      `SELECT 1 FROM account_identities a JOIN account_identities b ON a.provider = b.provider
       WHERE a.user_id = $1 AND b.user_id = $2`, [targetId, sourceId],
    );
    if (overlap.rowCount) throw new HttpError(409, "Both accounts have an identity from the same provider. Disconnect the conflicting provider before merging.");
  }
  app.get("/api/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ ok: true });
  });
  app.get("/api/session", async (req, res) => {
    const user = await currentUser(req);
    const connections = user ? (await db.query(
      "SELECT provider, name FROM account_identities WHERE user_id = $1 ORDER BY provider", [user.id],
    )).rows : [];
    const pending = user ? (await db.query(
      `SELECT m.id, m.provider, i.name,
       ARRAY(SELECT provider FROM account_identities WHERE user_id = m.source_user_id ORDER BY provider) AS providers,
       (SELECT count(*)::int FROM grids WHERE user_id = m.source_user_id) AS grids,
       (SELECT count(*)::int FROM presets WHERE user_id = m.source_user_id) AS presets
       FROM account_merges m JOIN account_identities i
       ON i.provider = m.provider AND i.subject = m.subject AND i.user_id = m.source_user_id
       WHERE m.session_hash = $1 AND m.expires_at > now()`,
      [hash(cookie(req, sessionCookie)!)],
    )).rows[0] ?? null : null;
    res.json({ user, providers, connections, pendingMerge: pending });
  });
  app.use("/api/auth", rateLimit({
    windowMs: 60000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again in a minute." },
  }));
  app.get("/api/auth/:provider/start", async (req, res) => {
    const provider = authProviderSchema.parse(req.params.provider);
    if (!providers.includes(provider)) throw new HttpError(404, "This sign-in provider is not configured.");
    const state = randomToken();
    const browser = randomToken();
    const verifier = randomToken();
    await db.query(
      `INSERT INTO oauth_states(state_hash, browser_hash, provider, verifier, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
      [hash(state), hash(browser), provider, verifier],
    );
    setCookie(res, stateCookie, browser, 600, "/api/auth");
    res.redirect(authorizationUrl(config, provider, state, verifier));
  });
  app.post("/api/auth/:provider/link", async (req, res) => {
    const provider = authProviderSchema.parse(req.params.provider);
    z.strictObject({}).parse(req.body);
    if (!providers.includes(provider)) throw new HttpError(404, "This sign-in provider is not configured.");
    const state = randomToken();
    const browser = randomToken();
    const verifier = randomToken();
    await accountChange(async (client) => {
      const user = await requireUser(req, client);
      const existing = await client.query(
        "SELECT 1 FROM account_identities WHERE user_id = $1 AND provider = $2", [user.id, provider],
      );
      if (existing.rowCount) throw new HttpError(409, "This provider is already connected. Disconnect it before connecting another identity from the same provider.");
      const sessionHash = hash(cookie(req, sessionCookie)!);
      await client.query("DELETE FROM account_merges WHERE session_hash = $1", [sessionHash]);
      await client.query(
        `INSERT INTO oauth_states(state_hash, browser_hash, provider, verifier, expires_at, link_session_hash)
         VALUES ($1, $2, $3, $4, now() + interval '10 minutes', $5)`,
        [hash(state), hash(browser), provider, verifier, sessionHash],
      );
    });
    setCookie(res, stateCookie, browser, 600, "/api/auth");
    res.json({ url: authorizationUrl(config, provider, state, verifier, true) });
  });
  app.get("/api/auth/:provider/callback", async (req, res) => {
    const fail = () => returnToAccount(res, "failed");
    const provider = authProviderSchema.safeParse(req.params.provider);
    const state = tokenSchema.safeParse(req.query.state);
    const browser = cookie(req, stateCookie);
    setCookie(res, stateCookie, "", 0, "/api/auth");
    if (!provider.success || !providers.includes(provider.data) || !state.success || !browser) return fail();
    const taken = await db.query(
      `DELETE FROM oauth_states WHERE state_hash = $1 AND browser_hash = $2
       AND provider = $3 AND expires_at > now() RETURNING verifier, link_session_hash`,
      [hash(state.data), hash(browser), provider.data],
    );
    const code = z.string().min(1).max(4096).safeParse(req.query.code);
    if (!taken.rows[0] || !code.success || req.query.error) return fail();
    const linkSession: string | null = taken.rows[0].link_session_hash;
    if (linkSession && (!cookie(req, sessionCookie) || hash(cookie(req, sessionCookie)!) !== linkSession)) return fail();
    let profile: Profile;
    try {
      profile = await resolveProfile(provider.data, code.data, taken.rows[0].verifier);
    } catch {
      console.error("Provider sign-in failed.", { provider: provider.data });
      return fail();
    }
    if (linkSession) {
      try {
        const status = await accountChange(async (client) => {
          const user = await requireUser(req, client);
          const connected = await client.query(
            "SELECT subject FROM account_identities WHERE user_id = $1 AND provider = $2", [user.id, provider.data],
          );
          if (connected.rowCount && connected.rows[0].subject !== profile.subject) {
            throw new HttpError(409, "A different identity from this provider is already connected.");
          }
          const identity = await client.query(
            "SELECT user_id FROM account_identities WHERE provider = $1 AND subject = $2", [provider.data, profile.subject],
          );
          const sourceId: string | undefined = identity.rows[0]?.user_id;
          if (sourceId && sourceId !== user.id) {
            await checkMergeProviders(client, user.id, sourceId);
            await client.query(
              `INSERT INTO account_merges(id, session_hash, source_user_id, provider, subject, expires_at)
               VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')
               ON CONFLICT (session_hash) DO UPDATE SET id = EXCLUDED.id, source_user_id = EXCLUDED.source_user_id,
               provider = EXCLUDED.provider, subject = EXCLUDED.subject, expires_at = EXCLUDED.expires_at`,
              [randomUUID(), linkSession, sourceId, provider.data, profile.subject],
            );
            return "merge";
          }
          await client.query(
            `INSERT INTO account_identities(provider, subject, user_id, name) VALUES ($1, $2, $3, $4)
             ON CONFLICT (provider, subject) DO UPDATE SET name = EXCLUDED.name`,
            [provider.data, profile.subject, user.id, profile.name],
          );
          return "linked";
        });
        return returnToAccount(res, status);
      } catch (error) {
        if (error instanceof HttpError) return returnToAccount(res, error.status === 409 ? "link-conflict" : "failed");
        throw error;
      }
    }
    const token = randomToken();
    const previous = cookie(req, sessionCookie);
    await accountChange(async (client) => {
      const identity = await client.query(
        "SELECT user_id FROM account_identities WHERE provider = $1 AND subject = $2", [provider.data, profile.subject],
      );
      const userId: string = identity.rows[0]?.user_id ?? randomUUID();
      if (!identity.rowCount) {
        await client.query("INSERT INTO users(id, name) VALUES ($1, $2)", [userId, profile.name]);
        await client.query(
          "INSERT INTO account_identities(provider, subject, user_id, name) VALUES ($1, $2, $3, $4)",
          [provider.data, profile.subject, userId, profile.name],
        );
      } else {
        await client.query(
          "UPDATE account_identities SET name = $3 WHERE provider = $1 AND subject = $2",
          [provider.data, profile.subject, profile.name],
        );
      }
      if (previous) await client.query("DELETE FROM sessions WHERE token_hash = $1", [hash(previous)]);
      await client.query(
        "INSERT INTO sessions(token_hash, user_id, provider, expires_at) VALUES ($1, $2, $3, now() + interval '30 days')",
        [hash(token), userId, provider.data],
      );
    });
    setCookie(res, sessionCookie, token, 30 * day);
    res.redirect(config.webUrl);
  });
  app.post("/api/logout", async (req, res) => {
    const token = cookie(req, sessionCookie);
    if (token) await accountChange(async (client) => {
      await client.query("DELETE FROM sessions WHERE token_hash = $1", [hash(token)]);
    });
    setCookie(res, sessionCookie, "", 0);
    res.sendStatus(204);
  });
  app.delete("/api/account", async (req, res) => {
    await accountChange(async (client) => {
      const user = await requireUser(req, client);
      await client.query("DELETE FROM users WHERE id = $1", [user.id]);
    });
    setCookie(res, sessionCookie, "", 0);
    res.sendStatus(204);
  });
  app.delete("/api/account/providers/:provider", async (req, res) => {
    const provider = authProviderSchema.parse(req.params.provider);
    await accountChange(async (client) => {
      const user = await requireUser(req, client);
      const remaining = await client.query(
        "SELECT provider FROM account_identities WHERE user_id = $1 AND provider <> $2", [user.id, provider],
      );
      const replacement = remaining.rows.find((row) => providers.includes(row.provider));
      if (!replacement) {
        throw new HttpError(409, "Keep at least one configured sign-in provider connected.");
      }
      const removed = await client.query(
        "DELETE FROM account_identities WHERE user_id = $1 AND provider = $2", [user.id, provider],
      );
      if (!removed.rowCount) throw new HttpError(404, "Connected provider not found.");
      if (user.provider === provider) {
        await client.query(
          "UPDATE sessions SET provider = $1 WHERE token_hash = $2 AND user_id = $3",
          [replacement.provider, hash(cookie(req, sessionCookie)!), user.id],
        );
      }
      await client.query("DELETE FROM sessions WHERE user_id = $1 AND provider = $2", [user.id, provider]);
    });
    res.sendStatus(204);
  });
  app.post("/api/account/merge", async (req, res) => {
    const { id } = z.strictObject({ id: idSchema }).parse(req.body);
    await accountChange(async (client) => {
      const user = await requireUser(req, client);
      const pending = await client.query(
        `SELECT m.source_user_id FROM account_merges m JOIN account_identities i
         ON i.provider = m.provider AND i.subject = m.subject AND i.user_id = m.source_user_id
         WHERE m.id = $1 AND m.session_hash = $2 AND m.expires_at > now()`,
        [id, hash(cookie(req, sessionCookie)!)],
      );
      const sourceId: string | undefined = pending.rows[0]?.source_user_id;
      if (!sourceId || sourceId === user.id) throw new HttpError(409, "Merge expired or changed. Connect the provider again.");
      await checkMergeProviders(client, user.id, sourceId);
      await client.query("UPDATE grids SET user_id = $1 WHERE user_id = $2", [user.id, sourceId]);
      await client.query("UPDATE presets SET user_id = $1 WHERE user_id = $2", [user.id, sourceId]);
      await client.query("DELETE FROM sessions WHERE user_id = $1", [sourceId]);
      await client.query("UPDATE account_identities SET user_id = $1 WHERE user_id = $2", [user.id, sourceId]);
      await client.query("DELETE FROM users WHERE id = $1", [sourceId]);
    });
    res.sendStatus(204);
  });
  app.delete("/api/account/merge/:id", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await requireUser(req);
    await db.query("DELETE FROM account_merges WHERE id = $1 AND session_hash = $2", [id, hash(cookie(req, sessionCookie)!)]);
    res.sendStatus(204);
  });

  for (const kind of ["grids", "presets"] as const) {
    const preset = kind === "presets";
    const dataColumn = preset ? "settings" : "document";
    function summary(row: Record<string, unknown>, userId?: string) {
      return {
        id: row.id,
        name: row.name,
        updatedAt: (row.updated_at as Date).toISOString(),
        ...(preset ? { public: row.public, owned: row.user_id === userId } : {}),
      };
    }
    app.get(`/api/${kind}`, async (req, res) => {
      const user = preset ? await currentUser(req) : await requireUser(req);
      const page = z.coerce.number().int().min(0).max(10000).parse(req.query.page ?? 0);
      const publicOnly = preset && req.query.scope === "public";
      if (!user && !publicOnly) throw new HttpError(401, "Sign in to view your presets.");
      const result = await db.query(
        `SELECT id, name, updated_at, user_id${preset ? ", public" : ""} FROM ${kind}
         WHERE ${publicOnly ? "public = true" : "user_id = $1"}
         ORDER BY updated_at DESC, id LIMIT 51 OFFSET ${page * 50}`,
        publicOnly ? [] : [user!.id],
      );
      res.json({
        items: result.rows.slice(0, 50).map((row) => summary(row, user?.id)),
        nextPage: result.rows.length > 50 ? page + 1 : null,
      });
    });
    app.get(`/api/${kind}/:id`, async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const user = preset ? await currentUser(req) : await requireUser(req);
      const result = await db.query(
        `SELECT * FROM ${kind} WHERE id = $1 AND (user_id = $2${preset ? " OR public = true" : ""})`,
        [id, user?.id ?? null],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError(404, "Saved item not found.");
      res.json({ ...summary(row, user?.id), [dataColumn]: row[dataColumn] });
    });
    app.post(`/api/${kind}`, async (req, res) => {
      const user = await requireUser(req);
      const input = preset ? presetWriteSchema.parse(req.body) : gridWriteSchema.parse(req.body);
      const data = "settings" in input ? input.settings : input.document;
      const result = await db.query(
        `INSERT INTO ${kind}(id, user_id, name, ${dataColumn}${preset ? ", public" : ""})
         VALUES ($1, $2, $3, $4${preset ? ", $5" : ""}) RETURNING *`,
        [randomUUID(), user.id, input.name, JSON.stringify(data), ...("public" in input ? [input.public] : [])],
      );
      const row = result.rows[0];
      res.status(201).json({ ...summary(row, user.id), [dataColumn]: row[dataColumn] });
    });
    app.put(`/api/${kind}/:id`, async (req, res) => {
      const user = await requireUser(req);
      const id = idSchema.parse(req.params.id);
      const version = z.iso.datetime().parse(req.get("If-Match"));
      const input = preset ? presetWriteSchema.parse(req.body) : gridWriteSchema.parse(req.body);
      const data = "settings" in input ? input.settings : input.document;
      const result = await db.query(
        `UPDATE ${kind} SET name = $3, ${dataColumn} = $4, updated_at = clock_timestamp()
         ${preset ? ", public = $6" : ""} WHERE id = $1 AND user_id = $2
         AND date_trunc('milliseconds', updated_at) = $5::timestamptz RETURNING *`,
        [id, user.id, input.name, JSON.stringify(data), version, ...("public" in input ? [input.public] : [])],
      );
      if (!result.rows[0]) throw new HttpError(409, "Item changed or is unavailable. Refresh before replacing it.");
      const row = result.rows[0];
      res.json({ ...summary(row, user.id), [dataColumn]: row[dataColumn] });
    });
    app.delete(`/api/${kind}/:id`, async (req, res) => {
      const user = await requireUser(req);
      const id = idSchema.parse(req.params.id);
      const deleted = await db.query(`DELETE FROM ${kind} WHERE id = $1 AND user_id = $2`, [id, user.id]);
      if (!deleted.rowCount) throw new HttpError(404, "Saved item not found.");
      res.sendStatus(204);
    });
  }
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "API route not found.")));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request data." });
    } else if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "Invalid JSON." });
    } else if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
      res.status(413).json({ error: "Saved grid exceeds the 1 MB limit." });
    } else {
      console.error("API request failed.", { type: error instanceof Error ? error.name : "Unknown" });
      res.status(500).json({ error: "The service could not complete this request. Try again." });
    }
  };
  app.use(errors);
  return app;
}
