import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { makeWorkspace, getEditorSettings, workspaceSchema } from "@grids/contracts/model";
import { fromSavedGrid, toSavedGrid, gridWriteSchema, presetWriteSchema, authorizationSchema } from "@grids/contracts/cloud";
import { authorizationUrl, callbackUrl, exchangeCode, randomToken } from "../src/oauth.js";
import { readConfig } from "../src/config.js";

const config = readConfig({
  DATABASE_URL: "postgres://unused",
  GOOGLE_CLIENT_ID: "google-id", GOOGLE_CLIENT_SECRET: "google-secret",
  DISCORD_CLIENT_ID: "discord-id", DISCORD_CLIENT_SECRET: "discord-secret",
  FACEBOOK_APP_ID: "facebook-id", FACEBOOK_APP_SECRET: "facebook-secret",
});
const provenance = {
  provider: "commons" as const,
  entityId: "123",
  sourcePage: "https://commons.wikimedia.org/wiki/File:Example.jpg",
  originalUrl: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
  creator: "Example",
  license: "Public domain" as const,
  licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
};

test("saved grids contain references only and restore browser-local images only when available", () => {
  const workspace = makeWorkspace();
  const local = { id: randomUUID(), title: "Local", category: "Imported", src: "blob:local-private" };
  const remote = { id: randomUUID(), title: "Remote", category: "Imported", src: "blob:downloaded", provenance };
  workspace.assets = [local, remote];
  workspace.grid.cells[0] = {
    ...workspace.grid.cells[0], assetId: local.id, title: "Private caption",
    crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
  };
  workspace.grid.cells[1].assetId = remote.id;
  const saved = toSavedGrid(workspace);
  assert.deepEqual(saved.localAssetIds, [local.id]);
  assert.equal(saved.assets.length, 1);
  assert.ok(!JSON.stringify(saved).includes("blob:"));
  assert.ok(!JSON.stringify(saved).includes('"src"'));
  const sameBrowser = fromSavedGrid(saved, [local]);
  assert.equal(sameBrowser.grid.cells[0].assetId, local.id);
  assert.equal(sameBrowser.assets.find((asset) => asset.id === local.id)?.src, local.src);
  const otherBrowser = fromSavedGrid(saved);
  assert.equal(otherBrowser.grid.cells[0].assetId, null);
  assert.equal(otherBrowser.grid.cells[0].crop, undefined);
  assert.equal(otherBrowser.grid.cells[0].title, "Private caption");
  assert.equal(otherBrowser.assets[0].src, provenance.originalUrl);
  assert.ok(workspaceSchema.safeParse(otherBrowser).success);
  assert.ok(!gridWriteSchema.safeParse({ name: "test", document: { ...saved, blob: "data:image/png;base64,eA==" } }).success);
  assert.ok(!gridWriteSchema.safeParse({
    name: "test",
    document: { ...saved, assets: [{ ...saved.assets[0], src: "data:image/png;base64,eA==" }] },
  }).success);
  assert.ok(!gridWriteSchema.safeParse({
    name: "test",
    document: { ...saved, assets: [{ ...saved.assets[0], provenance: { ...provenance, originalUrl: "https://evil.example/a.png" } }] },
  }).success);
  assert.ok(!gridWriteSchema.safeParse({
    name: "test", document: { ...saved, localAssetIds: [local.id, local.id] },
  }).success);
});

test("library crop defaults round-trip through saved references and browser-local assets", () => {
  const workspace = makeWorkspace();
  const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
  const local = { id: randomUUID(), title: "Local", category: "Imported", src: "blob:local", crop };
  const remote = { id: randomUUID(), title: "Remote", category: "Imported", src: "blob:remote", provenance, crop };
  workspace.assets = [local, remote];
  workspace.grid.cells[0].assetId = remote.id;
  const saved = toSavedGrid(workspace);
  assert.deepEqual(saved.assets[0].crop, crop);
  const restored = fromSavedGrid(saved, [local]);
  assert.deepEqual(restored.assets.find((asset) => asset.id === remote.id)?.crop, crop);
  assert.deepEqual(restored.assets.find((asset) => asset.id === local.id)?.crop, crop);
  assert.equal(restored.grid.cells[0].crop, undefined);
  assert.ok(!gridWriteSchema.safeParse({
    name: "Grid", document: { ...saved, assets: [{ ...saved.assets[0], crop: { ...crop, width: 0.8 } }] },
  }).success);
});

test("new public-domain provider references round-trip without image bytes", () => {
  const workspace = makeWorkspace();
  workspace.assets = [{
    id: randomUUID(), title: "Caption", category: "Imported", src: "blob:temporary",
    provenance: {
      provider: "openverse", entityId: randomUUID(), title: "Original title", creator: "Photographer",
      sourcePage: "https://www.flickr.com/photos/example/123",
      originalUrl: "https://live.staticflickr.com/1/photo.jpg",
      license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    },
  }];
  workspace.grid.cells[0].assetId = workspace.assets[0].id;
  workspace.grid.cells[0].title = "A normal caption";
  workspace.grid.titlesVisible = false;
  const saved = toSavedGrid(workspace);
  const restored = fromSavedGrid(saved);
  assert.equal(restored.assets[0].src, workspace.assets[0].provenance?.originalUrl);
  assert.equal(restored.grid.cells[0].title, "A normal caption");
  const legacy = structuredClone(saved);
  legacy.assets[0].provenance = {
    ...legacy.assets[0].provenance, title: "Original title",
    license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  };
  assert.ok(!gridWriteSchema.safeParse({ name: "Grid", document: legacy }).success);
  const migrated = fromSavedGrid(legacy);
  assert.equal(migrated.assets.length, 0);
  assert.equal(migrated.grid.cells[0].assetId, null);
  assert.equal(migrated.grid.cells[0].title, "");
  assert.ok(!JSON.stringify(saved).includes("blob:"));
  for (const [provider, entityId, sourcePage, originalUrl] of [
    ["smk", "KKS123", "https://open.smk.dk/artwork/image/KKS123", "https://iip.smk.dk/iiif/jp2/123.jp2/full/!4000,4000/0/default.jpg"],
    ["inaturalist", "123", "https://www.inaturalist.org/photos/123", "https://inaturalist-open-data.s3.amazonaws.com/photos/123/original.jpg"],
    ["rijksmuseum", "200106530", "https://id.rijksmuseum.nl/200106530", "https://iiif.micr.io/KpXzv/full/!3071,4000/0/default.jpg"],
    ["wellcome", "pvqvftnf", "https://wellcomecollection.org/works/pvqvftnf", "https://iiif.wellcomecollection.org/image/V0047265/full/!3130,2229/0/default.jpg"],
  ] as const) {
    const candidate = structuredClone(saved);
    candidate.assets[0].provenance = {
      provider, entityId, sourcePage, originalUrl, creator: "Creator",
      license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    };
    assert.ok(gridWriteSchema.safeParse({ name: "Grid", document: candidate }).success);
  }
});

test("public presets exclude captions, identities, image references and local paths", () => {
  const workspace = makeWorkspace();
  workspace.grid.heading = "Must not publish";
  workspace.grid.cells[0].title = "Nor this";
  const settings = getEditorSettings(workspace);
  const parsed = presetWriteSchema.parse({ name: " Test ", public: true, settings });
  assert.equal(parsed.name, "Test");
  for (const word of ["Must not publish", "Nor this", "assetId", "heading", "cells", "src"]) {
    assert.ok(!JSON.stringify(settings).includes(`"${word}"`));
  }
  assert.ok(!presetWriteSchema.safeParse({
    name: "test", public: true, settings: { ...settings, assets: [] },
  }).success);
  assert.ok(!gridWriteSchema.safeParse({ name: " ", document: toSavedGrid(workspace) }).success);
});

test("OAuth URLs use exact callbacks, state and provider-appropriate PKCE without exposing secrets", () => {
  for (const provider of ["google", "discord", "facebook"] as const) {
    const state = randomToken();
    const url = new URL(authorizationUrl(config, provider, state, randomToken()));
    assert.equal(url.searchParams.get("state"), state);
    assert.equal(url.searchParams.get("redirect_uri"), callbackUrl(config, provider));
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.has("code_challenge"), provider !== "facebook");
    assert.ok(!url.href.includes("secret"));
    const connecting = new URL(authorizationUrl(config, provider, state, randomToken(), true));
    assert.equal(connecting.searchParams.get("prompt"), provider === "google" ? "select_account" : provider === "discord" ? "consent" : null);
    assert.equal(connecting.searchParams.get("auth_type"), provider === "facebook" ? "reauthenticate" : null);
    assert.equal(connecting.searchParams.get("scope"), url.searchParams.get("scope"));
    assert.ok(authorizationSchema.safeParse({ url: connecting.href }).success);
  }
  assert.ok(!authorizationSchema.safeParse({ url: "http://discord.com/oauth2/authorize" }).success);
  assert.ok(!authorizationSchema.safeParse({ url: "javascript:alert(1)" }).success);
});

test("all three code exchanges validate provider identities and discard access tokens", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const provider of ["google", "discord", "facebook"] as const) {
      const requests: { url: string; options?: RequestInit }[] = [];
      globalThis.fetch = async (input, options) => {
        requests.push({ url: String(input), options });
        return Response.json(requests.length === 1 ? { access_token: "do-not-store" } :
          provider === "google" ? { sub: "subject", name: "Tester" } : { id: "subject", name: "Tester" });
      };
      assert.deepEqual(await exchangeCode(config, provider, "code", "verifier"), { subject: "subject", name: "Tester" });
      assert.equal(requests.length, 2);
      const body = requests[0].options?.body as URLSearchParams;
      assert.equal(body.get("code_verifier"), provider === "facebook" ? null : "verifier");
      assert.equal(body.get("redirect_uri"), callbackUrl(config, provider));
      assert.equal(new Headers(requests[1].options?.headers).get("Authorization"), "Bearer do-not-store");
    }
    globalThis.fetch = async () => Response.json({ error: "secret" }, { status: 400 });
    await assert.rejects(() => exchangeCode(config, "google", "code", "verifier"), /400/);
  } finally { globalThis.fetch = originalFetch; }
});

test("production configuration requires HTTPS and complete credentials", () => {
  const production = {
    DATABASE_URL: "test", NODE_ENV: "production",
    WEB_URL: "https://gridz.pages.dev/", PUBLIC_API_URL: "https://gridz.pages.dev",
  };
  assert.throws(() => readConfig(production), /GRIDS_PROXY_SECRET/);
  assert.throws(() => readConfig({ ...production, GRIDS_PROXY_SECRET: "short" }));
  assert.equal(readConfig({ ...production, GRIDS_PROXY_SECRET: "a".repeat(64) }).secure, true);
  assert.throws(() => readConfig({ DATABASE_URL: "test", GOOGLE_CLIENT_ID: "half" }));
  assert.throws(() => readConfig({ DATABASE_URL: "test", NODE_ENV: "production" }));
  assert.throws(() => readConfig({ DATABASE_URL: "test", WEB_URL: "https://user:pass@example.com/" }));
});
