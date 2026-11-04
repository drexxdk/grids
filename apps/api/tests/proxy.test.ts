import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../../../functions/api/[[path]].js";

const env = {
  GRIDS_API_URL: "https://upstream.example/grids-api",
  GRIDS_PUBLIC_ORIGIN: "https://gridz.pages.dev",
  GRIDS_PROXY_SECRET: "a".repeat(64),
};
const url = `${env.GRIDS_PUBLIC_ORIGIN}/api`;

test("Pages forwards only the production API, sanitizes proxy headers and preserves cookies", async (t) => {
  const forwarded = t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://upstream.example/grids-api/api/auth/google/callback?state=test");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Cookie"), "session=opaque; oauth=bound");
    assert.equal(headers.get("X-Grids-Proxy-Secret"), env.GRIDS_PROXY_SECRET);
    assert.equal(headers.get("X-Grids-Client-IP"), "203.0.113.1");
    for (const header of ["host", "authorization", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]) {
      assert.equal(headers.get(header), null);
    }
    assert.equal(init?.redirect, "manual");
    const responseHeaders = new Headers({ Location: `${env.GRIDS_PUBLIC_ORIGIN}/` });
    responseHeaders.append("Set-Cookie", "__Secure-grids-session=opaque; Path=/api; HttpOnly; Secure; SameSite=Lax");
    responseHeaders.append("Set-Cookie", "__Secure-grids-oauth=; Max-Age=0; Path=/api/auth; HttpOnly; Secure; SameSite=Lax");
    return new Response(null, { status: 302, headers: responseHeaders });
  });
  const request = new Request(`${url}/auth/google/callback?state=test`, {
    headers: {
      Cookie: "session=opaque; oauth=bound", Host: "spoofed.example", Authorization: "attacker",
      Forwarded: "for=attacker", "X-Forwarded-For": "attacker", "X-Forwarded-Host": "attacker",
      "X-Forwarded-Proto": "http", "X-Grids-Proxy-Secret": "attacker",
      "X-Grids-Client-IP": "attacker", "CF-Connecting-IP": "203.0.113.1",
    },
  });
  const response = await onRequest({ request, env });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), `${env.GRIDS_PUBLIC_ORIGIN}/`);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.ok(response.headers.getSetCookie().every((cookie) => cookie.includes("HttpOnly; Secure; SameSite=Lax")));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(forwarded.mock.callCount(), 1);
});

test("Pages streams JSON writes and retains origin and CSRF headers", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Origin"), env.GRIDS_PUBLIC_ORIGIN);
    assert.equal(headers.get("X-Grids-Request"), "1");
    assert.equal(headers.get("If-Match"), "version");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(await new Response(init?.body).text(), '{"name":"Grid"}');
    return Response.json({ id: "saved" }, { status: 201 });
  });
  const response = await onRequest({
    env,
    request: new Request(`${url}/grids`, {
      method: "POST",
      headers: { Origin: env.GRIDS_PUBLIC_ORIGIN, "X-Grids-Request": "1", "If-Match": "version", "Content-Type": "application/json" },
      body: '{"name":"Grid"}',
    }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "saved" });
});

test("Pages blocks previews, missing bindings, unsafe configuration and non-API paths without contacting upstream", async (t) => {
  const forwarded = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not fetch"); });
  for (const [requestUrl, bindings, status] of [
    ["https://preview.gridz.pages.dev/api/session", env, 403],
    [`${url}/session`, { ...env, GRIDS_PROXY_SECRET: undefined }, 503],
    [`${url}/session`, { ...env, GRIDS_API_URL: "http://upstream.example" }, 503],
    [`${url}/session`, { ...env, GRIDS_API_URL: "invalid" }, 503],
    [`${url}/session`, { ...env, GRIDS_API_URL: env.GRIDS_PUBLIC_ORIGIN }, 503],
    [`${env.GRIDS_PUBLIC_ORIGIN}/outside`, env, 404],
  ] as const) {
    assert.equal((await onRequest({ request: new Request(requestUrl), env: bindings })).status, status);
  }
  assert.equal(forwarded.mock.callCount(), 0);
});

test("Pages reports an upstream outage explicitly without exposing upstream errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private diagnostic"); });
  const response = await onRequest({ request: new Request(`${url}/session`), env });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes("private diagnostic"));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
