import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const image = new URL("./fixtures/assets/DC - Kite Man.jpg", import.meta.url);
const touchTest = test.extend({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
async function mockAccount(
  page,
  {
    signedIn = true,
    provider = "google",
    providers = ["google", "facebook", "discord"],
    connections,
    pendingMerge = null,
  } = {},
) {
  let user = signedIn
    ? { id: randomUUID(), name: "Test user", provider }
    : null;
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
    if (resource === "session")
      return json({
        user,
        providers,
        connections: user ? state.connections : [],
        pendingMerge: user ? state.pendingMerge : null,
      });
    if (resource === "auth" && parts[4] === "link") {
      writes.push({
        resource,
        provider: id,
        method,
        headers: request.headers(),
        body: request.postDataJSON(),
      });
      return json({
        url: "https://discord.com/oauth2/authorize?client_id=test",
      });
    }
    if (resource === "account" && id === "providers") {
      const provider = parts[4];
      state.connections = state.connections.filter(
        (connection) => connection.provider !== provider,
      );
      if (user.provider === provider)
        user = {
          ...user,
          provider: state.connections.find((connection) =>
            providers.includes(connection.provider),
          ).provider,
        };
      writes.push({ resource, provider, method });
      return route.fulfill({ status: 204 });
    }
    if (resource === "account" && id === "merge") {
      writes.push({
        resource,
        method,
        body: method === "POST" ? request.postDataJSON() : undefined,
      });
      if (method === "POST") {
        state.connections.push(
          ...state.pendingMerge.providers.map((provider) => ({
            provider,
            name: state.pendingMerge.name,
          })),
        );
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
        return json(
          item && resource === "presets"
            ? { ...item, owned: Boolean(user) && item.owned }
            : item,
          item ? 200 : 404,
        );
      }
      const visible = [...items.values()].filter((item) =>
        url.searchParams.get("scope") === "public" ? item.public : true,
      );
      return json({
        items: visible.map(({ document, settings, ...summary }) =>
          resource === "presets"
            ? { ...summary, owned: Boolean(user) && summary.owned }
            : summary,
        ),
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
  return {
    writes,
    reads,
    grids,
    presets,
    state,
    expireSession: () => {
      user = null;
    },
  };
}
async function openAccount(page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account", exact: true });
  await expect(
    dialog.getByRole("region", {
      name: "Connected sign-in providers",
      exact: true,
    }),
  ).toBeVisible();
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
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Signed out." });
  await toast.getByRole("button", { name: "Close toast", exact: true }).click();
  await expectGuestMenu(page);
}
async function expectGuestMenu(page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Log in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Account", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}
async function browserDraft(page) {
  await expect(page.locator("#save-status")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("grids-client-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const { document, images } = await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          ["documents", "images"],
          "readonly",
        );
        const document = transaction.objectStore("documents").get("guest");
        const images = transaction.objectStore("images").getAll();
        transaction.oncomplete = () =>
          resolve({ document: document.result, images: images.result });
        transaction.onerror = () => reject(transaction.error);
      });
      return {
        document,
        images: await Promise.all(
          images.map(async ({ id, blob }) => ({
            id,
            hash: [
              ...new Uint8Array(
                await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
              ),
            ],
          })),
        ),
      };
    } finally {
      database.close();
    }
  });
}

async function presetDraft(page) {
  const mock = await mockAccount(page);
  let samples = 0;
  const sample = await readFile(image);
  await page.route(
    /https:\/\/(?:iiif\.wellcomecollection\.org|iiif\.micr\.io)\//,
    async (route) => {
      samples++;
      await route.fulfill({
        contentType: "image/jpeg",
        body: sample,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    },
  );
  await page.goto("./");
  await page.locator("#replace-upload").setInputFiles({
    name: "Keep this image.jpg",
    mimeType: "image/jpeg",
    buffer: await readFile(image),
  });
  await expect
    .poll(async () => (await browserDraft(page)).images.length)
    .toBe(1);
  await page
    .getByRole("button", { name: "Add image to cell 1", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Choose image", exact: true })
    .getByRole("button", { name: "Use Keep this image", exact: true })
    .click();
  await expect(page.locator("#board-grid img").first()).toBeVisible();
  const before = await browserDraft(page);
  return { mock, before, samples: () => samples };
}

test("theme gallery groups original headings and sorts shapes and captions without moving customized themes", async ({
  page,
}) => {
  await presetDraft(page);
  await page.getByRole("tab", { name: "Themes", exact: true }).click();
  const gallery = page.getByRole("region", {
    name: "Starting points",
    exact: true,
  });
  await expect(gallery.getByRole("heading")).toHaveText([
    "With heading",
    "Without heading",
  ]);
  const groups = [
    [
      "With heading",
      [
        "Midnight squares",
        "Soft pastel",
        "Deep ocean",
        "Dusty rose",
        "Instant prints",
        "Scrapbook",
        "Object catalogue",
        "Panorama gallery",
        "Spotlight gallery",
        "Wide collection",
        "Postcards",
        "Warm gallery",
        "Botanical collection",
        "Portrait gallery",
        "Terracotta",
        "Balanced frames",
        "Editorial",
        "Museum collection",
        "Visual story",
        "Pop collection",
      ],
    ],
    [
      "Without heading",
      ["Contact sheet", "Seamless collage", "Minimal white", "Filmstrip"],
    ],
  ];
  const checkGroups = async () => {
    for (const [name, themes] of groups) {
      const section = gallery.getByRole("region", { name, exact: true });
      await expect(section.getByRole("listitem")).toHaveCount(themes.length);
      expect(
        await section
          .getByRole("button", { name: /^Preview / })
          .evaluateAll((buttons) =>
            buttons.map((button) => button.getAttribute("aria-label")),
          ),
      ).toEqual(themes.map((theme) => `Preview ${theme}`));
    }
  };
  await checkGroups();
  await page
    .getByRole("button", { name: "Preview Warm gallery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Show heading", { exact: true }).click();
  await page.getByRole("radio", { name: "Square", exact: true }).click();
  await page.getByRole("tab", { name: "Themes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Preview Warm gallery", exact: true }),
  ).toHaveAttribute("data-customized", "");
  await checkGroups();
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Themes", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await checkGroups();
});

test("theme thumbnail failures are visible without blocking the theme gallery", async ({
  page,
}) => {
  await mockAccount(page);
  await page.route(
    /https:\/\/(?:iiif\.wellcomecollection\.org|iiif\.micr\.io)\//,
    (route) =>
      route.fulfill({
        status: 503,
        body: "Image service unavailable",
        headers: { "Access-Control-Allow-Origin": "*" },
      }),
  );
  await page.goto("./?panel=themes");
  const tile = page.getByRole("button", {
    name: "Preview Warm gallery",
    exact: true,
  });
  await tile.scrollIntoViewIfNeeded();
  await expect(tile.locator("[data-theme-thumbnail]")).toHaveAttribute(
    "data-thumbnail-state",
    "error",
  );
  await expect(tile).toContainText("Preview unavailable");
  await expect(tile).toBeEnabled();
  await tile.click();
  await expect(page.locator("[data-preset-preview]")).toBeVisible();
  await page
    .getByRole("button", { name: "Back to my grid", exact: true })
    .click();
  await expect(page.locator("[data-preset-preview]")).toHaveCount(0);
});

test("preset gallery tiles preview only on activation and applying preserves content", async ({
  page,
}) => {
  const { before, samples } = await presetDraft(page);
  expect(samples()).toBe(0);
  await expect(page.getByRole("tab")).toHaveText([
    "Themes",
    "Images",
    "Settings",
  ]);
  await page.getByRole("tab", { name: "Themes", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Starting points", exact: true })
      .getByRole("listitem"),
  ).toHaveCount(24);
  const tile = page.getByRole("button", {
    name: "Preview Warm gallery",
    exact: true,
  });
  await tile.scrollIntoViewIfNeeded();
  await expect(tile.locator("[data-theme-thumbnail]")).toHaveAttribute(
    "data-thumbnail-state",
    "ready",
  );
  expect(samples()).toBeGreaterThan(0);
  await expect(tile).not.toContainText("Warm gallery");
  await expect(tile).toHaveAttribute("title", "Warm gallery");
  await expect(
    page.getByRole("region", { name: "Starting points", exact: true }),
  ).not.toContainText(/\d+\s*×\s*\d+/);
  await expect(
    page
      .getByRole("region", { name: "Themes", exact: true })
      .getByRole("button", { name: /^Apply / }),
  ).toHaveCount(0);
  const frame = tile.locator("..").locator("[data-cell-image-frame] rect");
  await page.mouse.move(0, 0);
  const stroke = await frame.evaluate(
    (element) => getComputedStyle(element).stroke,
  );
  await tile.hover();
  await expect(frame).not.toHaveCSS("stroke", stroke);
  await expect(frame).toHaveCSS("stroke-dasharray", "none");
  await tile.focus();
  await expect(page.locator("[data-preset-preview]")).toHaveCount(0);
  await tile.click();
  await expect(page.locator("[data-preset-preview]")).toContainText(
    "Warm gallery",
  );
  await expect(tile.locator("..")).toHaveAttribute("data-selected", "");
  await expect(tile).toHaveAttribute("title", "Preview: Warm gallery");
  await expect(page.locator("[data-theme-tile][data-selected]")).toHaveCount(1);
  await expect(page.locator("#board-grid .image-card")).toHaveCount(
    before.document.grid.rows * before.document.grid.columns,
  );
  await expect(page.locator("#export-grid-header")).toBeDisabled();
  await expect(page.locator(".canvas-area")).toHaveAttribute("inert", "");
  await page.waitForTimeout(1200);
  expect(await browserDraft(page)).toEqual(before);
  await page.mouse.move(50, 100);
  await expect(page.locator("[data-preset-preview]")).toBeVisible();
  await expect(tile.locator("..")).toHaveAttribute("data-selected", "");
  expect(await browserDraft(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-preset-preview]")).toHaveCount(0);
  await tile.focus();
  await expect(page.locator("[data-preset-preview]")).toHaveCount(0);
  await tile.press("Space");
  await expect(page.locator("[data-preset-preview]")).toBeVisible();
  await page
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  const after = await browserDraft(page);
  expect(after.images).toEqual(before.images);
  expect(after.document.assets).toEqual(before.document.assets);
  expect(after.document.grid.cells[0]).toEqual(before.document.grid.cells[0]);
  expect(after.document.grid.rows).toBe(before.document.grid.rows);
  expect(after.document.grid.columns).toBe(before.document.grid.columns);
  expect(after.document.grid.cells).toEqual(before.document.grid.cells);
  expect(JSON.stringify(after)).not.toContain("preset-preview");
  await expect(tile).toHaveText("");
  await expect(tile).toBeEnabled();
  await expect(tile).toHaveAttribute("data-applied", "");
  await expect(tile.locator("[data-theme-thumbnail] img")).toHaveCount(1);
  await expect(tile.locator(".lucide-layout-grid")).toHaveCount(0);
  await expect(tile.locator(".lucide-check")).toHaveCount(0);
  const otherTile = page.getByRole("button", {
    name: "Preview Midnight squares",
    exact: true,
  });
  await otherTile.click();
  await expect(page.locator("[data-preset-preview]")).toContainText(
    "Midnight squares",
  );
  await expect(otherTile.locator("..")).toHaveAttribute("data-selected", "");
  await expect(tile.locator("..")).not.toHaveAttribute("data-selected", "");
  await expect(page.locator("[data-theme-tile][data-selected]")).toHaveCount(1);
  await expect(tile).toHaveAttribute("data-applied", "");
  await expect(otherTile).not.toHaveAttribute("data-applied", "");
  await page
    .getByRole("button", { name: "Back to my grid", exact: true })
    .click();
  await expect(tile.locator("..")).toHaveAttribute("data-selected", "");
  await expect(otherTile.locator("..")).not.toHaveAttribute(
    "data-selected",
    "",
  );
  await page.reload();
  await expect(page.locator("#board-grid .image-card")).toHaveCount(
    before.document.grid.cells.length,
  );
  await expect(page.locator("#board-grid img").first()).toBeVisible();
  await expect(tile).toHaveAttribute("data-applied", "");
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await expect(tile).toHaveAttribute("data-applied", "");
  await tile.click();
  await expect(page.locator("#board-grid .image-card")).toHaveCount(8);
  await page
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await expect
    .poll(async () => {
      const { grid } = (await browserDraft(page)).document;
      return [grid.rows, grid.columns];
    })
    .toEqual([2, 4]);
  await expect(tile).toHaveAttribute("data-applied", "");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.locator("#background-value").fill("#112233");
  await page.locator("#background-value").press("Enter");
  await page.getByRole("tab", { name: "Themes", exact: true }).click();
  await expect(tile).toHaveAttribute("data-applied", "");
  await expect(tile).toHaveAttribute("data-customized", "");
  await expect(tile).toHaveText("");
  const controls = page
    .locator("[data-theme-tile]")
    .filter({
      has: page.getByRole("button", {
        name: "Preview Warm gallery",
        exact: true,
      }),
    });
  await expect(
    controls.getByRole("button", { name: "Reset", exact: true }),
  ).toBeVisible();
});

touchTest(
  "preset gallery mobile preview reveals canvas and can close or apply without losing uploads",
  async ({ page }) => {
    const { before } = await presetDraft(page);
    await page.getByRole("tab", { name: "Themes", exact: true }).click();
    await page
      .getByRole("button", { name: "Preview Warm gallery", exact: true })
      .tap();
    await expect(page.locator("[data-preset-preview]")).toBeVisible();
    expect(await browserDraft(page)).toEqual(before);
    await page
      .getByRole("button", { name: "Back to my grid", exact: true })
      .tap();
    await expect(page.locator("[data-preset-preview]")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Preview Warm gallery", exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Apply settings", exact: true })
      .tap();
    const after = await browserDraft(page);
    expect(after.images).toEqual(before.images);
    expect(after.document.assets).toEqual(before.document.assets);
    expect(after.document.grid.cells[0]).toEqual(before.document.grid.cells[0]);
    expect(after.document.grid.rows).toBe(before.document.grid.rows);
    expect(after.document.grid.columns).toBe(before.document.grid.columns);
    await expect(page.locator("[data-preset-preview]")).toHaveCount(0);
  },
);

test("preset customizations are independent, persistent, preview-safe and individually resettable", async ({
  page,
}) => {
  const { before, mock } = await presetDraft(page);
  const preferences = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("grids-ui-v1")).presetCustomizations,
    );
  const tile = (name) =>
    page.getByRole("button", { name: `Preview ${name}`, exact: true });
  const controls = (name) =>
    page.locator("[data-theme-tile]").filter({ has: tile(name) });
  const customize = async (name, color) => {
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.locator("#background-value").fill(color);
    await page.locator("#background-value").press("Enter");
    await page.getByRole("tab", { name: "Themes", exact: true }).click();
    await expect(tile(name)).toHaveAttribute("data-customized", "");
    await expect(
      controls(name).getByRole("button", { name: "Reset", exact: true }),
    ).toBeVisible();
  };
  await page.getByRole("tab", { name: "Themes", exact: true }).click();
  await tile("Warm gallery").click();
  await expect(
    controls("Warm gallery").getByRole("button", {
      name: "Reset",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await expect(
    controls("Warm gallery").getByRole("button", {
      name: "Reset",
      exact: true,
    }),
  ).toHaveCount(0);
  await customize("Warm gallery", "#123456");
  await expect
    .poll(
      async () => (await preferences())["starter:gallery"]?.style.background,
    )
    .toBe("#123456");
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await tile("Midnight squares").click();
  await expect
    .poll(async () => (await browserDraft(page)).document.grid.background)
    .toBe("#123456");
  await page
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await expect(
    controls("Warm gallery").getByRole("button", {
      name: "Reset",
      exact: true,
    }),
  ).toHaveCount(0);
  await customize("Midnight squares", "#223344");
  await tile("Warm gallery").click();
  await expect(page.locator("[data-image-canvas-background]")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  await expect(page.locator("#board-grid .image-card")).toHaveCount(6);
  expect((await browserDraft(page)).document.grid.background).toBe("#223344");
  await page
    .getByRole("button", { name: "Back to my grid", exact: true })
    .click();
  expect((await browserDraft(page)).document.grid.background).toBe("#223344");
  await tile("Warm gallery").click();
  await page
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await expect
    .poll(async () => (await browserDraft(page)).document.grid.background)
    .toBe("#123456");
  await page.reload();
  await expect(tile("Warm gallery")).toHaveAttribute("data-applied", "");
  await expect(
    controls("Warm gallery").getByRole("button", {
      name: "Reset",
      exact: true,
    }),
  ).toBeVisible();
  const saved = await preferences();
  expect(Object.keys(saved).sort()).toEqual([
    "starter:gallery",
    "starter:midnight",
  ]);
  expect(saved["starter:midnight"].style.background).toBe("#223344");
  expect(JSON.stringify(saved)).not.toMatch(
    /assetId|"cells"|"heading"|"src"|"assets"|preset-preview|blob:/,
  );
  const beforeReset = await browserDraft(page);
  await controls("Warm gallery")
    .getByRole("button", { name: "Reset", exact: true })
    .click();
  await expect
    .poll(async () => (await browserDraft(page)).document.grid.background)
    .toBe("#f5f1e8");
  await expect(
    controls("Warm gallery").getByRole("button", {
      name: "Reset",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect
    .poll(async () => Object.keys(await preferences()))
    .toEqual(["starter:midnight"]);
  const after = await browserDraft(page);
  expect(after.document.grid.cells).toEqual(beforeReset.document.grid.cells);
  expect(after.document.grid.overflow).toEqual(
    beforeReset.document.grid.overflow,
  );
  expect([after.document.grid.rows, after.document.grid.columns]).toEqual([
    2, 3,
  ]);
  expect(after.document.assets).toEqual(before.document.assets);
  expect(after.images).toEqual(before.images);
  await page.reload();
  await expect(tile("Warm gallery")).not.toHaveAttribute("data-customized", "");
  await tile("Midnight squares").click();
  await expect(page.locator("[data-image-canvas-background]")).toHaveCSS(
    "background-color",
    "rgb(34, 51, 68)",
  );
  await page.keyboard.press("Escape");
  expect(mock.writes).toEqual([]);
});

for (const signedIn of [false, true]) {
  test(`preset gallery hides Library and cloud sections without touching saved data (${signedIn ? "account" : "guest"})`, async ({
    page,
  }) => {
    const mock = await mockAccount(page, { signedIn });
    const id = randomUUID();
    mock.grids.set(id, {
      id,
      name: "Existing saved grid",
      updatedAt: new Date().toISOString(),
    });
    mock.presets.set(id, {
      id,
      name: "Existing public preset",
      public: true,
      owned: true,
      updatedAt: new Date().toISOString(),
    });
    await page.goto("./?panel=presets");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Library", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    const gallery = page.getByRole("region", { name: "Themes", exact: true });
    await expect(
      gallery.getByRole("button", { name: /^Preview / }),
    ).toHaveCount(24);
    await expect(
      gallery.getByRole("region", { name: "My presets", exact: true }),
    ).toHaveCount(0);
    await expect(
      gallery.getByRole("region", { name: "Shared presets", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() =>
      history.replaceState(
        { ...history.state, gridsAccountView: "library" },
        "",
      ),
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Preview Warm gallery", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Library", exact: true }),
    ).toHaveCount(0);
    expect(mock.reads.every((resource) => resource === "session")).toBe(true);
    expect(mock.writes).toEqual([]);
    expect(mock.grids.size).toBe(1);
    expect(mock.presets.size).toBe(1);
  });
}

test("preset customization storage failures are reported explicitly", async ({
  page,
}) => {
  await mockAccount(page);
  await page.goto("./?panel=presets");
  await page
    .getByRole("button", { name: "Preview Warm gallery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-ui-v1")
        throw new DOMException("Storage full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.locator("#background-value").fill("#334455");
  await page.locator("#background-value").press("Enter");
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Browser preferences could not be saved" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await browserDraft(page)).document.grid.background)
    .toBe("#334455");
});

test("preset canvas palettes persist and match exported PNG backgrounds", async ({
  page,
}) => {
  await mockAccount(page);
  const file = await readFile(image);
  await page.route(
    /https:\/\/(?:iiif\.wellcomecollection\.org|iiif\.micr\.io)\//,
    (route) =>
      route.fulfill({
        contentType: "image/jpeg",
        body: file,
        headers: { "Access-Control-Allow-Origin": "*" },
      }),
  );
  await page.goto("./");
  await page.getByRole("tab", { name: "Themes", exact: true }).click();
  for (const name of ["Warm gallery", "Midnight squares"]) {
    await page
      .getByRole("button", { name: `Preview ${name}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Apply settings", exact: true })
      .click();
    await page.getByRole("button", { name: /^Edit grid heading:/ }).click();
    const heading = page.getByRole("textbox", {
      name: "Grid heading",
      exact: true,
    });
    await heading.fill("Themed header");
    await heading.press("Enter");
    const samples = await page.evaluate(() => {
      const canvas = document
        .querySelector("[data-preview-content]")
        .getBoundingClientRect();
      const band = document.querySelector(".board-export-heading");
      const card = document.querySelector(
        "#board-grid [data-drop-placeholder]",
      );
      const elements = [
        [
          document.querySelector("[data-image-canvas-background]"),
          canvas.left + 2,
          canvas.top + 2,
        ],
        [
          band,
          band.getBoundingClientRect().left + band.clientWidth / 2,
          band.getBoundingClientRect().top + 2,
        ],
        [
          card,
          card.getBoundingClientRect().left + card.clientWidth / 2,
          card.getBoundingClientRect().top + card.clientHeight / 2,
        ],
      ];
      return elements.map(([element, x, y]) => ({
        x: (x - canvas.left) / canvas.width,
        y: (y - canvas.top) / canvas.height,
        color: getComputedStyle(element)
          .backgroundColor.match(/\d+/g)
          .slice(0, 3)
          .map(Number),
      }));
    });
    const before = await browserDraft(page);
    await page.locator("#export-grid-header").click();
    const downloadReady = page.waitForEvent("download");
    await page
      .getByRole("dialog", { name: "Export grid", exact: true })
      .getByRole("button", { name: "Download image", exact: true })
      .click();
    const download = await downloadReady;
    const bytes = [...(await readFile(await download.path()))];
    const colors = await page.evaluate(
      async ({ bytes, samples }) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const colors = samples.map(({ x, y }) =>
          [
            ...context.getImageData(
              Math.floor(x * bitmap.width),
              Math.floor(y * bitmap.height),
              1,
              1,
            ).data,
          ].slice(0, 3),
        );
        bitmap.close();
        return colors;
      },
      { bytes, samples },
    );
    expect(colors, name).toEqual(samples.map((sample) => sample.color));
    await page.reload();
    await expect(page.locator("#board-grid")).toBeVisible();
    expect(await browserDraft(page)).toEqual(before);
  }
});

async function expectProvidersReachable(tiles, panel) {
  for (const tile of await tiles.all()) {
    await expect(tile).toBeInViewport();
    if (await tile.isEnabled()) await tile.click({ trial: true });
  }
  expect(
    await panel.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
}

for (const width of [260, 320, 390, 1280]) {
  test(`login providers remain accessible and reachable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAccount(page, { signedIn: false });
    await page.goto("./?source=imported");
    const dialog = await openLogin(page);
    for (const provider of ["Google", "Facebook", "Discord"]) {
      const link = dialog.getByRole("link", {
        name: `Continue with ${provider}`,
        exact: true,
      });
      await expect(link).toBeVisible();

      await expect(link).toHaveAttribute(
        "href",
        new RegExp(`/api/auth/${provider.toLowerCase()}/start$`),
      );
    }
    await expectProvidersReachable(
      dialog.getByRole("link", { name: /^Continue with / }),
      page.locator("[data-modal-panel]"),
    );
  });

  test(`provider controls expose connected state and remain reachable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAccount(page, {
      connections: [
        { provider: "google", name: "Google identity" },
        { provider: "discord", name: "Discord identity" },
      ],
    });
    await page.goto("./?source=imported");
    const dialog = await openAccount(page);
    const section = dialog.getByRole("region", {
      name: "Connected sign-in providers",
      exact: true,
    });
    await expect(section.getByRole("button")).toHaveCount(3);

    for (const provider of ["Google", "Discord"]) {
      const tile = section.getByRole("button", {
        name: `Disconnect ${provider}`,
        exact: true,
      });
      await expect(tile).toHaveAttribute("aria-pressed", "true");

      await expect(tile).toBeEnabled();
    }
    const facebook = section.getByRole("button", {
      name: "Connect Facebook",
      exact: true,
    });
    await expect(facebook).toHaveAttribute("aria-pressed", "false");

    await expect(facebook).toBeEnabled();
    await expect(section).not.toContainText("identity");
    await expectProvidersReachable(
      section.getByRole("button"),
      page.locator("[data-modal-panel]"),
    );
  });
}

test("login is provider-only and reopening it preserves focus and the browser draft", async ({
  page,
}) => {
  const mock = await mockAccount(page, { signedIn: false });
  await page.goto("./?source=imported");
  await expectGuestMenu(page);
  const before = await browserDraft(page);
  let dialog = await openLogin(page);
  await expect(
    dialog.getByRole("link", { name: /^Continue with/ }),
  ).toHaveCount(3);
  await expect(dialog.getByLabel("Save name", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("region", { name: "Connected sign-in providers" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Delete account", exact: true }),
  ).toHaveCount(0);
  expect(mock.reads.every((resource) => resource === "session")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Menu", exact: true }),
  ).toBeFocused();
  dialog = await openLogin(page);
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Menu", exact: true }),
  ).toBeFocused();
  expect(await browserDraft(page)).toEqual(before);
});

test("the hamburger menu supports keyboard navigation and keeps account management separate", async ({
  page,
}) => {
  const mock = await mockAccount(page);
  await page.goto("./");
  const menuButton = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menuButton).toHaveText("");

  await menuButton.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Account",
    "Information",
    "Sign out",
  ]);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitem", { name: "Account", exact: true }),
  ).toHaveAttribute("data-focus", "");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Account", exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Delete account", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Save name", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("region", { name: "Shared presets", exact: true }),
  ).toHaveCount(0);
  expect(mock.reads.every((resource) => resource === "session")).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(menuButton).toBeFocused();
});

test("sign-out failure stays signed in and a successful retry preserves local images", async ({
  page,
}) => {
  await mockAccount(page);
  await page.goto("./?source=imported");
  await page.locator("#replace-upload").setInputFiles({
    name: "local.jpg",
    mimeType: "image/jpeg",
    buffer: await readFile(image),
  });
  await expect(
    page.getByRole("button", { name: "Image options: local", exact: true }),
  ).toBeVisible();
  const before = await browserDraft(page);
  const failLogout = (route) =>
    route.fulfill({ status: 503, json: { error: "Sign out unavailable" } });
  await page.route("**/api/logout", failLogout);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByText("Sign out unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Menu", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close toast", exact: true }).click();
  await page.unroute("**/api/logout", failLogout);
  await signOut(page);
  expect(await browserDraft(page)).toEqual(before);
});

for (const width of [320, 1280]) {
  test(`account deletion confirms inline, cancels and recovers from errors at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAccount(page);
    await page.goto("./");
    await page.locator("#replace-upload").setInputFiles({
      name: "local.jpg",
      mimeType: "image/jpeg",
      buffer: await readFile(image),
    });
    const before = await browserDraft(page);
    const dialog = await openAccount(page);
    const section = dialog.getByRole("region", {
      name: "Account removal",
      exact: true,
    });
    const remove = section.getByRole("button", {
      name: "Delete account",
      exact: true,
    });
    await expect(remove).toHaveAttribute("aria-expanded", "false");
    await expect(section.getByRole("group")).toHaveCount(0);
    let deletions = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/account" &&
        request.method() === "DELETE"
      )
        deletions++;
    });
    await remove.click();
    const confirmation = section.getByRole("group");
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole("heading", {
        name: "Delete this data?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(confirmation).toContainText(
      "Deletes your account and all cloud saves permanently. Browser data is kept.",
    );
    await expect(remove).toHaveAttribute("aria-expanded", "true");
    await expect(
      dialog.getByRole("group", { name: "Your Gridz account", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("region", {
        name: "Connected sign-in providers",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);

    expect(deletions).toBe(0);
    await confirmation
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(confirmation).toHaveCount(0);
    await expect(remove).toHaveAttribute("aria-expanded", "false");
    expect(deletions).toBe(0);
    const failDelete = (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Account deletion unavailable." },
      });
    await page.route("**/api/account", failDelete);
    await remove.click();
    await confirmation
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Account deletion unavailable.",
    );
    await expect(remove).toBeEnabled();
    expect(deletions).toBe(1);
    await page.unroute("**/api/account", failDelete);
    await remove.click();
    await confirmation
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(deletions).toBe(2);
    expect(await browserDraft(page)).toEqual(before);
  });
}

for (const action of ["expire", "delete"]) {
  test(`header and account modal update when the session ends through ${action}`, async ({
    page,
  }) => {
    const mock = await mockAccount(page, {
      connections: [
        { provider: "google", name: "Test user" },
        { provider: "discord", name: "Other user" },
      ],
    });
    await page.goto("./?source=imported");
    const before = await browserDraft(page);
    const dialog = await openAccount(page);
    if (action === "expire") {
      mock.expireSession();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    } else {
      const target =
        action === "delete"
          ? dialog.getByRole("button", { name: "Delete account", exact: true })
          : dialog.getByRole("button", {
              name: "Disconnect Google",
              exact: true,
            });
      await target.click();
      await dialog
        .getByRole("button", { name: "Confirm", exact: true })
        .click();
    }
    await expect(dialog).toHaveCount(0);
    await expectGuestMenu(page);
    expect(await browserDraft(page)).toEqual(before);
  });
}

for (const signedIn of [false, true]) {
  for (const width of [260, 320, 390, 1280]) {
    test(`header actions do not overlap at ${width}px when ${signedIn ? "signed in" : "a guest"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockAccount(page, { signedIn });
      await page.goto("./");
      const header = page.locator("[data-canvas-header]");
      const account = header.getByRole("button", { name: "Menu", exact: true });
      await expect(account).toBeVisible();
      await expect
        .poll(
          async () =>
            (
              await header
                .getByRole("button", { name: "Export grid", exact: true })
                .boundingBox()
            ).x,
        )
        .toBeGreaterThanOrEqual(0);
      const buttons = [
        header.getByRole("button", { name: "Export grid", exact: true }),
        account,
        ...(width > 900
          ? [
              header.getByRole("button", {
                name: /^(Show sidebar|Close sidebar)$/,
              }),
            ]
          : []),
      ];
      let right = 0;
      for (const button of buttons) {
        const bounds = await button.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(right);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);

        right = bounds.x + bounds.width;
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}

for (const provider of ["google", "discord"]) {
  test(`account header is provider-neutral when signed in through ${provider}`, async ({
    page,
  }) => {
    await mockAccount(page, {
      provider,
      connections: [
        { provider: "google", name: "Google identity" },
        { provider: "discord", name: "Discord identity" },
      ],
    });
    await page.goto("./?source=imported");
    const dialog = await openAccount(page);
    const identity = dialog.getByRole("group", {
      name: "Your Gridz account",
      exact: true,
    });
    await expect(
      identity.getByText("Test user", { exact: true }),
    ).toBeVisible();
    await expect(
      identity.getByText("Your Gridz account", { exact: true }),
    ).toBeVisible();

    await expect(identity).not.toContainText(/Google|Discord|Connected with/);
    await expect(
      dialog.getByRole("button", { name: "Sign out", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Refresh", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("complementary")).toHaveCount(0);
    await expect(
      dialog.getByText(
        "Keep at least one available sign-in provider connected.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(
      dialog.getByText(
        "Sign in to this account using any connected provider.",
        { exact: false },
      ),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("navigation", {
        name: "Policies and support",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(dialog.getByLabel("Save name", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      dialog.getByRole("region", { name: "Shared presets", exact: true }),
    ).toHaveCount(0);
    const connections = dialog.getByRole("region", {
      name: "Connected sign-in providers",
      exact: true,
    });
    for (const name of ["Google", "Discord"]) {
      const tile = connections.getByRole("button", {
        name: `Disconnect ${name}`,
        exact: true,
      });
      await expect(tile).toHaveText(name);
      await expect(tile).toHaveAttribute("aria-pressed", "true");
    }
  });
}

test("connecting a provider redirects immediately through a protected POST and leaves the saved browser draft intact", async ({
  page,
}) => {
  const mock = await mockAccount(page);
  await page.route(
    "https://discord.com/oauth2/authorize?client_id=test",
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1>Provider authorization</h1>",
      }),
  );
  await page.goto("./?source=imported");
  await page.locator("#replace-upload").setInputFiles({
    name: "local.jpg",
    mimeType: "image/jpeg",
    buffer: await readFile(image),
  });
  await expect(page.locator("#save-status")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  const before = await browserDraft(page);
  expect(before.images).toHaveLength(1);
  const dialog = await openAccount(page);
  const connections = dialog.getByRole("region", {
    name: "Connected sign-in providers",
  });
  await expect(
    connections.getByRole("button", { name: /^Disconnect / }),
  ).toHaveCount(0);
  await expect(
    connections.getByRole("button", { name: "Connect Google", exact: true }),
  ).toHaveCount(0);
  await connections
    .getByRole("button", { name: "Connect Discord", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Provider authorization" }),
  ).toBeVisible();
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0]).toMatchObject({
    resource: "auth",
    provider: "discord",
    method: "POST",
    body: {},
  });
  expect(mock.writes[0].headers["x-grids-request"]).toBe("1");
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Account", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(page.locator("#save-status")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  expect(await browserDraft(page)).toEqual(before);
});

for (const provider of ["google", "facebook", "discord"]) {
  for (const width of [320, 1280]) {
    test(`${provider} linking disables repeat actions and restores the account on Back at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockAccount(page, {
        provider: provider === "google" ? "discord" : "google",
      });
      const name = provider[0].toUpperCase() + provider.slice(1);
      const authorizationUrl = `https://${provider}.example.test/authorize`;
      let releaseLink, linkStarted;
      const linkGate = new Promise((resolve) => {
        releaseLink = resolve;
      });
      const linking = new Promise((resolve) => {
        linkStarted = resolve;
      });
      let calls = 0;
      await page.route(`**/api/auth/${provider}/link`, async (route) => {
        calls++;
        expect(route.request().method()).toBe("POST");
        expect(route.request().headers()["x-grids-request"]).toBe("1");
        linkStarted();
        await linkGate;
        await route.fulfill({ json: { url: authorizationUrl } });
      });
      await page.route(authorizationUrl, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<h1>Provider authorization</h1>",
        }),
      );
      await page.goto("./?source=imported");
      const dialog = await openAccount(page);
      try {
        const connect = dialog.getByRole("button", {
          name: `Connect ${name}`,
          exact: true,
        });
        await connect.click();
        await linking;
        await expect(connect).toBeDisabled();
        await expect(
          dialog.getByRole("button", { name: "Confirm", exact: true }),
        ).toHaveCount(0);
        expect(calls).toBe(1);
      } finally {
        releaseLink();
      }
      await expect(
        page.getByRole("heading", { name: "Provider authorization" }),
      ).toBeVisible();
      await page.goBack();
      const restored = page.getByRole("dialog", {
        name: "Account",
        exact: true,
      });
      await expect(restored).toBeVisible();
      await expect(
        restored.getByRole("button", { name: `Connect ${name}`, exact: true }),
      ).toBeEnabled();
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
  test(`Back from ${provider} sign-in restores the login modal`, async ({
    page,
  }) => {
    await mockAccount(page, { signedIn: false });
    await page.route(`**/api/auth/${provider}/start`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1>Provider authorization</h1>",
      }),
    );
    await page.goto("./?source=imported");
    const before = await browserDraft(page);
    const dialog = await openLogin(page);
    const name = provider[0].toUpperCase() + provider.slice(1);
    await dialog
      .getByRole("link", { name: `Continue with ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Provider authorization" }),
    ).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: `Continue with ${name}`, exact: true }),
    ).toBeEnabled();
    expect(await browserDraft(page)).toEqual(before);
  });
}

test("failed direct provider connection displays the error without changing the account or browser draft", async ({
  page,
}) => {
  const mock = await mockAccount(page);
  await page.route("**/api/auth/discord/link", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Provider temporarily unavailable." },
    }),
  );
  await page.goto("./?source=imported");
  const before = await browserDraft(page);
  const dialog = await openAccount(page);
  const connect = dialog.getByRole("button", {
    name: "Connect Discord",
    exact: true,
  });
  await connect.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Provider temporarily unavailable.",
  );
  await expect(connect).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Confirm", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("group", { name: "Your Gridz account", exact: true }),
  ).toBeVisible();
  expect(mock.writes).toHaveLength(0);
  expect(await browserDraft(page)).toEqual(before);
});

for (const width of [320, 1280]) {
  test(`existing account merge review fits ${width}px and never merges automatically`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const pendingMerge = {
      id: randomUUID(),
      provider: "discord",
      name: "Incoming account",
      providers: ["discord", "facebook"],
      grids: 3,
      presets: 4,
    };
    const mock = await mockAccount(page, { pendingMerge });
    await page.goto("./?source=imported");
    await page.locator("#replace-upload").setInputFiles({
      name: "local.jpg",
      mimeType: "image/jpeg",
      buffer: await readFile(image),
    });
    await expect(page.locator("#save-status")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    const before = await browserDraft(page);
    await page.goto("./?source=imported&auth=merge");
    const dialog = page.getByRole("dialog", { name: "Account", exact: true });
    const review = dialog.getByRole("region", {
      name: "Merge existing accounts?",
    });
    await expect(review).toBeVisible();
    await expect(review).toContainText(
      "Incoming account (Discord, Facebook) already has 3 saved grids and 4 presets",
    );
    expect(mock.writes).toHaveLength(0);
    await expect(
      dialog.getByRole("button", { name: "Connect Discord", exact: true }),
    ).toBeDisabled();
    const bounds = await page
      .locator("[data-modal-panel]")
      .evaluate((element) => ({
        width: element.clientWidth,
        scroll: element.scrollWidth,
      }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    await review
      .getByRole("button", {
        name: "Merge accounts and keep all saves",
        exact: true,
      })
      .click();
    await expect(review).toHaveCount(0);
    expect(mock.writes).toEqual([
      { resource: "account", method: "POST", body: { id: pendingMerge.id } },
    ]);
    await expect(
      dialog.getByRole("button", { name: "Disconnect Discord", exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("button", { name: "Disconnect Facebook", exact: true }),
    ).toBeEnabled();
    expect(await browserDraft(page)).toEqual(before);
  });
}

test("merge cancellation and server conflicts are visible without changing the browser grid", async ({
  page,
}) => {
  const mock = await mockAccount(page, {
    pendingMerge: {
      id: randomUUID(),
      provider: "discord",
      name: "Another account",
      providers: ["discord"],
      grids: 1,
      presets: 0,
    },
  });
  await page.goto("./?source=imported&auth=merge");
  const dialog = page.getByRole("dialog", { name: "Account", exact: true });
  const review = dialog.getByRole("region", {
    name: "Merge existing accounts?",
  });
  await expect(review).toBeVisible();
  await page.route("**/api/account/merge", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Merge expired or changed. Connect the provider again." },
    }),
  );
  await review
    .getByRole("button", {
      name: "Merge accounts and keep all saves",
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Merge expired or changed",
  );
  await expect(review).toBeVisible();
  expect(mock.writes).toHaveLength(0);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(mock.writes).toEqual([
    { resource: "account", method: "DELETE", body: undefined },
  ]);
  await expect(page.locator(".grid-cell")).toHaveCount(9);
});

test("disconnect uses inline confirmation, cancellation is harmless and the final provider stays connected", async ({
  page,
}) => {
  const mock = await mockAccount(page, {
    connections: [
      { provider: "google", name: "Test user" },
      { provider: "discord", name: "Discord identity" },
    ],
  });
  await page.goto("./?source=imported");
  const dialog = await openAccount(page);
  const disconnect = dialog.getByRole("button", {
    name: "Disconnect Discord",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Disconnect Google", exact: true }),
  ).toBeEnabled();
  await expect(disconnect).toHaveAttribute("aria-pressed", "true");
  await disconnect.focus();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("group", { name: "Disconnect Discord?", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Disconnect Discord?", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText("You will stay signed in.");
  await expect(
    dialog.getByRole("region", { name: "Connected sign-in providers" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "Your Gridz account", exact: true }),
  ).toBeVisible();
  await expect(disconnect).not.toHaveAttribute("title");

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(mock.writes).toHaveLength(0);
  await disconnect.click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Disconnect Discord", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: /^Disconnect / }),
  ).toHaveCount(0);
  const remaining = dialog.getByRole("button", {
    name: "Google connected",
    exact: true,
  });
  await expect(remaining).toBeDisabled();
  await expect(remaining).toHaveAttribute("aria-pressed", "true");

  const removed = dialog.getByRole("button", {
    name: "Connect Discord",
    exact: true,
  });
  await expect(removed).toBeEnabled();
  await expect(removed).toHaveAttribute("aria-pressed", "false");
  expect(mock.writes).toEqual([
    { resource: "account", provider: "discord", method: "DELETE" },
  ]);
});

test("disconnecting the provider used for login keeps the account open and the browser draft unchanged", async ({
  page,
}) => {
  const mock = await mockAccount(page, {
    connections: [
      { provider: "google", name: "Test user" },
      { provider: "discord", name: "Discord identity" },
    ],
  });
  await page.goto("./?source=imported");
  const before = await browserDraft(page);
  const dialog = await openAccount(page);
  const providers = dialog.getByRole("region", {
    name: "Connected sign-in providers",
    exact: true,
  });
  await providers
    .getByRole("button", { name: "Disconnect Google", exact: true })
    .click();
  await expect(
    providers.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "Your Gridz account", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await providers.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Menu", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toHaveCount(0);
  await expect(
    providers.getByRole("button", { name: "Connect Google", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    providers.getByRole("button", { name: "Discord connected", exact: true }),
  ).toBeDisabled();
  await expect(
    providers.getByRole("button", { name: "Confirm", exact: true }),
  ).toHaveCount(0);
  expect(mock.writes).toEqual([
    { resource: "account", provider: "google", method: "DELETE" },
  ]);
  expect(await browserDraft(page)).toEqual(before);
});

test("connected tiles retain unavailable providers without allowing sign-in lockout", async ({
  page,
}) => {
  const mock = await mockAccount(page, {
    providers: ["google"],
    connections: [
      { provider: "google", name: "Test user" },
      { provider: "discord", name: "Discord identity" },
    ],
  });
  await page.goto("./?source=imported");
  const dialog = await openAccount(page);
  const section = dialog.getByRole("region", {
    name: "Connected sign-in providers",
    exact: true,
  });
  await expect(section.getByRole("button")).toHaveCount(2);
  const google = section.getByRole("button", {
    name: "Google connected",
    exact: true,
  });
  await expect(google).toBeDisabled();
  await expect(google).toHaveAttribute("aria-pressed", "true");

  await expect(google).not.toHaveAttribute("title");
  await expect(
    section.getByRole("button", { name: "Disconnect Discord", exact: true }),
  ).toBeEnabled();
  expect(mock.writes).toHaveLength(0);
});

test("failed disconnect keeps the provider selected and displays the server error", async ({
  page,
}) => {
  const mock = await mockAccount(page, {
    connections: [
      { provider: "google", name: "Test user" },
      { provider: "discord", name: "Discord identity" },
    ],
  });
  await page.route("**/api/account/providers/discord", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Provider changed. Try again." },
    }),
  );
  await page.goto("./?source=imported");
  const dialog = await openAccount(page);
  await dialog
    .getByRole("button", { name: "Disconnect Discord", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Provider changed. Try again.",
  );
  const discord = dialog.getByRole("button", {
    name: "Disconnect Discord",
    exact: true,
  });
  await expect(discord).toHaveAttribute("aria-pressed", "true");
  await expect(discord).toBeEnabled();

  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(discord).toHaveAttribute("aria-pressed", "true");
  expect(mock.writes).toHaveLength(0);
});

for (const width of [320, 390, 1280]) {
  test(`account controls and destructive confirmations fit a ${width}px viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAccount(page);
    await page.goto("./?source=imported");
    const dialog = await openAccount(page);
    await dialog
      .getByRole("button", { name: "Delete account", exact: true })
      .click();

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const panel = page.locator("[data-modal-panel]");
    const dimensions = await panel.evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(width);
    await expect(
      dialog.getByRole("region", { name: "Shared presets", exact: true }),
    ).toHaveCount(0);
    await expect(dialog.getByLabel("Save name", { exact: true })).toHaveCount(
      0,
    );
  });
}

test("account failures are visible and do not break guest editing", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Account service unavailable" },
    }),
  );
  await page.goto("./?source=imported&auth=failed");
  const dialog = page.getByRole("dialog", { name: "Log in", exact: true });
  await expect(dialog.getByRole("alert")).toContainText(
    "Account service unavailable",
  );
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(
    "Sign-in or provider connection failed",
  );
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(page.locator("#board-grid")).toBeVisible();
  await expect(page.locator("#save-status")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  expect(new URL(page.url()).searchParams.has("auth")).toBe(false);
});
