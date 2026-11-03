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
import type { Database } from "@grids/database";
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
  async function currentUser(req: Request) {
    const token = cookie(req, sessionCookie);
    if (!token) return null;
    const result = await db.query(
      `SELECT u.id, u.name, u.provider FROM users u JOIN sessions s ON s.user_id = u.id
       WHERE s.token_hash = $1 AND s.expires_at > now()`, [hash(token)],
    );
    return result.rows[0] ? userSchema.parse(result.rows[0]) : null;
  }
  async function requireUser(req: Request) {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "Sign in to save or manage your grids and presets.");
    return user;
  }
  const providers = authProviderSchema.options.filter((provider) => config.credentials[provider].id);
  app.get("/api/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ ok: true });
  });
  app.get("/api/session", async (req, res) => {
    res.json({ user: await currentUser(req), providers });
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
  app.get("/api/auth/:provider/callback", async (req, res) => {
    const fail = () => {
      const url = new URL(config.webUrl);
      url.searchParams.set("auth", "failed");
      res.redirect(url.href);
    };
    const provider = authProviderSchema.safeParse(req.params.provider);
    const state = tokenSchema.safeParse(req.query.state);
    const browser = cookie(req, stateCookie);
    setCookie(res, stateCookie, "", 0, "/api/auth");
    if (!provider.success || !providers.includes(provider.data) || !state.success || !browser) return fail();
    const taken = await db.query(
      `DELETE FROM oauth_states WHERE state_hash = $1 AND browser_hash = $2
       AND provider = $3 AND expires_at > now() RETURNING verifier`,
      [hash(state.data), hash(browser), provider.data],
    );
    const code = z.string().min(1).max(4096).safeParse(req.query.code);
    if (!taken.rows[0] || !code.success || req.query.error) return fail();
    let profile: Profile;
    try {
      profile = await resolveProfile(provider.data, code.data, taken.rows[0].verifier);
    } catch {
      console.error("Provider sign-in failed.", { provider: provider.data });
      return fail();
    }
    const user = await db.query(
      `INSERT INTO users(id, provider, subject, name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, subject) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [randomUUID(), provider.data, profile.subject, profile.name],
    );
    const token = randomToken();
    const previous = cookie(req, sessionCookie);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      if (previous) await client.query("DELETE FROM sessions WHERE token_hash = $1", [hash(previous)]);
      await client.query(
        "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
        [hash(token), user.rows[0].id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    setCookie(res, sessionCookie, token, 30 * day);
    res.redirect(config.webUrl);
  });
  app.post("/api/logout", async (req, res) => {
    const token = cookie(req, sessionCookie);
    if (token) await db.query("DELETE FROM sessions WHERE token_hash = $1", [hash(token)]);
    setCookie(res, sessionCookie, "", 0);
    res.sendStatus(204);
  });
  app.delete("/api/account", async (req, res) => {
    const user = await requireUser(req);
    await db.query("DELETE FROM users WHERE id = $1", [user.id]);
    setCookie(res, sessionCookie, "", 0);
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
