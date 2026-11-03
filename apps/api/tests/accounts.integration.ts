import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createPool, migrate } from "@grids/database";
import { makeWorkspace, getEditorSettings } from "@grids/contracts/model";
import { toSavedGrid } from "@grids/contracts/cloud";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for database integration tests.");
const admin = createPool(process.env.DATABASE_URL);
const schema = `test_${randomUUID().replaceAll("-", "")}`;
const connection = new URL(process.env.DATABASE_URL);
connection.searchParams.set("options", `-c search_path=${schema}`);
const db = createPool(connection.href);
const config = readConfig({
  DATABASE_URL: connection.href,
  GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test",
  DISCORD_CLIENT_ID: "test", DISCORD_CLIENT_SECRET: "test",
  FACEBOOK_APP_ID: "test", FACEBOOK_APP_SECRET: "test",
});
let server: Server;
let origin: string;
let alice: string;
let bob: string;
function request(path: string, options: { method?: string; cookie?: string; body?: unknown; origin?: string; version?: string } = {}) {
  return fetch(`${origin}/api${path}`, {
    redirect: "manual",
    method: options.method ?? "GET",
    headers: {
      Origin: options.origin ?? config.webOrigin,
      "X-Grids-Request": "1",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.version ? { "If-Match": options.version } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}
async function login(subject: string, provider = "google", previous?: string) {
  const start = await request(`/auth/${provider}/start`, { cookie: previous });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  const callback = await request(`/auth/${provider}/callback?state=${state}&code=${subject}`, {
    cookie: `${cookie}${previous ? `; ${previous}` : ""}`,
  });
  assert.equal(callback.headers.get("location"), config.webUrl);
  const session = callback.headers.getSetCookie().find((value) => value.startsWith("grids-session="));
  assert.ok(session?.includes("HttpOnly"));
  assert.ok(session?.includes("SameSite=Lax"));
  return session!.split(";")[0];
}
const session = async (cookie: string) => request("/session", { cookie }).then((response) => response.json());
async function beginLink(cookie: string, provider: string) {
  const start = await request(`/auth/${provider}/link`, { method: "POST", cookie, body: {} });
  assert.equal(start.status, 200);
  const url = new URL((await start.json()).url);
  assert.equal(url.searchParams.get("scope"), provider === "discord" ? "identify" : provider === "google" ? "openid profile" : "public_profile");
  return {
    state: url.searchParams.get("state"),
    browser: start.headers.get("set-cookie")!.split(";")[0],
  };
}
async function link(cookie: string, provider: string, subject: string) {
  const { state, browser } = await beginLink(cookie, provider);
  return request(`/auth/${provider}/callback?state=${state}&code=${subject}`, { cookie: `${browser}; ${cookie}` });
}
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
  await migrate(db);
  await startServer();
  alice = await login("alice");
  bob = await login("bob");
});
async function startServer() {
  server = createApp(config, db, async (_provider, code) => ({ subject: code, name: code })).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server has no TCP address.");
  origin = `http://127.0.0.1:${address.port}`;
}
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await startServer();
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test("guest editing needs no account; account writes enforce sessions, origins and strict references", async () => {
  assert.equal((await request("/health")).status, 200);
  assert.equal((await request("/session")).status, 200);
  assert.equal((await request("/grids")).status, 401);
  const body = { name: "Grid", document: toSavedGrid(makeWorkspace()) };
  assert.equal((await request("/grids", { method: "POST", body })).status, 401);
  assert.equal((await request("/grids", { method: "POST", body, cookie: alice, origin: "https://evil.example" })).status, 403);
  assert.equal((await request("/grids", { method: "POST", body: { ...body, file: "binary" }, cookie: alice })).status, 400);
  const missingCsrf = await fetch(`${origin}/api/grids`, {
    method: "POST", headers: { Cookie: alice, "Content-Type": "application/json", Origin: config.webOrigin },
    body: JSON.stringify(body),
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal((await request("/auth/password/start")).status, 400);
});

test("the production proxy boundary rejects direct requests and accepts only the shared secret", async () => {
  const secret = "a".repeat(64);
  const guarded = createApp({ ...config, proxySecret: secret }, db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => guarded.once("listening", resolve));
  try {
    const address = guarded.address();
    if (!address || typeof address === "string") throw new Error("Server has no TCP address.");
    const api = `http://127.0.0.1:${address.port}/api`;
    assert.equal((await fetch(`${api}/health`)).status, 200);
    assert.equal((await fetch(`${api}/session`)).status, 403);
    assert.equal((await fetch(`${api}/session`, { headers: { "X-Grids-Proxy-Secret": "wrong" } })).status, 403);
    const response = await fetch(`${api}/session`, { headers: { "X-Grids-Proxy-Secret": secret, Cookie: alice } });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).user);
  } finally {
    await new Promise<void>((resolve, reject) => guarded.close((error) => error ? reject(error) : resolve()));
  }
});

test("saved grids persist references, enforce ownership and reject stale replacements", async () => {
  const document = toSavedGrid(makeWorkspace());
  const remoteId = randomUUID();
  const localId = randomUUID();
  document.assets = [{
    id: remoteId, title: "Remote", category: "Imported",
    provenance: {
      provider: "commons", entityId: "123",
      sourcePage: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      originalUrl: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
      creator: "Example", license: "Public domain",
      licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    },
  }];
  document.localAssetIds = [localId];
  document.grid.cells[0].assetId = remoteId;
  document.grid.cells[0].crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
  document.grid.cells[1].assetId = localId;
  document.grid.heading = "Account grid";
  const created = await request("/grids", { method: "POST", cookie: alice, body: { name: "First", document } });
  assert.equal(created.status, 201);
  const item = await created.json();
  assert.equal((await request(`/grids/${item.id}`, { cookie: bob })).status, 404);
  assert.equal((await request(`/grids/${item.id}`, { cookie: bob, method: "DELETE" })).status, 404);
  assert.equal((await request("/grids", { cookie: bob }).then((response) => response.json())).items.length, 0);
  assert.deepEqual((await request(`/grids/${item.id}`, { cookie: alice }).then((response) => response.json())).document, document);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const update = { name: "Renamed", document };
  assert.equal((await request(`/grids/${item.id}`, {
    method: "PUT", cookie: alice, body: update, version: item.updatedAt,
  })).status, 200);
  assert.equal((await request(`/grids/${item.id}`, {
    method: "PUT", cookie: alice, body: update, version: item.updatedAt,
  })).status, 409);
  const stored = await db.query("SELECT document FROM grids WHERE id = $1", [item.id]);
  assert.deepEqual(stored.rows[0].document, document);
  assert.ok(!JSON.stringify(stored.rows[0].document).includes('"src"'));
});

test("private presets are private; published settings are readable but never writable by others", async () => {
  const body = { name: "Preset", public: false, settings: getEditorSettings(makeWorkspace()) };
  const created = await request("/presets", { cookie: alice, method: "POST", body });
  assert.equal(created.status, 201);
  const preset = await created.json();
  assert.equal((await request(`/presets/${preset.id}`)).status, 404);
  assert.equal((await request("/presets?scope=public").then((response) => response.json())).items.length, 0);
  const published = await request(`/presets/${preset.id}`, {
    method: "PUT", cookie: alice, body: { ...body, public: true }, version: preset.updatedAt,
  });
  assert.equal(published.status, 200);
  const version = (await published.json()).updatedAt;
  assert.equal((await request(`/presets/${preset.id}`)).status, 200);
  const publicList = await request("/presets?scope=public").then((response) => response.json());
  assert.equal(publicList.items[0].owned, false);
  assert.equal((await request(`/presets/${preset.id}`, {
    method: "PUT", cookie: bob, body, version,
  })).status, 409);
  assert.equal((await request(`/presets/${preset.id}`, { method: "DELETE", cookie: bob })).status, 404);
  assert.equal((await request(`/presets/${preset.id}`, {
    method: "PUT", cookie: alice, body, version,
  })).status, 200);
  assert.equal((await request(`/presets/${preset.id}`)).status, 404);
});

test("OAuth state is browser-bound, expiring, single-use; all provider accounts use stable subjects", async () => {
  const start = await request("/auth/google/start");
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const browser = start.headers.get("set-cookie")!.split(";")[0];
  const path = `/auth/google/callback?state=${state}&code=intruder`;
  const wrongBrowser = await request(path, { cookie: `grids-oauth=${"a".repeat(43)}` });
  assert.ok(wrongBrowser.headers.get("location")?.includes("auth=failed"));
  assert.ok(!(wrongBrowser.headers.get("set-cookie") || "").includes("grids-session="));
  const good = await request(path, { cookie: browser });
  assert.ok(good.headers.getSetCookie().some((cookie) => cookie.startsWith("grids-session=")));
  const replay = await request(path, { cookie: browser });
  assert.ok(replay.headers.get("location")?.includes("auth=failed"));
  const expired = await request("/auth/google/start");
  await db.query("UPDATE oauth_states SET expires_at = now() - interval '1 minute'");
  const expiredState = new URL(expired.headers.get("location")!).searchParams.get("state");
  const expiry = await request(`/auth/google/callback?state=${expiredState}&code=expired`, {
    cookie: expired.headers.get("set-cookie")!.split(";")[0],
  });
  assert.ok(expiry.headers.get("location")?.includes("auth=failed"));
  for (const provider of ["google", "facebook", "discord"]) {
    const first = await login("same-subject", provider);
    const second = await login("same-subject", provider);
    const one = await request("/session", { cookie: first }).then((response) => response.json());
    const two = await request("/session", { cookie: second }).then((response) => response.json());
    assert.equal(one.user.id, two.user.id);
    assert.equal(one.user.provider, provider);
  }
  const stored = await db.query("SELECT token_hash FROM sessions");
  assert.ok(stored.rows.every((row) => /^[0-9a-f]{64}$/.test(row.token_hash)));
});

test("logout invalidates sessions and deleting an account cascades server data", async () => {
  const previous = await login("to-delete");
  const session = await login("to-delete", "google", previous);
  assert.equal((await request("/session", { cookie: previous }).then((response) => response.json())).user, null);
  const body = { name: "Owned", document: toSavedGrid(makeWorkspace()) };
  await request("/grids", { cookie: session, method: "POST", body });
  const owner = await request("/session", { cookie: session }).then((response) => response.json());
  assert.equal((await request("/account", { cookie: session, method: "DELETE" })).status, 204);
  assert.equal((await request("/session", { cookie: session }).then((response) => response.json())).user, null);
  assert.equal((await db.query("SELECT id FROM grids WHERE user_id = $1", [owner.user.id])).rowCount, 0);
  assert.equal((await request("/logout", { cookie: alice, method: "POST", body: {} })).status, 204);
  assert.equal((await request("/grids", { cookie: alice })).status, 401);
});

test("saved lists return 50-item pages without dropping or duplicating items", async () => {
  const cookie = await login("pagination");
  const owner = await request("/session", { cookie }).then((response) => response.json());
  await db.query(
    `INSERT INTO grids(id, user_id, name, document)
     SELECT gen_random_uuid(), $1, 'Paged ' || n, $2::jsonb FROM generate_series(1, 51) AS item(n)`,
    [owner.user.id, JSON.stringify(toSavedGrid(makeWorkspace()))],
  );
  const first = await request("/grids", { cookie }).then((response) => response.json());
  const second = await request("/grids?page=1", { cookie }).then((response) => response.json());
  assert.equal(first.items.length, 50);
  assert.equal(first.nextPage, 1);
  assert.equal(second.items.length, 1);
  assert.equal(second.nextPage, null);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 51);
});

test("legacy migration preserves account IDs, saves, provider subjects and active sessions", async () => {
  const legacySchema = `${schema}_legacy`;
  await admin.query(`CREATE SCHEMA ${legacySchema}`);
  const url = new URL(connection.href);
  url.searchParams.set("options", `-c search_path=${legacySchema}`);
  const legacy = createPool(url.href);
  try {
    await legacy.query(await readFile(new URL("../../../packages/database/migrations/001_accounts.sql", import.meta.url), "utf8"));
    await legacy.query("CREATE TABLE schema_migrations(name text PRIMARY KEY)");
    await legacy.query("INSERT INTO schema_migrations VALUES ('001_accounts.sql')");
    const userId = randomUUID();
    const gridId = randomUUID();
    await legacy.query("INSERT INTO users(id, provider, subject, name) VALUES ($1, 'discord', 'legacy-subject', 'Legacy')", [userId]);
    await legacy.query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ('legacy-hash', $1, now() + interval '1 day')", [userId]);
    await legacy.query("INSERT INTO grids(id, user_id, name, document) VALUES ($1, $2, 'Legacy', $3)", [
      gridId, userId, JSON.stringify(toSavedGrid(makeWorkspace())),
    ]);
    await migrate(legacy);
    await migrate(legacy);
    assert.deepEqual((await legacy.query("SELECT provider, subject, user_id, name FROM account_identities")).rows, [
      { provider: "discord", subject: "legacy-subject", user_id: userId, name: "Legacy" },
    ]);
    assert.equal((await legacy.query("SELECT provider FROM sessions WHERE token_hash = 'legacy-hash'")).rows[0].provider, "discord");
    assert.equal((await legacy.query("SELECT user_id FROM grids WHERE id = $1", [gridId])).rows[0].user_id, userId);
  } finally {
    await legacy.end();
    await admin.query(`DROP SCHEMA ${legacySchema} CASCADE`);
  }
});

test("explicit linking connects a fresh identity, and either provider opens the same account", async () => {
  const cookie = await login("link-target");
  const owner = await session(cookie);
  assert.equal((await request("/auth/discord/link", { method: "POST", body: {} })).status, 401);
  assert.equal((await request("/auth/discord/link", { method: "POST", cookie, body: {}, origin: "https://evil.example" })).status, 403);
  assert.equal((await request("/auth/discord/link", { cookie })).status, 404);
  const callback = await link(cookie, "discord", "fresh-linked");
  assert.ok(callback.headers.get("location")?.includes("auth=linked"));
  const linked = await session(cookie);
  assert.equal(linked.user.id, owner.user.id);
  assert.deepEqual(linked.connections.map((item: { provider: string }) => item.provider), ["discord", "google"]);
  assert.equal(linked.pendingMerge, null);
  assert.equal((await session(await login("fresh-linked", "discord"))).user.id, owner.user.id);
  assert.equal((await session(await login("link-target"))).user.id, owner.user.id);
  assert.equal((await request("/auth/discord/link", { method: "POST", cookie, body: {} })).status, 409);
});

test("linking is bound to the exact active session and cannot switch accounts, replay or survive logout", async () => {
  const target = await login("bound-target");
  const anotherSession = await login("bound-target");
  const begin = await beginLink(target, "discord");
  const callbackPath = `/auth/discord/callback?state=${begin.state}&code=never-connected`;
  const mismatch = await request(callbackPath, { cookie: `${begin.browser}; ${anotherSession}` });
  assert.ok(mismatch.headers.get("location")?.includes("auth=failed"));
  assert.equal((await session(target)).connections.length, 1);
  assert.ok((await request(callbackPath, { cookie: `${begin.browser}; ${target}` })).headers.get("location")?.includes("auth=failed"));
  const loggedOut = await beginLink(target, "discord");
  await request("/logout", { method: "POST", cookie: target, body: {} });
  const afterLogout = await request(`/auth/discord/callback?state=${loggedOut.state}&code=not-linked`, {
    cookie: `${loggedOut.browser}; ${target}`,
  });
  assert.ok(afterLogout.headers.get("location")?.includes("auth=failed"));
  assert.equal((await session(target)).user, null);
  assert.equal((await session(anotherSession)).connections.length, 1);
  const cancelled = await beginLink(anotherSession, "discord");
  const denied = await request(`/auth/discord/callback?state=${cancelled.state}&error=access_denied`, {
    cookie: `${cancelled.browser}; ${anotherSession}`,
  });
  assert.ok(denied.headers.get("location")?.includes("auth=failed"));
  assert.equal((await session(anotherSession)).connections.length, 1);
});

test("confirmed merges keep every save, ID, timestamp, duplicate name, visibility and incoming provider", async () => {
  const target = await login("merge-target");
  const source = await login("merge-source", "discord");
  await link(source, "facebook", "source-facebook");
  const sourceSession2 = await login("source-facebook", "facebook");
  const targetId = (await session(target)).user.id;
  const sourceId = (await session(source)).user.id;
  const gridBody = { name: "Duplicate", document: toSavedGrid(makeWorkspace()) };
  const first = await request("/grids", { method: "POST", cookie: target, body: gridBody }).then((r) => r.json());
  const second = await request("/grids", { method: "POST", cookie: source, body: gridBody }).then((r) => r.json());
  const privatePreset = await request("/presets", { method: "POST", cookie: source, body: {
    name: "Duplicate", public: false, settings: getEditorSettings(makeWorkspace()),
  } }).then((r) => r.json());
  const publicPreset = await request("/presets", { method: "POST", cookie: source, body: {
    name: "Duplicate", public: true, settings: getEditorSettings(makeWorkspace()),
  } }).then((r) => r.json());
  const callback = await link(target, "discord", "merge-source");
  assert.ok(callback.headers.get("location")?.includes("auth=merge"));
  const review = (await session(target)).pendingMerge;
  assert.equal(review.grids, 1);
  assert.equal(review.presets, 2);
  assert.deepEqual(review.providers, ["discord", "facebook"]);
  assert.equal((await session(source)).user.id, sourceId);
  assert.equal((await request(`/grids/${second.id}`, { cookie: target })).status, 404);
  assert.equal((await request("/account/merge", { method: "POST", cookie: source, body: { id: review.id } })).status, 409);
  assert.equal((await request("/account/merge", { method: "POST", cookie: target, origin: "https://evil.example", body: { id: review.id } })).status, 403);
  const result = await request("/account/merge", { method: "POST", cookie: target, body: { id: review.id } });
  assert.equal(result.status, 204);
  assert.deepEqual(await request(`/grids/${first.id}`, { cookie: target }).then((r) => r.json()), first);
  assert.deepEqual(await request(`/grids/${second.id}`, { cookie: target }).then((r) => r.json()), second);
  for (const preset of [privatePreset, publicPreset]) {
    assert.deepEqual(await request(`/presets/${preset.id}`, { cookie: target }).then((r) => r.json()), preset);
  }
  assert.equal((await session(target)).user.id, targetId);
  assert.equal((await session(target)).user.name, "merge-target");
  assert.equal((await session(target)).pendingMerge, null);
  assert.equal((await session(source)).user, null);
  assert.equal((await session(sourceSession2)).user, null);
  assert.equal((await db.query("SELECT id FROM users WHERE id = $1", [sourceId])).rowCount, 0);
  assert.equal((await session(await login("merge-source", "discord"))).user.id, targetId);
  assert.equal((await session(await login("source-facebook", "facebook"))).user.id, targetId);
  assert.equal((await request("/account/merge", { method: "POST", cookie: target, body: { id: review.id } })).status, 409);
});

test("merge cancellation, expiry and conflicting identities leave both accounts unchanged", async () => {
  const target = await login("cancel-target");
  const source = await login("cancel-source", "discord");
  const sourceId = (await session(source)).user.id;
  await link(target, "discord", "cancel-source");
  const pending = (await session(target)).pendingMerge;
  assert.equal((await request(`/account/merge/${pending.id}`, { method: "DELETE", cookie: target })).status, 204);
  assert.equal((await request("/account/merge", { method: "POST", cookie: target, body: { id: pending.id } })).status, 409);
  await link(target, "discord", "cancel-source");
  const expired = (await session(target)).pendingMerge;
  await db.query("UPDATE account_merges SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.id]);
  assert.equal((await request("/account/merge", { method: "POST", cookie: target, body: { id: expired.id } })).status, 409);
  await link(source, "google", "another-google");
  const conflict = await link(target, "discord", "cancel-source");
  assert.ok(conflict.headers.get("location")?.includes("auth=link-conflict"));
  assert.equal((await session(source)).user.id, sourceId);
  assert.equal((await session(target)).connections.length, 1);
});

test("disconnect revokes provider sessions and pending links, keeps data and prevents lockout", async () => {
  const target = await login("disconnect-target");
  assert.equal((await request("/account/providers/google", { method: "DELETE", cookie: target })).status, 409);
  await link(target, "discord", "disconnect-discord");
  const discord = await login("disconnect-discord", "discord");
  await beginLink(discord, "facebook");
  const ownerId = (await session(target)).user.id;
  const grid = await request("/grids", { method: "POST", cookie: target, body: {
    name: "Kept", document: toSavedGrid(makeWorkspace()),
  } }).then((r) => r.json());
  assert.equal((await request("/account/providers/discord", { method: "DELETE", cookie: target })).status, 204);
  assert.equal((await session(discord)).user, null);
  assert.equal((await session(target)).user.id, ownerId);
  assert.equal((await request(`/grids/${grid.id}`, { cookie: target })).status, 200);
  assert.equal((await db.query("SELECT 1 FROM oauth_states WHERE link_session_hash NOT IN (SELECT token_hash FROM sessions)")).rowCount, 0);
  assert.notEqual((await session(await login("disconnect-discord", "discord"))).user.id, ownerId);
  await link(target, "facebook", "disconnect-facebook");
  const disconnectedCurrent = await request("/account/providers/google", { method: "DELETE", cookie: target });
  assert.equal(disconnectedCurrent.status, 204);
  assert.ok(disconnectedCurrent.headers.get("set-cookie")?.includes("Max-Age=0"));
  assert.equal((await session(target)).user, null);
  const facebook = await login("disconnect-facebook", "facebook");
  assert.equal((await session(facebook)).user.id, ownerId);
  assert.equal((await request("/account/providers/facebook", { method: "DELETE", cookie: facebook })).status, 409);
  await request("/account", { method: "DELETE", cookie: facebook });
  assert.equal((await db.query("SELECT 1 FROM account_identities WHERE user_id = $1", [ownerId])).rowCount, 0);
});

test("concurrent first sign-ins and reciprocal merges serialize without losing saves or splitting identities", async () => {
  const [one, two] = await Promise.all([login("race-login"), login("race-login")]);
  assert.equal((await session(one)).user.id, (await session(two)).user.id);
  const target = await login("race-target");
  const source = await login("race-source", "discord");
  await Promise.all([link(target, "discord", "race-source"), link(source, "google", "race-target")]);
  const targetPending = (await session(target)).pendingMerge;
  const sourcePending = (await session(source)).pendingMerge;
  const results = await Promise.all([
    request("/account/merge", { method: "POST", cookie: target, body: { id: targetPending.id } }),
    request("/account/merge", { method: "POST", cookie: source, body: { id: sourcePending.id } }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [204, 401]);
  const google = await session(await login("race-target"));
  const discord = await session(await login("race-source", "discord"));
  assert.equal(google.user.id, discord.user.id);
  assert.equal(google.connections.length, 2);
});

test("normal sign-in switches accounts without linking or transferring private data", async () => {
  const first = await login("switch-first");
  const ownerId = (await session(first)).user.id;
  const item = await request("/grids", { method: "POST", cookie: first, body: {
    name: "Stay private", document: toSavedGrid(makeWorkspace()),
  } }).then((response) => response.json());
  const second = await login("switch-second", "discord", first);
  assert.notEqual((await session(second)).user.id, ownerId);
  assert.equal((await session(second)).connections.length, 1);
  assert.equal((await request(`/grids/${item.id}`, { cookie: second })).status, 404);
  assert.equal((await session(first)).user, null);
  assert.equal((await session(await login("switch-first"))).user.id, ownerId);
});

test("stale merge proofs and new provider conflicts cannot move or delete data", async () => {
  const target = await login("stale-target");
  const source = await login("stale-source", "discord");
  await link(source, "facebook", "stale-facebook");
  await link(target, "discord", "stale-source");
  const pending = (await session(target)).pendingMerge;
  await request("/account/providers/discord", { method: "DELETE", cookie: source });
  assert.equal((await session(target)).pendingMerge, null);
  assert.equal((await request("/account/merge", { method: "POST", cookie: target, body: { id: pending.id } })).status, 409);

  const newSource = await login("new-conflict-source", "discord");
  await link(target, "facebook", "conflict-target-facebook");
  await link(target, "discord", "new-conflict-source");
  const newPending = (await session(target)).pendingMerge;
  await link(newSource, "facebook", "conflict-source-facebook");
  assert.equal((await request("/account/merge", { method: "POST", cookie: target, body: { id: newPending.id } })).status, 409);
  assert.notEqual((await session(target)).user.id, (await session(newSource)).user.id);
  assert.equal((await session(newSource)).connections.length, 2);
});

test("merge failures roll back transfers and session revocation in the same transaction", async () => {
  const target = await login("rollback-target");
  const source = await login("rollback-source", "discord");
  const sourceId = (await session(source)).user.id;
  const grid = await request("/grids", { method: "POST", cookie: source, body: {
    name: "Must not move partly", document: toSavedGrid(makeWorkspace()),
  } }).then((response) => response.json());
  await request("/presets", { method: "POST", cookie: source, body: {
    name: "Block transfer", public: false, settings: getEditorSettings(makeWorkspace()),
  } });
  await link(target, "discord", "rollback-source");
  const pending = (await session(target)).pendingMerge;
  await db.query(`CREATE FUNCTION reject_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Injected merge failure'; END; $$`);
  await db.query("CREATE TRIGGER reject_transfer BEFORE UPDATE ON presets FOR EACH ROW EXECUTE FUNCTION reject_transfer()");
  try {
    assert.equal((await request("/account/merge", { method: "POST", cookie: target, body: { id: pending.id } })).status, 500);
    assert.equal((await session(source)).user.id, sourceId);
    assert.equal((await request(`/grids/${grid.id}`, { cookie: source })).status, 200);
    assert.equal((await request(`/grids/${grid.id}`, { cookie: target })).status, 404);
    assert.equal((await session(target)).pendingMerge.id, pending.id);
  } finally {
    await db.query("DROP TRIGGER reject_transfer ON presets");
    await db.query("DROP FUNCTION reject_transfer()");
  }
});

test("simultaneous disconnects cannot remove the last provider, including when another provider is disabled", async () => {
  const target = await login("last-provider");
  await link(target, "discord", "last-discord");
  const result = await Promise.all([
    request("/account/providers/google", { method: "DELETE", cookie: target }),
    request("/account/providers/discord", { method: "DELETE", cookie: target }),
  ]);
  const successful = result.filter((response) => response.status === 204);
  assert.equal(successful.length, 1);
  const remaining = await db.query(
    "SELECT i.provider FROM account_identities i JOIN users u ON u.id = i.user_id WHERE u.name = 'last-provider'",
  );
  assert.equal(remaining.rowCount, 1);

  const enabled = await login("configured-only");
  await link(enabled, "discord", "disabled-discord");
  const guarded = createApp({
    ...config, credentials: { ...config.credentials, discord: { id: "", secret: "" } },
  }, db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => guarded.once("listening", resolve));
  try {
    const address = guarded.address();
    if (!address || typeof address === "string") throw new Error("Server has no TCP address.");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/account/providers/google`, {
      method: "DELETE", headers: { Cookie: enabled, Origin: config.webOrigin, "X-Grids-Request": "1" },
    });
    assert.equal(response.status, 409);
    assert.equal((await session(enabled)).connections.length, 2);
  } finally {
    await new Promise<void>((resolve, reject) => guarded.close((error) => error ? reject(error) : resolve()));
  }
});
