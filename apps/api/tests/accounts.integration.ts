import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
