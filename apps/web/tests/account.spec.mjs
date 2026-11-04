import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const image = new URL("./fixtures/assets/DC - Kite Man.jpg", import.meta.url);
const touchTest = test.extend({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
async function mockAccount(page, { signedIn = true, provider = "google", providers = ["google", "facebook", "discord"], connections, pendingMerge = null } = {}) {
  let user = signedIn ? { id: randomUUID(), name: "Test user", provider } : null;
  const state = {
    connections: connections ?? (user ? [{ provider, name: user.name }] : []),
    pendingMerge,
  };
  const grids = new Map();
  const presets = new Map();
  const writes = [];
  const reads = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/");
    const resource = parts[2];
    const id = parts[3];
    const method = request.method();
    if (method === "GET") reads.push(resource);
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (resource === "session") return json({
      user, providers,
      connections: user ? state.connections : [], pendingMerge: user ? state.pendingMerge : null,
    });
    if (resource === "auth" && parts[4] === "link") {
      writes.push({ resource, provider: id, method, headers: request.headers(), body: request.postDataJSON() });
      return json({ url: "https://discord.com/oauth2/authorize?client_id=test" });
    }
    if (resource === "account" && id === "providers") {
      const provider = parts[4];
      state.connections = state.connections.filter((connection) => connection.provider !== provider);
      if (user.provider === provider) user = { ...user, provider: state.connections.find((connection) => providers.includes(connection.provider)).provider };
      writes.push({ resource, provider, method });
      return route.fulfill({ status: 204 });
    }
    if (resource === "account" && id === "merge") {
      writes.push({ resource, method, body: method === "POST" ? request.postDataJSON() : undefined });
      if (method === "POST") {
        state.connections.push(...state.pendingMerge.providers.map((provider) => ({ provider, name: state.pendingMerge.name })));
      }
      state.pendingMerge = null;
      return route.fulfill({ status: 204 });
    }
    if (resource === "logout" || resource === "account") {
      user = null;
      return route.fulfill({ status: 204 });
    }
    const items = resource === "grids" ? grids : presets;
    if (method === "GET") {
      if (id) {
        const item = items.get(id);
        return json(item && resource === "presets" ? { ...item, owned: Boolean(user) && item.owned } : item, item ? 200 : 404);
      }
      const visible = [...items.values()].filter((item) =>
        url.searchParams.get("scope") === "public" ? item.public : true);
      return json({
        items: visible.map(({ document, settings, ...summary }) =>
          resource === "presets" ? { ...summary, owned: Boolean(user) && summary.owned } : summary),
        nextPage: null,
      });
    }
    if (method === "DELETE") {
      items.delete(id);
      return route.fulfill({ status: 204 });
    }
    const body = request.postDataJSON();
    writes.push({ resource, body, headers: request.headers(), method });
    const item = {
      id: id ?? randomUUID(),
      ...body,
      updatedAt: new Date().toISOString(),
      ...(resource === "presets" ? { owned: true } : {}),
    };
    items.set(item.id, item);
    return json(item, method === "POST" ? 201 : 200);
  });
  return { writes, reads, grids, presets, state, expireSession: () => { user = null; } };
}
async function openAccount(page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account", exact: true });
  await expect(dialog.getByRole("region", { name: "Connected sign-in providers", exact: true })).toBeVisible();
  return dialog;
}
async function openLibrary(page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Library", exact: true });
  await expect(dialog.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Shared presets", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("complementary")).toHaveCount(0);
  await expect(dialog.getByRole("navigation", { name: "Policies and support", exact: true })).toHaveCount(0);
  return dialog;
}
async function openLogin(page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Log in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Log in", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function signOut(page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Signed out." });
  await toast.getByRole("button", { name: "Close toast", exact: true }).click();
  await expectGuestMenu(page);
}
async function expectGuestMenu(page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Account", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}
async function browserDraft(page) {
  await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grids-client-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const { document, images } = await new Promise((resolve, reject) => {
        const transaction = database.transaction(["documents", "images"], "readonly");
        const document = transaction.objectStore("documents").get("guest");
        const images = transaction.objectStore("images").getAll();
        transaction.oncomplete = () => resolve({ document: document.result, images: images.result });
        transaction.onerror = () => reject(transaction.error);
      });
      return {
        document,
        images: await Promise.all(images.map(async ({ id, blob }) => ({
          id, hash: [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))],
        }))),
      };
    } finally { database.close(); }
  });
}

test("library reports pending saved grids and restores focus after loading", async ({ page }) => {
  const mock = await mockAccount(page);
  for (let index = 0; index < 3; index++) {
    const id = randomUUID();
    mock.grids.set(id, { id, name: `Saved grid ${index}`, updatedAt: new Date().toISOString() });
  }
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/grids", async (route) => {
    await ready;
    await route.fallback();
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Library", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Library", exact: true });
  try {
    await expect(dialog.getByRole("status")).toContainText("Loading...");
  } finally { release(); }
  await expect(dialog.getByRole("region", { name: "My saved grids", exact: true }).getByRole("listitem")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
});

test("saved-grid errors retain retry without a manual refresh button", async ({ page }) => {
  await mockAccount(page);
  const unavailable = (route) => route.fulfill({ status: 503, json: { error: "Saved grids unavailable" } });
  await page.route("**/api/grids", unavailable);
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
  const dialog = await openLibrary(page);
  await expect(dialog.getByRole("alert")).toContainText("Saved grids unavailable");
  await page.unroute("**/api/grids", unavailable);
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByLabel("Save name", { exact: true })).toBeEnabled();
});

async function expectProvidersReachable(tiles, panel) {
  for (const tile of await tiles.all()) {
    await expect(tile).toBeInViewport();
    if (await tile.isEnabled()) await tile.click({ trial: true });
  }
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}

for (const width of [260, 320, 390, 1280]) {
  test(`login providers remain accessible and reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAccount(page, { signedIn: false });
    await page.goto("./?source=imported");
    const dialog = await openLogin(page);
    for (const provider of ["Google", "Facebook", "Discord"]) {
      const link = dialog.getByRole("link", { name: `Continue with ${provider}`, exact: true });
      await expect(link).toBeVisible();

      await expect(link).toHaveAttribute("href", new RegExp(`/api/auth/${provider.toLowerCase()}/start$`));
    }
    await expectProvidersReachable(dialog.getByRole("link", { name: /^Continue with / }), page.locator("[data-modal-panel]"));
  });

  test(`provider controls expose connected state and remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAccount(page, { connections: [
      { provider: "google", name: "Google identity" }, { provider: "discord", name: "Discord identity" },
    ] });
    await page.goto("./?source=imported");
    const dialog = await openAccount(page);
    const section = dialog.getByRole("region", { name: "Connected sign-in providers", exact: true });
    await expect(section.getByRole("button")).toHaveCount(3);

    for (const provider of ["Google", "Discord"]) {
      const tile = section.getByRole("button", { name: `Disconnect ${provider}`, exact: true });
      await expect(tile).toHaveAttribute("aria-pressed", "true");

      await expect(tile).toBeEnabled();
    }
    const facebook = section.getByRole("button", { name: "Connect Facebook", exact: true });
    await expect(facebook).toHaveAttribute("aria-pressed", "false");

    await expect(facebook).toBeEnabled();
    await expect(section).not.toContainText("identity");
    await expectProvidersReachable(section.getByRole("button"), page.locator("[data-modal-panel]"));
  });
}

test("login is provider-only and switching from the guest library preserves focus and the browser draft", async ({ page }) => {
  const mock = await mockAccount(page, { signedIn: false });
  await page.goto("./?source=imported");
  await expectGuestMenu(page);
  const before = await browserDraft(page);
  let dialog = await openLogin(page);
  await expect(dialog.getByRole("link", { name: /^Continue with/ })).toHaveCount(3);
  await expect(dialog.getByLabel("Save name", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("region", { name: "Connected sign-in providers" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);
  expect(mock.reads.every((resource) => resource === "session")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
  const library = await openLibrary(page);
  await library.getByRole("button", { name: "Log in", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Log in", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
  expect(await browserDraft(page)).toEqual(before);
});

test("the hamburger menu supports keyboard navigation and keeps account management separate", async ({ page }) => {
  const mock = await mockAccount(page);
  await page.goto("./");
  const menuButton = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menuButton).toHaveText("");

  await menuButton.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Account", "Library", "Information", "Sign out",
  ]);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Account", exact: true })).toHaveAttribute("data-focus", "");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Account", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete account", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Save name", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("region", { name: "Shared presets", exact: true })).toHaveCount(0);
  expect(mock.reads.every((resource) => resource === "session")).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(menuButton).toBeFocused();
});

test("sign-out failure stays signed in and a successful retry preserves local images", async ({ page }) => {
  await mockAccount(page);
  await page.goto("./?source=imported");
  await page.locator("#replace-upload").setInputFiles({
    name: "local.jpg", mimeType: "image/jpeg", buffer: await readFile(image),
  });
  await expect(page.getByRole("button", { name: "Image options: local", exact: true })).toBeVisible();
  const before = await browserDraft(page);
  const failLogout = (route) => route.fulfill({ status: 503, json: { error: "Sign out unavailable" } });
  await page.route("**/api/logout", failLogout);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Sign out unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close toast", exact: true }).click();
  await page.unroute("**/api/logout", failLogout);
  await signOut(page);
  expect(await browserDraft(page)).toEqual(before);
});

for (const width of [320, 1280]) {
  test(`account deletion confirms inline, cancels and recovers from errors at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAccount(page);
    await page.goto("./");
    await page.locator("#replace-upload").setInputFiles({
      name: "local.jpg", mimeType: "image/jpeg", buffer: await readFile(image),
    });
    const before = await browserDraft(page);
    const dialog = await openAccount(page);
    const section = dialog.getByRole("region", { name: "Account removal", exact: true });
    const remove = section.getByRole("button", { name: "Delete account", exact: true });
    await expect(remove).toHaveAttribute("aria-expanded", "false");
    await expect(section.getByRole("group")).toHaveCount(0);
    let deletions = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/account" && request.method() === "DELETE") deletions++;
    });
    await remove.click();
    const confirmation = section.getByRole("group");
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("heading", { name: "Delete this data?", exact: true })).toBeVisible();
    await expect(confirmation).toContainText("Deletes your account and all cloud saves permanently. Browser data is kept.");
    await expect(remove).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.getByRole("group", { name: "Your Gridz account", exact: true })).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Connected sign-in providers", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);

    expect(deletions).toBe(0);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(remove).toHaveAttribute("aria-expanded", "false");
    expect(deletions).toBe(0);
    const failDelete = (route) => route.fulfill({ status: 503, json: { error: "Account deletion unavailable." } });
    await page.route("**/api/account", failDelete);
    await remove.click();
    await confirmation.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Account deletion unavailable.");
    await expect(remove).toBeEnabled();
    expect(deletions).toBe(1);
    await page.unroute("**/api/account", failDelete);
    await remove.click();
    await confirmation.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(deletions).toBe(2);
    expect(await browserDraft(page)).toEqual(before);
  });
}

for (const action of ["expire", "delete"]) {
  test(`header and account modal update when the session ends through ${action}`, async ({ page }) => {
    const mock = await mockAccount(page, {
      connections: [{ provider: "google", name: "Test user" }, { provider: "discord", name: "Other user" }],
    });
    await page.goto("./?source=imported");
    const before = await browserDraft(page);
    const dialog = await openAccount(page);
    if (action === "expire") {
      mock.expireSession();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    } else {
      const target = action === "delete"
        ? dialog.getByRole("button", { name: "Delete account", exact: true })
        : dialog.getByRole("button", { name: "Disconnect Google", exact: true });
      await target.click();
      await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    }
    await expect(dialog).toHaveCount(0);
    await expectGuestMenu(page);
    expect(await browserDraft(page)).toEqual(before);
  });
}

for (const signedIn of [false, true]) {
  for (const width of [260, 320, 390, 1280]) {
    test(`header actions do not overlap at ${width}px when ${signedIn ? "signed in" : "a guest"}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockAccount(page, { signedIn });
      await page.goto("./");
      const header = page.locator("[data-canvas-header]");
      const account = header.getByRole("button", { name: "Menu", exact: true });
      await expect(account).toBeVisible();
      await expect.poll(async () => (await header.getByRole("button", { name: "Export grid", exact: true }).boundingBox()).x)
        .toBeGreaterThanOrEqual(0);
      const buttons = [
        header.getByRole("button", { name: "Export grid", exact: true }),
        account,
        header.getByRole("button", { name: /^(Show sidebar|Close sidebar)$/ }),
      ];
      let right = 0;
      for (const button of buttons) {
        const bounds = await button.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(right);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);

        right = bounds.x + bounds.width;
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

for (const provider of ["google", "discord"]) {
  test(`account header is provider-neutral when signed in through ${provider}`, async ({ page }) => {
    await mockAccount(page, { provider, connections: [
      { provider: "google", name: "Google identity" }, { provider: "discord", name: "Discord identity" },
    ] });
    await page.goto("./?source=imported");
    const dialog = await openAccount(page);
    const identity = dialog.getByRole("group", { name: "Your Gridz account", exact: true });
    await expect(identity.getByText("Test user", { exact: true })).toBeVisible();
    await expect(identity.getByText("Your Gridz account", { exact: true })).toBeVisible();

    await expect(identity).not.toContainText(/Google|Discord|Connected with/);
    await expect(dialog.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("complementary")).toHaveCount(0);
    await expect(dialog.getByText("Keep at least one available sign-in provider connected.", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Sign in to this account using any connected provider.", { exact: false })).toHaveCount(0);
    await expect(dialog.getByRole("navigation", { name: "Policies and support", exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("Save name", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("region", { name: "Shared presets", exact: true })).toHaveCount(0);
    const connections = dialog.getByRole("region", { name: "Connected sign-in providers", exact: true });
    for (const name of ["Google", "Discord"]) {
      const tile = connections.getByRole("button", { name: `Disconnect ${name}`, exact: true });
      await expect(tile).toHaveText(name);
      await expect(tile).toHaveAttribute("aria-pressed", "true");

    }
  });
}

test("connecting a provider redirects immediately through a protected POST and leaves the saved browser draft intact", async ({ page }) => {
  const mock = await mockAccount(page);
  await page.route("https://discord.com/oauth2/authorize?client_id=test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Provider authorization</h1>" }));
  await page.goto("./?source=imported");
  await page.locator("#replace-upload").setInputFiles({
    name: "local.jpg", mimeType: "image/jpeg", buffer: await readFile(image),
  });
  await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
  const before = await browserDraft(page);
  expect(before.images).toHaveLength(1);
  const dialog = await openAccount(page);
  const connections = dialog.getByRole("region", { name: "Connected sign-in providers" });
  await expect(connections.getByRole("button", { name: /^Disconnect / })).toHaveCount(0);
  await expect(connections.getByRole("button", { name: "Connect Google", exact: true })).toHaveCount(0);
  await connections.getByRole("button", { name: "Connect Discord", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Provider authorization" })).toBeVisible();
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0]).toMatchObject({ resource: "auth", provider: "discord", method: "POST", body: {} });
  expect(mock.writes[0].headers["x-grids-request"]).toBe("1");
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Account", exact: true })).toBeVisible();
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
  expect(await browserDraft(page)).toEqual(before);
});

for (const provider of ["google", "facebook", "discord"]) {
  for (const width of [320, 1280]) {
    test(`${provider} linking disables repeat actions and restores the account on Back at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await mockAccount(page, { provider: provider === "google" ? "discord" : "google" });
        const name = provider[0].toUpperCase() + provider.slice(1);
        const authorizationUrl = `https://${provider}.example.test/authorize`;
        let releaseLink, linkStarted;
        const linkGate = new Promise((resolve) => { releaseLink = resolve; });
        const linking = new Promise((resolve) => { linkStarted = resolve; });
        let calls = 0;
        await page.route(`**/api/auth/${provider}/link`, async (route) => {
          calls++;
          expect(route.request().method()).toBe("POST");
          expect(route.request().headers()["x-grids-request"]).toBe("1");
          linkStarted();
          await linkGate;
          await route.fulfill({ json: { url: authorizationUrl } });
        });
        await page.route(authorizationUrl, (route) => route.fulfill({
          contentType: "text/html", body: "<h1>Provider authorization</h1>",
        }));
        await page.goto("./?source=imported");
        const dialog = await openAccount(page);
        try {
          const connect = dialog.getByRole("button", { name: `Connect ${name}`, exact: true });
          await connect.click();
          await linking;
          await expect(connect).toBeDisabled();
          await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
          expect(calls).toBe(1);
        } finally { releaseLink(); }
        await expect(page.getByRole("heading", { name: "Provider authorization" })).toBeVisible();
        await page.goBack();
        const restored = page.getByRole("dialog", { name: "Account", exact: true });
        await expect(restored).toBeVisible();
        await expect(restored.getByRole("button", { name: `Connect ${name}`, exact: true })).toBeEnabled();
        await page.reload();
        await expect(restored).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(restored).toHaveCount(0);
        await page.reload();
        await expect(page.getByRole("dialog")).toHaveCount(0);
      });
  }
}

for (const provider of ["google", "facebook", "discord"]) {
  test(`Back from ${provider} sign-in restores the login modal`, async ({ page }) => {
    await mockAccount(page, { signedIn: false });
    await page.route(`**/api/auth/${provider}/start`, (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Provider authorization</h1>" }));
    await page.goto("./?source=imported");
    const before = await browserDraft(page);
    const dialog = await openLogin(page);
    const name = provider[0].toUpperCase() + provider.slice(1);
    await dialog.getByRole("link", { name: `Continue with ${name}`, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Provider authorization" })).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: `Continue with ${name}`, exact: true })).toBeEnabled();
    expect(await browserDraft(page)).toEqual(before);
  });
}

test("failed direct provider connection displays the error without changing the account or browser draft", async ({ page }) => {
  const mock = await mockAccount(page);
  await page.route("**/api/auth/discord/link", (route) =>
    route.fulfill({ status: 503, json: { error: "Provider temporarily unavailable." } }));
  await page.goto("./?source=imported");
  const before = await browserDraft(page);
  const dialog = await openAccount(page);
  const connect = dialog.getByRole("button", { name: "Connect Discord", exact: true });
  await connect.click();
  await expect(dialog.getByRole("alert")).toContainText("Provider temporarily unavailable.");
  await expect(connect).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("group", { name: "Your Gridz account", exact: true })).toBeVisible();
  expect(mock.writes).toHaveLength(0);
  expect(await browserDraft(page)).toEqual(before);
});

for (const width of [320, 1280]) {
  test(`existing account merge review fits ${width}px and never merges automatically`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const pendingMerge = {
      id: randomUUID(), provider: "discord", name: "Incoming account", providers: ["discord", "facebook"], grids: 3, presets: 4,
    };
    const mock = await mockAccount(page, { pendingMerge });
    await page.goto("./?source=imported");
    await page.locator("#replace-upload").setInputFiles({
      name: "local.jpg", mimeType: "image/jpeg", buffer: await readFile(image),
    });
    await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
    const before = await browserDraft(page);
    await page.goto("./?source=imported&auth=merge");
    const dialog = page.getByRole("dialog", { name: "Account", exact: true });
    const review = dialog.getByRole("region", { name: "Merge existing accounts?" });
    await expect(review).toBeVisible();
    await expect(review).toContainText("Incoming account (Discord, Facebook) already has 3 saved grids and 4 presets");
    expect(mock.writes).toHaveLength(0);
    await expect(dialog.getByRole("button", { name: "Connect Discord", exact: true })).toBeDisabled();
    const bounds = await page.locator("[data-modal-panel]").evaluate((element) => ({
      width: element.clientWidth, scroll: element.scrollWidth,
    }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    await review.getByRole("button", { name: "Merge accounts and keep all saves", exact: true }).click();
    await expect(review).toHaveCount(0);
    expect(mock.writes).toEqual([{ resource: "account", method: "POST", body: { id: pendingMerge.id } }]);
    await expect(dialog.getByRole("button", { name: "Disconnect Discord", exact: true })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Disconnect Facebook", exact: true })).toBeEnabled();
    expect(await browserDraft(page)).toEqual(before);
  });
}

test("merge cancellation and server conflicts are visible without changing the browser grid", async ({ page }) => {
  const mock = await mockAccount(page, { pendingMerge: {
    id: randomUUID(), provider: "discord", name: "Another account", providers: ["discord"], grids: 1, presets: 0,
  } });
  await page.goto("./?source=imported&auth=merge");
  const dialog = page.getByRole("dialog", { name: "Account", exact: true });
  const review = dialog.getByRole("region", { name: "Merge existing accounts?" });
  await expect(review).toBeVisible();
  await page.route("**/api/account/merge", (route) => route.fulfill({
    status: 409, json: { error: "Merge expired or changed. Connect the provider again." },
  }));
  await review.getByRole("button", { name: "Merge accounts and keep all saves", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Merge expired or changed");
  await expect(review).toBeVisible();
  expect(mock.writes).toHaveLength(0);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(mock.writes).toEqual([{ resource: "account", method: "DELETE", body: undefined }]);
  await expect(page.locator(".grid-cell")).toHaveCount(9);
});

test("disconnect uses inline confirmation, cancellation is harmless and the final provider stays connected", async ({ page }) => {
  const mock = await mockAccount(page, { connections: [
    { provider: "google", name: "Test user" }, { provider: "discord", name: "Discord identity" },
  ] });
  await page.goto("./?source=imported");
  const dialog = await openAccount(page);
  const disconnect = dialog.getByRole("button", { name: "Disconnect Discord", exact: true });
  await expect(dialog.getByRole("button", { name: "Disconnect Google", exact: true })).toBeEnabled();
  await expect(disconnect).toHaveAttribute("aria-pressed", "true");
  await disconnect.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("group", { name: "Disconnect Discord?", exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Disconnect Discord?", exact: true })).toBeVisible();
  await expect(dialog).toContainText("You will stay signed in.");
  await expect(dialog.getByRole("region", { name: "Connected sign-in providers" })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Your Gridz account", exact: true })).toBeVisible();
  await expect(disconnect).not.toHaveAttribute("title");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(mock.writes).toHaveLength(0);
  await disconnect.click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Disconnect Discord", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Disconnect / })).toHaveCount(0);
  const remaining = dialog.getByRole("button", { name: "Google connected", exact: true });
  await expect(remaining).toBeDisabled();
  await expect(remaining).toHaveAttribute("aria-pressed", "true");

  const removed = dialog.getByRole("button", { name: "Connect Discord", exact: true });
  await expect(removed).toBeEnabled();
  await expect(removed).toHaveAttribute("aria-pressed", "false");
  expect(mock.writes).toEqual([{ resource: "account", provider: "discord", method: "DELETE" }]);
});

test("disconnecting the provider used for login keeps the account open and the browser draft unchanged", async ({ page }) => {
  const mock = await mockAccount(page, { connections: [
    { provider: "google", name: "Test user" }, { provider: "discord", name: "Discord identity" },
  ] });
  await page.goto("./?source=imported");
  const before = await browserDraft(page);
  const dialog = await openAccount(page);
  const providers = dialog.getByRole("region", { name: "Connected sign-in providers", exact: true });
  await providers.getByRole("button", { name: "Disconnect Google", exact: true }).click();
  await expect(providers.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Your Gridz account", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await providers.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toHaveCount(0);
  await expect(providers.getByRole("button", { name: "Connect Google", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(providers.getByRole("button", { name: "Discord connected", exact: true })).toBeDisabled();
  await expect(providers.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  expect(mock.writes).toEqual([{ resource: "account", provider: "google", method: "DELETE" }]);
  expect(await browserDraft(page)).toEqual(before);
});

test("connected tiles retain unavailable providers without allowing sign-in lockout", async ({ page }) => {
  const mock = await mockAccount(page, { providers: ["google"], connections: [
    { provider: "google", name: "Test user" }, { provider: "discord", name: "Discord identity" },
  ] });
  await page.goto("./?source=imported");
  const dialog = await openAccount(page);
  const section = dialog.getByRole("region", { name: "Connected sign-in providers", exact: true });
  await expect(section.getByRole("button")).toHaveCount(2);
  const google = section.getByRole("button", { name: "Google connected", exact: true });
  await expect(google).toBeDisabled();
  await expect(google).toHaveAttribute("aria-pressed", "true");

  await expect(google).not.toHaveAttribute("title");
  await expect(section.getByRole("button", { name: "Disconnect Discord", exact: true })).toBeEnabled();
  expect(mock.writes).toHaveLength(0);
});

test("failed disconnect keeps the provider selected and displays the server error", async ({ page }) => {
  const mock = await mockAccount(page, { connections: [
    { provider: "google", name: "Test user" }, { provider: "discord", name: "Discord identity" },
  ] });
  await page.route("**/api/account/providers/discord", (route) =>
    route.fulfill({ status: 409, json: { error: "Provider changed. Try again." } }));
  await page.goto("./?source=imported");
  const dialog = await openAccount(page);
  await dialog.getByRole("button", { name: "Disconnect Discord", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Provider changed. Try again.");
  const discord = dialog.getByRole("button", { name: "Disconnect Discord", exact: true });
  await expect(discord).toHaveAttribute("aria-pressed", "true");
  await expect(discord).toBeEnabled();

  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(discord).toHaveAttribute("aria-pressed", "true");
  expect(mock.writes).toHaveLength(0);
});

for (const width of [320, 390, 1280]) {
  test(`account controls and destructive confirmations fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const mock = await mockAccount(page);
    const id = randomUUID();
    const presetId = randomUUID();
    mock.grids.set(id, { id, name: "Long saved grid ".repeat(4), updatedAt: new Date().toISOString() });
    mock.presets.set(presetId, {
      id: presetId, name: "A private style", public: false, owned: true, updatedAt: new Date().toISOString(),
    });
    await page.goto("./?source=imported");
    const dialog = await openAccount(page);
    await dialog.getByRole("button", { name: "Delete account", exact: true }).click();

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const library = await openLibrary(page);
    await library.getByLabel("Save name", { exact: true }).click({ trial: true });
    await library.getByRole("checkbox").check();
    await expect(library.getByRole("checkbox")).toBeChecked();

    const panel = page.locator("[data-modal-panel]");
    const dimensions = await panel.evaluate((element) => ({
      width: element.clientWidth, scroll: element.scrollWidth,
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(width);
    const mine = library.getByRole("region", { name: "My saved grids", exact: true });
    await mine.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(library.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await library.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(mock.grids.has(id)).toBe(true);
    await mine.getByRole("button", { name: "Delete", exact: true }).click();
    await library.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(mine).toContainText("Nothing saved here yet.");
    expect(mock.grids.has(id)).toBe(false);
    await expect(library.getByRole("region", { name: "Connected sign-in providers", exact: true })).toHaveCount(0);
    await expect(library.getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);
  });
}

for (const mobile of [false, true]) {
  (mobile ? touchTest : test)(`account ${mobile ? "mobile" : "desktop"} saves named reference-only grids and public/private settings presets`, async ({ page }) => {
    const mock = await mockAccount(page);
    await page.goto("./?source=imported");
    await page.locator("#replace-upload").setInputFiles({
      name: "local.jpg", mimeType: "image/jpeg", buffer: await readFile(image),
    });
    await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
    const dialog = await openLibrary(page);
    await dialog.getByLabel("Save name", { exact: true }).fill("My grid");
    await dialog.getByRole("button", { name: "Save current grid as new", exact: true }).click();
    const mine = dialog.getByRole("region", { name: "My saved grids", exact: true });
    await expect(mine).toContainText("My grid");
    const gridWrite = mock.writes.find((write) => write.resource === "grids");
    expect(gridWrite.body.document.localAssetIds).toHaveLength(1);
    expect(gridWrite.body.document.assets).toEqual([]);
    expect(JSON.stringify(gridWrite.body)).not.toMatch(/blob:|data:image|"src"|"source"/);
    expect(gridWrite.headers["x-grids-request"]).toBe("1");
    await dialog.getByLabel("Save name", { exact: true }).fill("Shared style");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Save settings as new preset", exact: true }).click();
    const publicSection = dialog.getByRole("region", { name: "Shared presets", exact: true });
    await expect(publicSection).toContainText("Shared style");
    const presetWrite = mock.writes.find((write) => write.resource === "presets");
    expect(presetWrite.body.public).toBe(true);
    expect(Object.keys(presetWrite.body.settings).sort()).toEqual(["exportSettings", "layout", "style", "version"]);
    expect(JSON.stringify(presetWrite.body.settings)).not.toMatch(/assetId|"cells"|"heading"|"src"|"assets"/);
    const ownPresets = dialog.getByRole("region", { name: "My presets", exact: true });
    await ownPresets.getByRole("button", { name: "Make private", exact: true }).click();
    await expect(publicSection).not.toContainText("Shared style");
    await mine.getByRole("button", { name: "Replace", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => mock.writes.filter((write) => write.method === "PUT" && write.resource === "grids").length).toBe(1);
    expect(mock.writes.at(-1).headers["if-match"]).toBeTruthy();
    await mine.getByRole("button", { name: "Load", exact: true }).click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(mine).toContainText("My grid");
    await mine.getByRole("button", { name: "Load", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
    await page.reload();
    await signOut(page);
    const again = await openLibrary(page);
    await expect(again.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
    await expect(again.getByRole("region", { name: "My saved grids" })).toHaveCount(0);
    await again.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
    expect(await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("grids-client-v1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new Promise((resolve, reject) => {
        const transaction = database.transaction("images", "readonly");
        const count = transaction.objectStore("images").count();
        count.onsuccess = () => { database.close(); resolve(count.result); };
        count.onerror = () => reject(count.error);
      });
    })).toBe(1);
  });
}

test("account reference grids restore images from providers and export without uploading or persisting image bytes", async ({ page }) => {
  const mock = await mockAccount(page);
  const file = await readFile(image);
  await page.route("https://upload.wikimedia.org/**", (route) => route.fulfill({
    contentType: "image/jpeg", body: file, headers: { "Access-Control-Allow-Origin": "*" },
  }));
  await page.goto("./?source=imported");
  await page.locator("#upload").setInputFiles({ name: "temporary.jpg", mimeType: "image/jpeg", buffer: file });
  const dialog = await openLibrary(page);
  await dialog.getByLabel("Save name", { exact: true }).fill("Reference grid");
  await dialog.getByRole("button", { name: "Save current grid as new", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "My saved grids" })).toContainText("Reference grid");
  const saved = [...mock.grids.values()][0];
  const remoteId = randomUUID();
  saved.document.localAssetIds = [];
  saved.document.assets = [{
    id: remoteId, title: "Remote example", category: "Imported",
    provenance: {
      provider: "commons", entityId: "123",
      sourcePage: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      originalUrl: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
      creator: "Example", license: "Public domain",
      licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    },
  }];
  saved.document.grid.cells[0].assetId = remoteId;
  saved.document.grid.cells[0].title = "Remote caption";
  await dialog.getByRole("region", { name: "My saved grids" }).getByRole("button", { name: "Load", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const remote = page.locator("#board-grid img").first();
  await expect(remote).toHaveAttribute("src", saved.document.assets[0].provenance.originalUrl);
  await expect.poll(() => remote.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Export grid", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download image", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await readFile(await download.path())).not.toHaveLength(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(page.locator("#board-grid img").first()).toHaveAttribute("src", saved.document.assets[0].provenance.originalUrl);
  await expect.poll(() => page.locator("#board-grid img").first().evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
});

test("account failures are visible and do not break guest editing", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { error: "Account service unavailable" } }));
  await page.goto("./?source=imported&auth=failed");
  const dialog = page.getByRole("dialog", { name: "Log in", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Account service unavailable");
  await expect(page.locator("[data-sonner-toast]").first()).toContainText("Sign-in or provider connection failed");
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator("#board-grid")).toBeVisible();
  await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
  expect(new URL(page.url()).searchParams.has("auth")).toBe(false);
});

test("account shared presets apply for guests without publishing captions or replacing local images", async ({ page }) => {
  const mock = await mockAccount(page);
  await page.goto("./?source=imported");
  await page.locator("#replace-upload").setInputFiles({
    name: "local.jpg", mimeType: "image/jpeg", buffer: await readFile(image),
  });
  let dialog = await openLibrary(page);
  await dialog.getByLabel("Save name", { exact: true }).fill("Two columns");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Save settings as new preset", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Shared presets" })).toContainText("Two columns");
  const preset = [...mock.presets.values()][0];
  preset.settings.layout = { rows: 1, columns: 2 };
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Close toast", exact: true }).click();
  await signOut(page);
  dialog = await openLibrary(page);
  const shared = dialog.getByRole("region", { name: "Shared presets" });
  await expect(shared.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await expect(shared.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await shared.getByRole("button", { name: "Apply", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#board-grid .grid-cell")).toHaveCount(2);
  await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(page.locator("#board-grid .grid-cell")).toHaveCount(2);
  dialog = await openLibrary(page);
  await expect(dialog.getByRole("link", { name: "Continue with Google", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Log in", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Log in", exact: true });
  await expect(dialog.getByRole("link", { name: "Continue with Google", exact: true }))
    .toHaveAttribute("href", /\/api\/auth\/google\/start$/);
  await expect(dialog.getByRole("link", { name: "Continue with Facebook", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Continue with Discord", exact: true })).toBeVisible();
});

test("account grids warn about unavailable local uploads but preserve captions and layout", async ({ page }) => {
  const mock = await mockAccount(page);
  await page.goto("./?source=imported");
  const dialog = await openLibrary(page);
  await dialog.getByLabel("Save name", { exact: true }).fill("Missing local");
  await dialog.getByRole("button", { name: "Save current grid as new", exact: true }).click();
  const mine = dialog.getByRole("region", { name: "My saved grids", exact: true });
  await expect(mine).toContainText("Missing local");
  const saved = [...mock.grids.values()][0];
  const localId = randomUUID();
  saved.document.localAssetIds = [localId];
  saved.document.grid.cells[0].assetId = localId;
  saved.document.grid.cells[0].title = "Keep this caption";
  await mine.getByRole("button", { name: "Load", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Some local images are unavailable" })).toBeVisible();
  await expect(page.locator("#board-grid .grid-cell")).toHaveCount(9);
  await expect(page.locator("#board-grid img")).toHaveCount(0);
  await expect(page.locator("#board-grid .cell-heading").first()).toHaveValue("Keep this caption");
});
