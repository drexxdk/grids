import { test, expect } from "@playwright/test";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { generateSW, getManifest } from "workbox-build";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const touchTest = test.extend({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const scrollbarTest = test.extend({
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});
const nativeTouchTest = scrollbarTest.extend({
  isMobile: true,
  hasTouch: true,
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: { user: null, providers: [], connections: [], pendingMerge: null },
    }),
  );
});

function sidebarToggle(page, expanded = false) {
  return page
    .getByRole("group", { name: "Editor panels", exact: true })
    .getByRole("button", { name: /^(Show sidebar|Close sidebar)$/, expanded });
}

async function setEditorViewport(page, size) {
  await page.setViewportSize(size);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector(".app-layout")
            ?.getAnimations()
            .filter((animation) => animation.playState === "running").length ??
          0,
      ),
    )
    .toBe(0);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function tabThroughTo(page, target, maximum = 40) {
  for (let step = 0; step < maximum; step++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    expect(
      await page.evaluate(() => document.activeElement?.disabled),
    ).not.toBe(true);
  }
  await expect(target).toBeFocused();
}
let comicFixtureModule;
async function storageModuleUrl() {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL("../src/storage.ts", import.meta.url)),
        formats: ["es"],
        fileName: "storage",
      },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find((entry) => entry.type === "chunk" && entry.isEntry);
  return `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`;
}
async function localDatabase(page, operation = "read", document = null) {
  return page.evaluate(
    ({ operation, document }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("grids-client-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["documents", "images"],
            operation === "read" ? "readonly" : "readwrite",
          );
          const documents = transaction.objectStore("documents");
          const images = transaction.objectStore("images");
          const result = {};
          if (operation === "read") {
            const saved = documents.get("guest");
            saved.onsuccess = () => {
              result.document = saved.result;
            };
            const media = images.getAll();
            media.onsuccess = () => {
              result.images = media.result.map(({ id, blob }) => ({
                id,
                isBlob: blob instanceof Blob,
                size: blob.size,
                type: blob.type,
              }));
            };
          } else if (operation === "seed") {
            documents.put(document.workspace);
            for (const image of document.images)
              images.put({
                id: image.id,
                blob: new Blob([new Uint8Array(image.bytes)], {
                  type: "image/jpeg",
                }),
              });
          } else if (operation === "write") documents.put(document);
          else if (operation === "delete") documents.delete("guest");
          else if (operation === "delete-image") images.delete(document.id);
          else if (operation === "clear") {
            documents.clear();
            images.clear();
          }
          transaction.oncomplete = () => {
            database.close();
            resolve(result);
          };
          transaction.onabort = transaction.onerror = () => {
            database.close();
            reject(
              transaction.error ?? new Error("Local database request failed."),
            );
          };
        };
      }),
    { operation, document },
  );
}

async function savedWorkspace(page) {
  await expect(page.locator("#save-status")).toHaveText(
    "Saved in this browser",
  );
  return (await localDatabase(page)).document;
}

async function openSidebarPanel(page, name) {
  await expect(page.locator("#board-grid")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Editor panels", exact: true }),
  ).toBeVisible();
  const sidebar = page.locator("[data-editor-sidebar]");
  if (await sidebarToggle(page, false).count()) {
    await expect(sidebar).toHaveCount(0);
    await sidebarToggle(page, false).click();
  }
  await expect(sidebar).toBeVisible();
  const tab = sidebar.getByRole("tab", { name, exact: true });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect
    .poll(() =>
      sidebar.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return Math.max(0, -bounds.left, bounds.right - innerWidth);
      }),
    )
    .toBeLessThan(1);
  return sidebar;
}

async function closeSidebarPanel(page) {
  if (!(await sidebarToggle(page, true).count())) return;
  await page
    .getByRole("button", { name: "Close sidebar", exact: true })
    .click();
  await expect(page.locator("[data-editor-sidebar]")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show sidebar", exact: true }),
  ).toBeFocused();
}

async function showSidebar(page) {
  if (await sidebarToggle(page, false).count())
    await sidebarToggle(page, false).click();
  await expect(page.locator("[data-editor-sidebar]")).toBeVisible();
}

async function reloadWorkspace(page) {
  const selected = page.locator(
    '[data-editor-sidebar] [role="tab"][aria-selected="true"]',
  );
  const panel = (await selected.count()) ? await selected.innerText() : null;
  await expect(page.locator("#save-status")).toHaveText(
    "Saved in this browser",
  );
  await page.reload();
  await expect(page.locator("#board-grid")).toBeVisible();
  if (panel) await openSidebarPanel(page, panel);
}

async function downloadBoard(page) {
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  if (!(await dialog.isVisible()))
    await page.locator("#export-grid-header").click();
  const promise = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download image", exact: true })
    .click();
  const download = await promise;
  await expect(dialog).toHaveCount(0);
  return download;
}

async function useComicExample(page, publisher = "dc") {
  if (!comicFixtureModule) {
    const result = await build({
      configFile: false,
      logLevel: "error",
      build: {
        write: false,
        minify: false,
        lib: {
          entry: path.join(projectRoot, "tests/fixtures/comics.ts"),
          formats: ["es"],
          fileName: "fixtures",
        },
      },
    });
    const output = (Array.isArray(result) ? result[0] : result).output;
    const chunk = output.find(
      (entry) => entry.type === "chunk" && entry.isEntry,
    );
    comicFixtureModule = await import(
      `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
    );
  }
  const selected = page.locator(
    '[data-editor-sidebar] [role="tab"][aria-selected="true"]',
  );
  const panel = (await selected.count()) ? await selected.innerText() : null;
  const original = await savedWorkspace(page);
  const workspace = comicFixtureModule.makeComicFixture(original, publisher);
  const images = await Promise.all(
    workspace.assets
      .filter(
        (asset) =>
          !original.assets.some((existing) => existing.id === asset.id),
      )
      .map(async (asset) => ({
        id: asset.id,
        bytes: [
          ...(await readFile(
            path.join(projectRoot, "tests/fixtures/assets", asset.source),
          )),
        ],
      })),
  );
  workspace.assets = workspace.assets.map(({ src, ...asset }) => asset);
  workspace.revision = crypto.randomUUID();
  await localDatabase(page, "seed", { workspace, images });
  await page.reload();
  await expect(page.locator("#board-grid")).toBeVisible();
  if (panel) await openSidebarPanel(page, panel);
}

async function selectField(page, id, value) {
  if (["image-shape", "caption-position"].includes(id)) {
    await expect(page.locator("#board-grid")).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Editor panels", exact: true }),
    ).toBeVisible();
    const selected = page.locator(
      '[data-editor-sidebar] [role="tab"][aria-selected="true"]',
    );
    const panel = (await selected.count()) ? await selected.innerText() : null;
    const openedTools = !panel && !!(await sidebarToggle(page, false).count());
    await openSidebarPanel(page, "Settings");
    const radio = page
      .locator(`#${id}`)
      .locator(`[role="radio"][data-value="${value}"]`);
    if (!(await radio.isChecked())) await radio.click();
    await expect(radio).toBeChecked();
    if (panel) await openSidebarPanel(page, panel);
    if (openedTools) {
      await closeSidebarPanel(page);
    }
    return;
  }
  if (["heading-font", "cell-font"].includes(id))
    await openSidebarPanel(page, "Settings");
  await page.locator(`#${id}`).click();
  const option = page.getByRole("listbox").locator(`[data-value="${value}"]`);
  if ((await option.getAttribute("aria-selected")) === "true")
    await page.keyboard.press("Escape");
  else await option.click();
}

async function editHeading(page, value) {
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  const heading = page.getByRole("textbox", {
    name: "Grid heading",
    exact: true,
  });
  await heading.fill(value);
  await heading.press("Enter");
}

async function chooseImage(page, name, index = 0) {
  await page.locator(".cell-image-button").nth(index).click();
  if (await page.locator(".grid-cell").nth(index).locator("img").count())
    await page
      .locator(".grid-cell")
      .nth(index)
      .getByRole("button", { name: "Replace image", exact: true })
      .click();
  const dialog = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  if (
    !(await dialog
      .getByRole("button", { name: `Use ${name}`, exact: true })
      .isVisible())
  )
    await dialog
      .getByRole("button", { name: `Image options: ${name}`, exact: true })
      .click();
  await dialog
    .getByRole("button", { name: `Use ${name}`, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

async function selectExportField(page, id, value) {
  if (
    !(await page
      .getByRole("dialog", { name: "Export grid", exact: true })
      .isVisible())
  )
    await page.locator("#export-grid-header").click();
  await selectField(page, id, value);
}

async function beginCellUpload(page, index) {
  const image = page.locator(".cell-image-button").nth(index);
  const bounds = await image.boundingBox();
  const position = { x: bounds.width / 2, y: Math.min(20, bounds.height / 2) };
  if (await page.locator(".grid-cell").nth(index).locator("img").count()) {
    await image.click({ position });
    await page
      .getByRole("button", { name: "Replace image", exact: true })
      .click();
  } else await image.click({ position });
  const dialog = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  if (await dialog.isVisible()) {
    return dialog.locator("#picker-cell-upload");
  }
  return page.locator("#replace-upload");
}

async function uploadCellImage(page, index = 0) {
  const input = await beginCellUpload(page, index);
  await input.setInputFiles({
    name: "Fixture.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"></svg>',
    ),
  });
  await expect(
    page.getByRole("dialog", { name: "Choose image", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".grid-cell").nth(index).locator("img"),
  ).toBeVisible();
}

async function mockCommons(page, { width = 400, height = 600 } = {}) {
  const image = await readFile(
    path.join(projectRoot, "tests/fixtures/assets/DC - Color Kid.jpg"),
  );
  const requests = [];
  let failDownload = false;
  const result = (id, title, overrides = {}) => ({
    pageid: id,
    index: id,
    title: `File:${title}.jpg`,
    imageinfo: [
      {
        url: `https://upload.wikimedia.org/wikipedia/commons/test/${id}.jpg`,
        thumburl: `https://thumb.wikimedia.org/wikipedia/commons/thumb/test/${id}.jpg/330px-thumb-${id}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}.jpg`,
        width,
        height,
        size: image.length,
        mime: "image/jpeg",
        extmetadata: {
          Artist: { value: "<b>Fixture creator</b>" },
          LicenseShortName: { value: "Public domain" },
          Copyrighted: { value: "False" },
          AttributionRequired: { value: "false" },
          Restrictions: { value: "" },
          Categories: {
            value:
              "Astronomy|Landscape photography|Paintings|Architecture|Historical photographs",
          },
          ...overrides,
        },
      },
    ],
  });
  await page.route(
    "https://commons.wikimedia.org/w/api.php?*",
    async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams.get("gsrsearch");
      expect(query).toContain("filetype:bitmap");
      const offset = Number(url.searchParams.get("gsroffset"));
      const limit = Number(url.searchParams.get("gsrlimit"));
      requests.push({ query, offset, limit });
      if (query.startsWith("quota"))
        return route.fulfill({
          status: 429,
          headers: { "Retry-After": "1" },
          body: "{}",
        });
      if (query.startsWith("busy") || query.startsWith("maxlag"))
        return route.fulfill({
          json: {
            error: {
              code: query.startsWith("busy")
                ? "cirrussearch-too-busy-error"
                : "maxlag",
              info: "Search is currently too busy. Please try again later.",
            },
          },
        });
      if (query.startsWith("servicefailure"))
        return route.fulfill({ status: 503, body: "Service unavailable" });
      if (query.startsWith("invalidcursor"))
        return route.fulfill({
          json: {
            continue: { gsroffset: "12", continue: "-||" },
            query: { pages: [result(1, "Earth")] },
          },
        });
      if (query.startsWith("invalid"))
        return route.fulfill({ json: { query: { pages: "bad response" } } });
      if (query.startsWith("empty"))
        return route.fulfill({ json: { query: { pages: [] } } });
      if (query.startsWith("slow")) {
        await new Promise((resolve) => page.once("commons-release", resolve));
        try {
          await route.fulfill({
            json: { query: { pages: [result(99, "Stale")] } },
          });
        } catch {}
        return;
      }
      const first = [
        result(1, "Earth"),
        result(3, "Copyrighted", {
          LicenseShortName: { value: "CC BY-SA 4.0" },
        }),
        result(4, "Restricted", {
          Restrictions: { value: "personality" },
        }),
        result(5, "Missing rights", { Copyrighted: { value: "" } }),
      ];
      const catalog = query.startsWith("historycontinuation")
        ? [
            ...first.slice(0, 2),
            ...Array.from({ length: 9 }, (_, index) =>
              result(index + 10, `Open ${index + 10}`),
            ),
          ]
        : query.startsWith("shortcursor")
          ? [
              result(1, "Earth"),
              result(2, "Moon"),
              ...Array.from({ length: 70 }, (_, index) =>
                result(index + 10, `Copyrighted ${index + 10}`, {
                  Copyrighted: { value: "True" },
                }),
              ),
            ]
          : query.startsWith("scoped")
            ? [
                result(30, "Unrelated", { Categories: { value: "" } }),
                result(31, "Neutral title", {
                  Categories: { value: "Architecture" },
                }),
                result(32, "Forest", { Categories: { value: "Nature" } }),
              ]
            : query.startsWith("paged")
              ? [
                  ...first,
                  ...Array.from({ length: 11 }, (_, index) =>
                    result(index + 10, `Open ${index + 10}`),
                  ),
                  result(2, "Moon"),
                ]
              : query.startsWith("credited")
                ? [
                    result(80, "Credit file", {
                      ObjectName: { value: "<span>Credited photo</span>" },
                      Attribution: { value: "Credit Fixture Archive" },
                      LicenseShortName: { value: "CC BY 4.0" },
                      LicenseUrl: {
                        value: "https://creativecommons.org/licenses/by/4.0",
                      },
                      Copyrighted: { value: "True" },
                      AttributionRequired: { value: "true" },
                    }),
                  ]
                : query.startsWith("moon")
                  ? [result(2, "Moon")]
                  : first;
      const next = offset + limit;
      const historyOnly = query.startsWith("pagedhistory") && limit < 10;
      return route.fulfill({
        json: {
          ...(next < catalog.length && !historyOnly
            ? { continue: { gsroffset: next, continue: "-||" } }
            : {
                continue: { iistart: "2024-07-31T01:29:44Z", continue: "||" },
              }),
          query: {
            ...(query.startsWith("pagedhistory")
              ? { searchinfo: { totalhits: catalog.length } }
              : {}),
            pages: catalog.slice(offset, next),
          },
        },
      });
    },
  );
  await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, (route) =>
    route.fulfill({
      status:
        failDownload && !route.request().url().includes("thumb-") ? 503 : 200,
      contentType: "image/jpeg",
      body: image,
    }),
  );
  return {
    requests,
    failDownload: (value) => {
      failDownload = value;
    },
  };
}

async function mockMet(page) {
  const image = await readFile(
    path.join(projectRoot, "tests/fixtures/assets/DC - Color Kid.jpg"),
  );
  const requests = [];
  const detailRequests = [];
  let failDownload = false;
  const object = (id, patch = {}) => ({
    objectID: id,
    isPublicDomain: true,
    title: id === 2 ? "Vase" : id >= 10 ? `Open ${id}` : "Iris",
    artistDisplayName: "<b>Fixture curator</b>",
    tags: [{ term: "Portraits" }],
    rightsAndReproduction: "",
    primaryImage: `https://images.metmuseum.org/CRDImages/ep/original/${id}.jpg`,
    primaryImageSmall: `https://images.metmuseum.org/CRDImages/ep/web-large/${id}.jpg`,
    objectURL: `https://www.metmuseum.org/art/collection/search/${id}`,
    ...patch,
  });
  await page.route(
    "https://collectionapi.metmuseum.org/public/collection/**",
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/search")) {
        expect(url.pathname).toBe("/public/collection/v1.1/search");
        expect(url.searchParams.get("hasImages")).toBe("true");
        const limit = Number(url.searchParams.get("limit"));
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThanOrEqual(12);
        const query = url.searchParams.get("q");
        const offset = Number(url.searchParams.get("offset"));
        requests.push({
          query,
          offset,
          limit,
          medium: url.searchParams.get("medium"),
        });
        if (query === "quota")
          return route.fulfill({
            status: 429,
            headers: { "Retry-After": "1" },
            body: "{}",
          });
        if (query === "invalid")
          return route.fulfill({ json: { total: 1, objectIDs: "invalid" } });
        if (query === "empty")
          return route.fulfill({ json: { total: 0, objectIDs: null } });
        if (query === "slow") {
          await new Promise((resolve) => page.once("met-release", resolve));
          try {
            await route.fulfill({ json: { total: 1, objectIDs: [99] } });
          } catch {}
          return;
        }
        const catalog =
          query === "scoped"
            ? [1, 10]
            : query === "paged"
              ? [
                  1,
                  3,
                  4,
                  5,
                  6,
                  7,
                  8,
                  ...Array.from({ length: 11 }, (_, index) => index + 10),
                  2,
                ]
              : query === "painting"
                ? [1, 3, 4, 5, 6, 7, 8]
                : [
                    { undersized: 10, unavailable: 11, adequate: 12 }[query] ??
                      1,
                  ];
        return route.fulfill({
          json: {
            total: catalog.length,
            objectIDs: catalog.slice(offset, offset + limit),
          },
        });
      }
      const id = Number(url.pathname.split("/").at(-1));
      detailRequests.push(id);
      const patches = {
        10: { tags: [{ term: "Flowers" }] },
        3: { isPublicDomain: false },
        4: { rightsAndReproduction: "All rights reserved" },
        5: { primaryImageSmall: "https://example.com/image.jpg" },
        6: { primaryImage: "https://example.com/image.jpg" },
        7: { objectURL: "https://example.com/source" },
        8: { primaryImage: "" },
      };
      return route.fulfill({ json: object(id, patches[id]) });
    },
  );
  await page.route("https://images.metmuseum.org/**", (route) =>
    route.fulfill({
      status:
        failDownload && route.request().url().includes("/original/")
          ? 503
          : 200,
      contentType: "image/jpeg",
      body: image,
    }),
  );
  return {
    requests,
    detailRequests,
    failDownload: (value) => {
      failDownload = value;
    },
  };
}

async function searchCommons(page, query, waitForResults = true) {
  const online = page.getByRole("region", { name: "Online", exact: true });
  await online
    .getByRole("searchbox", { name: "Search images", exact: true })
    .fill(query);
  if (waitForResults)
    await expect(online).toHaveAttribute("aria-busy", "false");
  return online;
}

async function resizedProviderFixture(page, width, height) {
  const image = await readFile(
    path.join(projectRoot, "tests/fixtures/assets/DC - Color Kid.jpg"),
  );
  const base64 = await page.evaluate(
    async ({ source, width, height }) => {
      const decoded = new Image();
      decoded.src = `data:image/jpeg;base64,${source}`;
      await decoded.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(decoded, 0, 0, width, height);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { source: image.toString("base64"), width, height },
  );
  return Buffer.from(base64, "base64");
}

for (const [mode, density, viewport] of [
  ["desktop", 1, { width: 1440, height: 1080 }],
  ["mobile", 2, { width: 390, height: 844 }],
]) {
  test(`Commons ${mode} preview renditions cover all shapes without oversized requests`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: density,
      isMobile: mode === "mobile",
      hasTouch: mode === "mobile",
    });
    const page = await context.newPage();
    try {
      await mockCommons(page, { width: 6000, height: 3000 });
      const thumbnailWidths = [];
      const originals = [];
      page.on("request", (request) => {
        if (request.url().startsWith("https://upload.wikimedia.org/"))
          originals.push(request.url());
      });
      await page.route(/^https:\/\/thumb\.wikimedia\.org\//, async (route) => {
        const width = Number(
          new URL(route.request().url()).pathname.match(/\/(\d+)px-/)[1],
        );
        thumbnailWidths.push(width);
        await route.fulfill({
          contentType: "image/png",
          body: await resizedProviderFixture(page, width, width / 2),
        });
      });
      await page.goto("./");
      if (mode === "mobile") {
        await page
          .locator(".cell-image-button")
          .first()
          .tap({ position: { x: 5, y: 5 } });
        await selectField(page, "picker-image-source", "commons");
      } else await selectField(page, "sidebar-image-source", "commons");
      const online = page.getByRole("region", { name: "Online", exact: true });
      const image = online.locator("img");
      const assertRendition = async () => {
        const cardWidth = (
          await online.locator("[data-library-image]").boundingBox()
        ).width;
        const required = Math.ceil(cardWidth * (4 / 3) * density * 2);
        const expected = [120, 250, 330, 500, 960, 1280, 1920, 3840].find(
          (width) => width >= required,
        );
        await expect(image).toHaveAttribute(
          "src",
          new RegExp(`/${expected}px-`),
        );
        await expect(image).toHaveJSProperty("naturalWidth", expected);
        await expect(image).toHaveJSProperty("naturalHeight", expected / 2);
      };
      await assertRendition();
      expect(thumbnailWidths).toHaveLength(1);
      if (mode === "desktop") {
        for (const shape of ["landscape", "square", "portrait"]) {
          await selectField(page, "image-shape", shape);
          await assertRendition();
        }
        expect(thumbnailWidths).toHaveLength(1);
      } else {
        await setEditorViewport(page, { width: 260, height: 844 });
        await assertRendition();
      }
      expect(originals).toHaveLength(0);
      expect((await localDatabase(page)).images).toHaveLength(0);
      await page.screenshot({
        path: testInfo.outputPath(`preview-sizing-${mode}.png`),
      });
      if (mode === "mobile") {
        await showImageActions(online, true);
        await online
          .getByRole("button", { name: "Use Earth", exact: true })
          .tap({ position: { x: 5, y: 5 } });
      } else {
        await online
          .getByRole("button", { name: "Image options: Earth", exact: true })
          .hover();
        await online
          .getByRole("button", { name: "Import Earth", exact: true })
          .click();
      }
      await expect
        .poll(async () => (await localDatabase(page)).document.assets.length)
        .toBe(1);
      expect(originals).toEqual([
        "https://upload.wikimedia.org/wikipedia/commons/test/1.jpg",
      ]);
    } finally {
      await context.close();
    }
  });
}

for (const provider of ["commons", "met"]) {
  for (const mode of ["desktop", "mobile"]) {
    const providerTest = mode === "mobile" ? touchTest : test;
    providerTest(
      `${provider} ${mode} reveals ready cards while other metadata and previews are still loading`,
      async ({ page }, testInfo) => {
        await (provider === "commons" ? mockCommons(page) : mockMet(page));
        let releaseMetadata;
        let releasePreview;
        const metadata = new Promise((resolve) => {
          releaseMetadata = resolve;
        });
        const preview = new Promise((resolve) => {
          releasePreview = resolve;
        });
        await page.route(
          provider === "commons"
            ? "https://commons.wikimedia.org/w/api.php?*"
            : "https://collectionapi.metmuseum.org/public/collection/**",
          async (route) => {
            const url = new URL(route.request().url());
            if (
              provider === "commons"
                ? Number(url.searchParams.get("gsroffset")) > 0
                : url.pathname.endsWith("/objects/11")
            )
              await metadata;
            await route.fallback();
          },
        );
        await page.route(
          provider === "commons"
            ? /^https:\/\/(upload|thumb)\.wikimedia\.org\//
            : "https://images.metmuseum.org/**",
          async (route) => {
            if (
              /\/1\.jpg(?:\/|$)/.test(new URL(route.request().url()).pathname)
            )
              await preview;
            await route.fallback();
          },
        );
        try {
          if (mode === "mobile") {
            await page.goto("./");
            await page
              .locator(".cell-image-button")
              .first()
              .tap({ position: { x: 5, y: 5 } });
            await selectField(page, "picker-image-source", provider);
            await searchCommons(page, "paged", false);
          } else {
            await page.goto(
              `./?panel=images&source=${provider}&topic=all&q=paged`,
            );
          }
          const online = page.getByRole("region", {
            name: "Online",
            exact: true,
          });
          const initial = provider === "commons" ? 7 : 2;
          await expect(online.locator(".asset:visible")).toHaveCount(
            initial - 1,
          );
          await expect(online).toHaveAttribute("aria-busy", "true");

          await expect(
            online.getByRole("button", { name: "Next results", exact: true }),
          ).toBeDisabled();
          await online
            .locator(".library-heading:visible")
            .first()
            .fill("Ready caption");
          await page.screenshot({
            path: testInfo.outputPath(
              `${provider}-${mode}-incremental-ready.png`,
            ),
          });
          releaseMetadata();
          await expect(online).toHaveAttribute("aria-busy", "false");
          await expect(online.locator(".asset:visible")).toHaveCount(9);

          releasePreview();
          await expect(online.locator(".asset:visible")).toHaveCount(10);

          await expect(
            online.getByRole("textbox", {
              name: "Library heading: Ready caption",
              exact: true,
            }),
          ).toHaveValue("Ready caption");
          expect((await localDatabase(page)).images).toHaveLength(0);
        } finally {
          releaseMetadata();
          releasePreview();
        }
      },
    );
  }
}

test("Met preview variants upgrade only when necessary and release temporary originals", async ({
  page,
}) => {
  const mock = await mockMet(page);
  let height = 1500;
  const originals = [];
  page.on("request", (request) => {
    if (
      request
        .url()
        .startsWith("https://images.metmuseum.org/CRDImages/ep/original/")
    )
      originals.push(request.url());
  });
  await page.route(
    "https://images.metmuseum.org/CRDImages/ep/web-large/**",
    async (route) => {
      await route.fulfill({
        contentType: "image/png",
        body: await resizedProviderFixture(page, 1000, height),
      });
    },
  );
  await page.goto("./");
  await selectField(page, "sidebar-image-source", "met");
  const online = page.getByRole("region", { name: "Online", exact: true });
  const image = online.locator("img");
  await expect(image).toHaveJSProperty("naturalHeight", 1500);
  await expect(image).toHaveAttribute("src", /\/web-large\//);
  expect(originals).toHaveLength(0);
  height = 100;
  await searchCommons(page, "undersized");
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect(image).toHaveJSProperty("naturalWidth", 1200);
  const temporary = await image.getAttribute("src");
  expect(originals).toHaveLength(1);
  expect((await localDatabase(page)).images).toHaveLength(0);
  mock.failDownload(true);
  await searchCommons(page, "unavailable");
  await expect.poll(() => originals.length).toBe(2);
  await expect(image).toHaveAttribute("src", /\/web-large\//);
  await expect(image).toHaveJSProperty("naturalHeight", 100);
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url);
        return true;
      } catch {
        return false;
      }
    }, temporary),
  ).toBe(false);
  height = 1500;
  mock.failDownload(false);
  await searchCommons(page, "adequate");
  await expect(image).toHaveJSProperty("naturalHeight", 1500);
  expect(originals).toHaveLength(2);
  expect((await localDatabase(page)).images).toHaveLength(0);
});

for (const originalAvailable of [true, false]) {
  test(`Met failed thumbnails ${originalAvailable ? "use a bounded original preview" : "show an error when the original also fails"}`, async ({
    page,
  }) => {
    await mockMet(page);
    const bytes = await readFile(
      path.join(projectRoot, "tests/fixtures/assets/DC - Color Kid.jpg"),
    );
    let originalRequests = 0;
    await page.route("https://images.metmuseum.org/**", async (route) => {
      if (route.request().url().includes("/web-large/"))
        return route.abort("failed");
      originalRequests++;
      return route.fulfill({
        status: originalAvailable ? 200 : 503,
        contentType: "image/jpeg",
        body: bytes,
      });
    });
    await page.goto("./");
    await selectField(page, "sidebar-image-source", "met");
    const online = page.getByRole("region", { name: "Online", exact: true });
    if (originalAvailable) {
      const image = online.locator(".asset img");
      await expect(image).toHaveAttribute("src", /^blob:/);
      await expect(image).toHaveJSProperty("naturalWidth", 1200);
      await expect(
        online.getByText(
          "Image unavailable. Check your connection or choose another image.",
          { exact: true },
        ),
      ).toHaveCount(0);
    } else {
      await expect(
        online.getByText(
          "Image unavailable. Check your connection or choose another image.",
          { exact: true },
        ),
      ).toBeVisible();
    }
    await expect(online.locator("[data-online-image-loading]")).toHaveCount(0);
    expect(originalRequests).toBe(1);
    const saved = await localDatabase(page);
    expect(saved.images).toHaveLength(0);
    expect(saved.document.assets).toHaveLength(0);
  });
}

async function showImageActions(container, touch = false) {
  const image = container.locator("[data-library-thumbnail]").first();
  if (touch) {
    if ((await image.getAttribute("aria-expanded")) !== "true")
      await image.tap();
  } else await image.hover();
}

for (const [mode, sourceTest] of [
  ["desktop", test],
  ["mobile", touchTest],
]) {
  sourceTest(
    `source rights ${mode} opens from inside the card without selecting it`,
    async ({ page }, testInfo) => {
      await mockCommons(page);
      await page
        .context()
        .route("https://commons.wikimedia.org/wiki/**", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: "<title>Source fixture</title>",
          }),
        );
      await page.goto("./");
      if (mode === "desktop")
        await selectField(page, "sidebar-image-source", "commons");
      else {
        await page
          .locator(".cell-image-button")
          .first()
          .tap({ position: { x: 5, y: 5 } });
        await selectField(page, "picker-image-source", "commons");
      }
      const online = page.getByRole("region", { name: "Online", exact: true });
      const card = online.locator("[data-library-image]");
      await expect(online.locator(".library-heading")).toHaveValue("Earth");
      const source = online.getByRole("link", {
        name: "Source and rights",
        exact: true,
      });
      await expect(source).toHaveCount(0);
      await showImageActions(online, mode === "mobile");
      await expect(source).toBeVisible();

      await page.screenshot({
        path: testInfo.outputPath(`source-${mode}-inside-card.png`),
        fullPage: true,
      });
      const opened = page.context().waitForEvent("page");
      await source.click();
      const sourcePage = await opened;
      await sourcePage.waitForLoadState();
      expect(sourcePage.url()).toBe(
        "https://commons.wikimedia.org/wiki/File:Earth.jpg",
      );
      await sourcePage.close();
      await expect(page.locator(".grid-cell img")).toHaveCount(0);
      expect((await localDatabase(page)).images).toHaveLength(0);
      if (mode === "mobile") {
        await expect(
          page.getByRole("dialog", { name: "Choose image", exact: true }),
        ).toBeVisible();
        await showImageActions(online, true);
        await online
          .getByRole("button", { name: "Use Earth", exact: true })
          .tap();
        await expect(
          page.getByRole("dialog", { name: "Choose image", exact: true }),
        ).toHaveCount(0);
        await expect(page.locator(".grid-cell img")).toHaveCount(1);
      } else {
        await page.mouse.move(0, 0);
        await expect(source).toHaveCount(0);
      }
    },
  );
}

for (const [mode, providerTest] of [
  ["desktop", test],
  ["mobile", touchTest],
]) {
  providerTest(
    `Met ${mode} shared browsing import crop export and reload`,
    async ({ page }, testInfo) => {
      const mock = await mockMet(page);
      await page.goto("./");
      if (mode === "desktop")
        await selectField(page, "sidebar-image-source", "met");
      else {
        await page
          .locator(".cell-image-button")
          .first()
          .tap({ position: { x: 5, y: 5 } });
        await selectField(page, "picker-image-source", "met");
      }
      const online = page.getByRole("region", { name: "Online", exact: true });
      const remote = online.locator("[data-library-thumbnail]");
      const searchbox = online.getByRole("searchbox", {
        name: "Search images",
        exact: true,
      });
      await expect(remote).toHaveCount(1);
      await expect(online.locator(".library-heading")).toHaveValue("Iris");
      await expect(remote).toHaveJSProperty("draggable", mode === "desktop");
      await expect(online.locator("img")).toHaveJSProperty(
        "naturalWidth",
        1200,
      );
      expect(
        await page.evaluate(() =>
          document.activeElement?.matches("input,textarea"),
        ),
      ).toBe(false);
      const topics = online.getByRole("group").first();
      await expect(topics.getByRole("button")).toHaveCount(6);
      for (const name of [
        "Paintings",
        "Sculpture",
        "Portraits",
        "Prints",
        "Ceramics",
      ]) {
        const button = topics.getByRole("button", { name, exact: true });
        await expect(button).toHaveAttribute("title", name);
      }
      const searchBounds = await searchbox.boundingBox();
      const topicBounds = await topics.boundingBox();
      const cardBounds = await remote.boundingBox();
      expect(topicBounds.y).toBeGreaterThanOrEqual(
        searchBounds.y + searchBounds.height,
      );
      expect(cardBounds.y).toBeGreaterThanOrEqual(
        topicBounds.y + topicBounds.height,
      );
      await page.screenshot({
        path: testInfo.outputPath(`met-${mode}-browse.png`),
      });
      await topics
        .getByRole("button", { name: "Ceramics", exact: true })
        .click();
      await expect(online).toHaveAttribute("aria-busy", "false");
      expect(mock.requests.at(-1).query).toBe("ceramic");
      await searchbox.fill("iri");
      await searchbox.fill("iris");
      await expect(online).toHaveAttribute("aria-busy", "false");
      expect(mock.requests.at(-1).query).toBe("iris");
      expect(mock.requests.some((request) => request.query === "iri")).toBe(
        false,
      );
      await expect(
        online.getByRole("button", { name: "Next results", exact: true }),
      ).toBeDisabled();
      await showImageActions(online, mode === "mobile");
      await expect(
        online.getByRole("link", { name: "Source and rights" }),
      ).toHaveAttribute("title", "Source and rights: Fixture curator - CC0");
      const importImage = async () => {
        if (mode === "mobile") {
          await showImageActions(online, true);
          await online
            .getByRole("button", { name: "Use Iris", exact: true })
            .tap({ position: { x: 5, y: 5 } });
        } else {
          await remote.hover();
          await online
            .getByRole("button", { name: "Import Iris", exact: true })
            .click();
        }
      };
      mock.failDownload(true);
      await importImage();
      await expect(online.getByRole("alert")).toHaveText(
        "Could not import this image. Try another result.",
      );
      await expect(page.locator(".grid-cell img")).toHaveCount(0);
      mock.failDownload(false);
      if (mode === "desktop") {
        await remote.dragTo(page.locator(".cell-image-button").first());
        await expect(page.locator(".grid-cell img")).toHaveCount(1);
        await remote.dragTo(page.locator(".cell-image-button").nth(1));
        await expect(page.locator(".grid-cell img")).toHaveCount(2);
        await selectField(page, "sidebar-image-source", "imported");
        await expect(page.locator("#asset-library .asset")).toHaveCount(1);
        await showImageActions(page.locator("#asset-library"));
        await expect(
          page
            .locator("#asset-library")
            .getByRole("link", { name: "Source and rights" }),
        ).toHaveAttribute(
          "href",
          "https://www.metmuseum.org/art/collection/search/1",
        );
      } else {
        await importImage();
        await expect(
          page.getByRole("dialog", { name: "Choose image", exact: true }),
        ).toHaveCount(0);
      }
      const first = page.locator(".grid-cell").first();
      await first.locator(".cell-image-button").click();
      await first
        .getByRole("button", { name: "Crop image", exact: true })
        .click();
      const crop = page.getByRole("dialog", {
        name: "Crop image",
        exact: true,
      });
      await crop
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await selectExportField(page, "resolution", "150");
      const download = await downloadBoard(page);
      const bytes = await readFile(await download.path());
      expect([...bytes.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      await expect
        .poll(
          async () =>
            (await localDatabase(page)).document.assets[0]?.provenance
              ?.provider,
        )
        .toBe("met");
      const saved = await localDatabase(page);
      expect(saved.document.assets[0].provenance).toMatchObject({
        provider: "met",
        entityId: "1",
        license: "CC0",
        creator: "Fixture curator",
      });
      expect(saved.images).toHaveLength(0);
      expect(saved.document.grid.cells[0].crop).toBeDefined();
      expect(
        await page.evaluate(() => localStorage.getItem("grids-settings-v1")),
      ).not.toContain("metmuseum");
      await page.reload();
      await expect(page.locator(".grid-cell img")).toHaveCount(
        mode === "desktop" ? 2 : 1,
      );
      await expect(page.locator(".cell-heading").first()).toHaveValue("Iris");
      if (mode === "desktop") {
        await selectField(page, "sidebar-image-source", "met");
        await expect(remote).toBeVisible();
      }
      await page.screenshot({ path: testInfo.outputPath(`met-${mode}.png`) });
    },
  );
}

test("Met filters reject invalid pages and ignore stale results without affecting Commons", async ({
  page,
}) => {
  const mock = await mockMet(page);
  await mockCommons(page);
  await page.goto("./");
  await selectField(page, "sidebar-image-source", "met");
  const online = page.getByRole("region", { name: "Online", exact: true });
  const search = online.getByRole("searchbox", {
    name: "Search images",
    exact: true,
  });
  await expect(online.locator(".library-heading")).toHaveValue("Iris");
  await search.fill("slow");
  await expect
    .poll(() => mock.requests.some((request) => request.query === "slow"))
    .toBe(true);
  await search.fill("iris");
  await expect(online.locator(".library-heading")).toHaveValue("Iris");
  page.emit("met-release");
  await search.fill("invalid");
  await expect(online.getByRole("alert")).toHaveText(
    "The Met returned an unexpected response.",
  );
  await search.fill("empty");
  await expect(online).toHaveAttribute("aria-busy", "false");
  await expect(online.locator(".asset")).toHaveCount(0);
  await expect(online.getByRole("alert")).toHaveCount(0);
  await search.fill("quota");
  await expect(online.getByRole("alert")).toHaveText(
    "The Met is rate limiting requests. Try again shortly.",
  );
  await selectField(page, "sidebar-image-source", "commons");
  await expect(online.locator(".library-heading")).toHaveValue("Earth");
  await expect(page.locator(".grid-cell img")).toHaveCount(0);
});

for (const [mode, providerTest] of [
  ["desktop", test],
  ["mobile", touchTest],
]) {
  providerTest(
    `Commons ${mode} search imports locally with provenance placement crop export and reload`,
    async ({ page }, testInfo) => {
      const mock = await mockCommons(page);
      await page.goto("./");
      await expect(page.locator("#board-grid")).toBeVisible();
      if (mode === "desktop") {
        await openSidebarPanel(page, "Images");
        await selectField(page, "sidebar-image-source", "commons");
        await expect(page.locator("#asset-library")).toBeHidden();
      } else {
        await page
          .locator(".cell-image-button")
          .first()
          .tap({ position: { x: 5, y: 5 } });
        await expect(
          page.getByRole("dialog", { name: "Choose image", exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(() => document.activeElement?.tagName),
        ).not.toBe("INPUT");
        await selectField(page, "picker-image-source", "commons");
      }
      const online = page.getByRole("region", { name: "Online", exact: true });
      await expect(
        online.locator(
          "button[aria-haspopup='listbox']:not(#picker-image-source)",
        ),
      ).toHaveCount(0);
      await expect(
        page.locator(
          mode === "desktop" ? "#sidebar-image-source" : "#picker-image-source",
        ),
      ).toHaveText("Wikimedia Commons");
      const searchbox = online.getByRole("searchbox", {
        name: "Search images",
        exact: true,
      });
      await expect(searchbox).toHaveValue("");
      await expect(online.locator("[data-library-image]")).toHaveCount(1);
      await expect(online.locator("article")).toHaveCount(0);
      await expect(
        online.getByText("Public domain and CC0", { exact: true }),
      ).toHaveCount(0);
      await expect(online.locator("[data-library-thumbnail]")).toHaveJSProperty(
        "draggable",
        mode === "desktop",
      );
      await expect(
        online.getByRole("button", { name: "Space", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        mock.requests.some((request) =>
          request.query.startsWith("NASA Earth space"),
        ),
      ).toBe(true);
      await expect(searchbox).toHaveAttribute("placeholder", "Search images");
      await expect(
        online.getByText("Search images", { exact: true }),
      ).toHaveCount(0);
      await expect(
        online.getByText(/Searches and image requests are sent/),
      ).toHaveCount(0);
      await expect(
        online.getByRole("button", { name: "Search", exact: true }),
      ).toHaveCount(0);
      const topics = online.getByRole("group", {
        name: "Explore",
        exact: true,
      });
      for (const topic of await topics.getByRole("button").all()) {
        await expect(topic).toHaveAccessibleName(/\S/);
      }
      await searchbox.click();
      await expect(searchbox).toBeFocused();

      await page.screenshot({
        path: testInfo.outputPath(`commons-${mode}-browse.png`),
      });
      const beforeFilter = mock.requests.length;
      await searchbox.fill("ear");
      await searchCommons(page, "earth");
      expect(mock.requests.slice(beforeFilter)).toHaveLength(1);
      expect(mock.requests.at(-1).query).toMatch(/^earth/);
      const afterFilter = mock.requests.length;
      await searchCommons(page, "");
      await expect(
        online.getByRole("button", { name: "Space", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(mock.requests).toHaveLength(afterFilter);
      await searchbox.fill("cancelled-filter");
      await online.getByRole("button", { name: "Nature", exact: true }).click();
      await expect(
        online.getByRole("button", { name: "Nature", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(() =>
          mock.requests.some((request) =>
            request.query.startsWith("cancelled-filter"),
          ),
        )
        .toBe(true);
      await expect(searchbox).toHaveValue("cancelled-filter");
      await expect(searchbox).not.toBeFocused();
      await expect(online.locator("[data-library-image]")).toHaveCount(1);
      await searchCommons(page, "earth");
      expect(
        mock.requests.some((request) =>
          request.query.startsWith("cancelled-filter"),
        ),
      ).toBe(true);
      await expect(online.locator("[data-library-image]")).toHaveCount(1);
      await showImageActions(online, mode === "mobile");
      await expect(
        online.getByRole("link", { name: "Source and rights" }),
      ).toHaveAttribute(
        "title",
        "Source and rights: Fixture creator - Public domain",
      );
      await expect(online.locator("[data-library-image] img")).toHaveJSProperty(
        "naturalWidth",
        1200,
      );
      await expect(
        online.getByRole("button", { name: "Next results", exact: true }),
      ).toBeDisabled();
      const importResult = async () => {
        if (mode === "mobile") {
          await showImageActions(online, true);
          await online
            .getByRole("button", { name: "Use Earth", exact: true })
            .tap({ position: { x: 5, y: 5 } });
        } else {
          await page.mouse.move(0, 0);
          await online
            .getByRole("button", { name: "Image options: Earth", exact: true })
            .hover();
          await online
            .getByRole("button", { name: "Import Earth", exact: true })
            .click();
        }
      };
      mock.failDownload(true);
      await importResult();
      await expect(online.getByRole("alert")).toHaveText(
        "Could not import this image. Try another result.",
      );
      await expect(page.locator(".grid-cell img")).toHaveCount(0);
      mock.failDownload(false);
      await page.screenshot({
        path: testInfo.outputPath(`commons-${mode}-results.png`),
      });
      await importResult();
      if (mode === "desktop") {
        await selectField(page, "sidebar-image-source", "imported");
        await expect(
          page.locator("#asset-library [data-library-image]"),
        ).toHaveCount(1);
        await expect(page.locator(".grid-cell img")).toHaveCount(0);
        await showImageActions(page.locator("#asset-library"));
        await expect(
          page
            .locator("#asset-library")
            .getByRole("link", { name: "Source and rights" }),
        ).toHaveAttribute(
          "href",
          "https://commons.wikimedia.org/wiki/File:Earth.jpg",
        );
        await chooseImage(page, "Earth");
      } else
        await expect(
          page.getByRole("dialog", { name: "Choose image", exact: true }),
        ).toHaveCount(0);
      await expect(page.locator(".grid-cell img")).toHaveCount(1);
      const first = page.locator(".grid-cell").first();
      await first.locator(".cell-image-button").click();
      await first
        .getByRole("button", { name: "Crop image", exact: true })
        .click();
      const crop = page.getByRole("dialog", {
        name: "Crop image",
        exact: true,
      });
      await expect(crop).toBeVisible();
      await crop
        .getByRole("button", { name: "Apply crop", exact: true })
        .click();
      await expect(crop).toHaveCount(0);
      await selectExportField(page, "resolution", "150");
      const download = await downloadBoard(page);
      const bytes = await readFile(await download.path());
      expect([...bytes.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      await expect
        .poll(
          async () =>
            (await localDatabase(page)).document.assets[0]?.provenance
              ?.entityId,
        )
        .toBe("1");
      const saved = await localDatabase(page);
      expect(saved.document.assets[0].provenance).toMatchObject({
        provider: "commons",
        creator: "Fixture creator",
        license: "Public domain",
      });
      expect(saved.images).toHaveLength(0);
      expect(saved.document.grid.cells[0].crop).toBeDefined();
      const settings = await page.evaluate(() =>
        localStorage.getItem("grids-settings-v1"),
      );
      expect(settings).not.toContain("wikimedia");
      expect(settings).not.toContain("provenance");
      await page.reload();
      await expect(page.locator(".grid-cell img")).toHaveCount(1);
      await expect(
        page.locator(".grid-cell").first().locator(".cell-heading"),
      ).toHaveValue("Earth");
      expect(
        (await localDatabase(page)).document.assets[0].provenance.entityId,
      ).toBe("1");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(mock.requests.every((request) => request.offset === 0)).toBe(true);
    },
  );
}

test("Commons cards share imported settings and support native mouse and touch drops", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    const mock = await mockCommons(page);
    await page.goto("./");
    await selectField(page, "sidebar-image-source", "commons");
    const online = page.getByRole("region", { name: "Online", exact: true });
    const remote = online.locator("[data-library-thumbnail]");
    const cells = page.locator(".grid-cell");
    await expect(remote).toHaveJSProperty("draggable", true);
    await expect(online.locator("img")).toHaveJSProperty("naturalWidth", 1200);
    let releaseDownload;
    const downloadGate = new Promise((resolve) => {
      releaseDownload = resolve;
    });
    const originalUrl =
      "https://upload.wikimedia.org/wikipedia/commons/test/1.jpg";
    await page.route(originalUrl, async (route) => {
      await downloadGate;
      await route.fallback();
    });
    await remote.dragTo(cells.nth(0).locator(".cell-image-button"), {
      sourcePosition: { x: 5, y: 5 },
    });
    await expect(cells.nth(0)).toHaveAttribute("aria-busy", "true");
    await expect(
      cells.nth(0).getByRole("status", { name: "Importing..." }),
    ).toBeVisible();
    await expect(cells.nth(0).locator("img")).toHaveCount(0);
    releaseDownload();
    await expect(cells.nth(0).locator("img")).toHaveAttribute("alt", "Earth");
    await expect(cells.nth(0)).not.toHaveAttribute("aria-busy");
    await expect(cells.nth(0).getByRole("status")).toHaveCount(0);
    await page.unroute(originalUrl);
    await expect
      .poll(async () => (await localDatabase(page)).document.assets.length)
      .toBe(1);

    await openSidebarPanel(page, "Settings");
    await selectField(page, "cell-font", "Boogaloo");
    await page.locator("#cell-font-weight").press("End");
    await page.locator("#cell-text-color-value").fill("#40b4aa");
    await page.locator("#cell-text-color-value").press("Enter");
    await page.locator("#cell-background-color-value").fill("#304050");
    await page.locator("#cell-background-color-value").press("Enter");
    await openSidebarPanel(page, "Images");
    await page.evaluate(() => document.fonts.ready);
    const metrics = (element) => {
      const bounds = element.getBoundingClientRect();

      const caption = getComputedStyle(
        element.querySelector(".library-heading"),
      );
      const image = element
        .querySelector("[data-card-image]")
        .getBoundingClientRect();
      return {
        width: Math.round(bounds.width * 100) / 100,
        height: Math.round(bounds.height * 100) / 100,
        imageRatio: Math.round((image.width / image.height) * 100) / 100,
        font: caption.fontFamily,
        weight: caption.fontWeight,
        size: caption.fontSize,
        color: caption.color,
        background: caption.backgroundColor,
        captionTop: caption.top,
        captionHeight: caption.height,
        padding: caption.padding,
      };
    };
    const dimensions = new Set();
    for (const [shape, ratio] of [
      ["portrait", 0.75],
      ["landscape", 1.33],
      ["square", 1],
    ]) {
      await selectField(page, "image-shape", shape);
      for (const position of [
        "above",
        "below",
        "overlay-top",
        "overlay-bottom",
      ]) {
        await selectField(page, "caption-position", position);
        await selectField(page, "sidebar-image-source", "imported");
        const imported = page.locator("#asset-library .asset");
        await expect(imported.locator("img")).toHaveJSProperty(
          "naturalWidth",
          1200,
        );
        await expect
          .poll(async () => parseFloat((await imported.evaluate(metrics)).size))
          .toBeGreaterThan(0);
        const expected = await imported.evaluate(metrics);

        expect(Math.abs(expected.imageRatio - ratio)).toBeLessThan(0.02);
        expect(expected.font).toContain("Boogaloo");
        expect(expected.weight).toBe("700");
        expect(expected.color).toBe("rgb(64, 180, 170)");
        await selectField(page, "sidebar-image-source", "commons");
        await expect(remote).toBeVisible();
        await expect
          .poll(() => online.locator(".asset").evaluate(metrics))
          .toEqual(expected);
        dimensions.add(expected.height);
      }
    }
    expect(dimensions.size).toBeGreaterThan(2);
    await remote.dragTo(cells.nth(1).locator(".cell-image-button"), {
      sourcePosition: { x: 5, y: 5 },
    });
    await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Earth");
    expect((await localDatabase(page)).images).toHaveLength(0);
    await page.screenshot({
      path: testInfo.outputPath("commons-shared-card-settings.png"),
    });

    await searchCommons(page, "moon");
    await expect(online.locator(".library-heading")).toHaveValue("Moon");
    mock.failDownload(true);
    await remote.dragTo(cells.nth(2).locator(".cell-image-button"), {
      sourcePosition: { x: 5, y: 5 },
    });
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "Could not import this image",
    );
    await expect(cells.nth(2).locator("img")).toHaveCount(0);
    await expect(cells.nth(2)).not.toHaveAttribute("aria-busy");
    await expect(cells.nth(2).getByRole("status")).toHaveCount(0);
    expect((await localDatabase(page)).images).toHaveLength(0);
    mock.failDownload(false);
    const session = await context.newCDPSession(page);
    const touchDrop = async (cancel) => {
      await remote.tap({ position: { x: 5, y: 5 } });
      const handle = online.getByRole("button", {
        name: "Drag image",
        exact: true,
      });
      await expect(handle).toBeVisible();
      const source = await handle.boundingBox();
      const target = await cells
        .nth(2)
        .locator(".cell-image-button")
        .boundingBox();
      const start = {
        x: source.x + source.width / 2,
        y: source.y + source.height / 2,
      };
      const end = { x: target.x + 10, y: target.y + 10 };
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ ...start, id: 1 }],
      });
      for (let step = 1; step <= 8; step++)
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: start.x + ((end.x - start.x) * step) / 8,
              y: start.y + ((end.y - start.y) * step) / 8,
              id: 1,
            },
          ],
        });
      await expect(page.locator("[data-drag-floating]")).toBeVisible();

      await session.send("Input.dispatchTouchEvent", {
        type: cancel ? "touchCancel" : "touchEnd",
        touchPoints: [],
      });
      await expect(page.locator("[data-drag-floating]")).toHaveCount(0);
    };
    await touchDrop(true);
    await expect(cells.nth(2).locator("img")).toHaveCount(0);
    expect((await localDatabase(page)).images).toHaveLength(0);
    await touchDrop(false);
    await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Moon");
    await expect
      .poll(async () => (await localDatabase(page)).document.assets.length)
      .toBe(2);
    await expect(online.locator(".library-heading")).toHaveValue("Moon");
    await page.reload();
    await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Moon");
    expect(
      (await localDatabase(page)).document.assets
        .map((asset) => asset.provenance.entityId)
        .sort(),
    ).toEqual(["1", "2"]);
    await session.detach();
  } finally {
    await context.close();
  }
});

for (const failure of ["malformed", "blocked"]) {
  test(`editor navigation tolerates ${failure} preference storage`, async ({
    page,
  }) => {
    await page.addInitScript((failure) => {
      if (failure === "malformed")
        localStorage.setItem("grids-ui-v1", "{broken");
      else {
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) {
          if (key === "grids-ui-v1")
            throw new DOMException("Unavailable", "SecurityError");
          return getItem.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
          if (key === "grids-ui-v1")
            throw new DOMException("Unavailable", "QuotaExceededError");
          return setItem.call(this, key, value);
        };
      }
    }, failure);
    await page.goto("./?source=invalid&panel=invalid&offset=-1");
    await expect(page.locator("#board-grid")).toBeVisible();
    await expect(page.locator("#sidebar-image-source")).toHaveText("My images");
    await openSidebarPanel(page, "Settings");
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "Settings", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("#board-grid")).toBeVisible();
  });
}

for (const provider of ["commons", "met"]) {
  test(`${provider} topic filters exclude unrelated metadata without changing search text`, async ({
    page,
  }) => {
    await (provider === "commons" ? mockCommons(page) : mockMet(page));
    await page.goto(
      `./?source=${provider}&topic=${provider === "commons" ? "places" : "portraits"}&q=scoped`,
    );
    const online = page.getByRole("region", { name: "Online", exact: true });
    const input = online.getByRole("searchbox", {
      name: "Search images",
      exact: true,
    });
    await expect(online.locator(".library-heading")).toHaveValue(
      provider === "commons" ? "Neutral title" : "Iris",
    );
    await expect(input).toHaveValue("scoped");
    if (provider === "commons") {
      await online.getByRole("button", { name: "Nature", exact: true }).click();
      await expect(online.locator(".library-heading")).toHaveValue("Forest");
    }
    await online.getByRole("button", { name: "All", exact: true }).click();
    await expect(online.locator(".library-heading")).toHaveCount(
      provider === "commons" ? 3 : 2,
    );
    await expect(input).toHaveValue("scoped");
  });

  for (const [mode, providerTest] of [
    ["desktop", test],
    ["mobile", touchTest],
  ]) {
    providerTest(
      `${provider} ${mode} combines search with topic filters and All`,
      async ({ page }, testInfo) => {
        const mock = await (provider === "commons"
          ? mockCommons(page)
          : mockMet(page));
        await page.goto("./");
        const open = async () => {
          if (mode === "mobile")
            await page
              .locator(".cell-image-button")
              .first()
              .tap({ position: { x: 5, y: 5 } });
          await selectField(
            page,
            mode === "mobile" ? "picker-image-source" : "sidebar-image-source",
            provider,
          );
        };
        await open();
        const online = page.getByRole("region", {
          name: "Online",
          exact: true,
        });
        const input = online.getByRole("searchbox", {
          name: "Search images",
          exact: true,
        });
        const firstTopic = provider === "commons" ? "Space" : "Paintings";
        const secondTopic = provider === "commons" ? "Nature" : "Ceramics";
        await searchCommons(page, "paged");
        await expect(online.locator(".library-heading")).toHaveCount(10);
        await expect(
          online.getByRole("button", { name: firstTopic, exact: true }),
        ).toBeDisabled();
        await online
          .getByRole("button", { name: "Next results", exact: true })
          .click();
        await expect(online.locator(".library-heading")).toHaveCount(3);
        await expect(
          online
            .locator(".library-heading")
            .nth(provider === "commons" ? 0 : 2),
        ).toHaveValue(provider === "commons" ? "Moon" : "Vase");
        const beforeTopic = mock.requests.length;
        await online
          .getByRole("button", { name: secondTopic, exact: true })
          .click();
        await expect(input).toHaveValue("paged");
        await expect(online.locator(".library-heading")).toHaveCount(10);
        await expect(
          online.getByRole("button", { name: "Previous results", exact: true }),
        ).toBeDisabled();
        expect(mock.requests.length).toBeGreaterThan(beforeTopic);
        const scoped = mock.requests.at(-1);
        if (provider === "commons")
          expect(scoped.query).toBe(
            "paged filetype:bitmap haslicense:unrestricted",
          );
        else expect(scoped.medium).toBe("Ceramics");
        await page.reload();
        if (mode === "mobile") {
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await open();
        }
        await expect(input).toHaveValue("paged");
        await expect(
          online.getByRole("button", { name: secondTopic, exact: true }),
        ).toBeDisabled();
        await searchCommons(page, "");
        await expect(
          online.getByRole("button", { name: secondTopic, exact: true }),
        ).toBeDisabled();
        await searchCommons(page, "paged");
        await expect(online.locator(".library-heading")).toHaveCount(10);
        await online.getByRole("button", { name: "All", exact: true }).click();
        await expect(input).toHaveValue("paged");
        await expect(online.locator(".library-heading")).toHaveCount(10);
        const unrestricted = mock.requests.at(-1);
        if (provider === "commons")
          expect(unrestricted.query).not.toContain("intitle:");
        else expect(unrestricted.medium).toBeNull();
        await input.fill("");
        await expect(online).toHaveAttribute("aria-busy", "false");
        await expect(
          online.getByRole("button", { name: "All", exact: true }),
        ).toBeDisabled();
        await searchCommons(page, "paged");
        await online
          .getByRole("button", { name: "Next results", exact: true })
          .click();
        await expect(
          online
            .locator(".library-heading")
            .nth(provider === "commons" ? 0 : 2),
        ).toHaveValue(provider === "commons" ? "Moon" : "Vase");
        if (mode === "desktop") {
          expect(new URL(page.url()).search).toBe("");
          const preferences = await page.evaluate(() =>
            JSON.parse(localStorage.getItem("grids-ui-v1")),
          );
          expect(preferences.librarySource).toBe(provider);
          expect(preferences.browsing[`library:${provider}`].request).toEqual({
            topic: null,
            query: "paged",
            offset: provider === "commons" ? 13 : 16,
          });
        }
        await page.reload();
        if (mode === "mobile") await open();
        await expect(input).toHaveValue("paged");
        await expect(
          online.getByRole("button", { name: "All", exact: true }),
        ).toBeDisabled();
        await expect(
          online
            .locator(".library-heading")
            .nth(provider === "commons" ? 0 : 2),
        ).toHaveValue(provider === "commons" ? "Moon" : "Vase");
        await input.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`${provider}-${mode}-combined-search.png`),
        });
      },
    );
  }

  test(`${provider} imports a legacy provider URL into local preferences and cleans the address`, async ({
    page,
  }) => {
    await (provider === "commons" ? mockCommons(page) : mockMet(page));
    const offset = provider === "commons" ? 15 : 18;
    await page.goto(
      `./?panel=images&source=${provider}&q=paged&offset=${offset}`,
    );
    const online = page.getByRole("region", { name: "Online", exact: true });
    await expect(online.locator(".library-heading")).toHaveValue(
      provider === "commons" ? "Moon" : "Vase",
    );
    expect(new URL(page.url()).search).toBe("");
    const preferences = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("grids-ui-v1")),
    );
    expect(preferences.librarySource).toBe(provider);
    expect(preferences.browsing[`library:${provider}`].request).toMatchObject({
      query: "paged",
      offset,
    });
    await online
      .getByRole("button", { name: "Previous results", exact: true })
      .click();
    await expect(online.locator(".library-heading")).toHaveCount(10);
    await expect(
      online.getByRole("button", { name: "Previous results", exact: true }),
    ).toBeDisabled();
  });

  touchTest(
    `${provider} remembers picker browsing without reopening dialogs on reload`,
    async ({ page }) => {
      await (provider === "commons" ? mockCommons(page) : mockMet(page));
      await page.goto("./");
      await page
        .locator(".cell-image-button")
        .first()
        .tap({ position: { x: 5, y: 5 } });
      await selectField(page, "picker-image-source", provider);
      const online = await searchCommons(page, "paged");
      await expect(online.locator(".library-heading")).toHaveCount(10);
      await online
        .getByRole("button", { name: "Next results", exact: true })
        .click();
      await expect(
        online.locator(".library-heading").nth(provider === "commons" ? 0 : 2),
      ).toHaveValue(provider === "commons" ? "Moon" : "Vase");
      expect(new URL(page.url()).search).toBe("");
      await page.reload();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .locator(".cell-image-button")
        .first()
        .tap({ position: { x: 5, y: 5 } });
      await expect(page.locator("#picker-image-source")).toHaveText(
        provider === "commons" ? "Wikimedia Commons" : "The Met",
      );
      await expect(
        online.getByRole("searchbox", { name: "Search images", exact: true }),
      ).toHaveValue("paged");
      await expect(
        online.locator(".library-heading").nth(provider === "commons" ? 0 : 2),
      ).toHaveValue(provider === "commons" ? "Moon" : "Vase");
      expect(
        await page.evaluate(() =>
          document.activeElement?.matches("input,textarea"),
        ),
      ).toBe(false);
      await online
        .getByRole("button", { name: "Previous results", exact: true })
        .click();
      await expect(online.locator(".library-heading")).toHaveCount(10);
    },
  );

  test(`${provider} remembers sidebar navigation across reload and browser history`, async ({
    page,
  }) => {
    await mockCommons(page);
    await mockMet(page);
    await page.goto("./?extra=keep#anchor");
    await selectField(page, "sidebar-image-source", provider);
    const online = await searchCommons(page, "paged");
    await expect(online.locator(".library-heading")).toHaveCount(10);
    await online
      .getByRole("button", { name: "Next results", exact: true })
      .click();
    const last = provider === "commons" ? "Open 20" : "Vase";
    await expect(online.locator(".library-heading").last()).toHaveValue(last);
    const cleanUrl = page.url();
    expect(new URL(cleanUrl).search).toBe("?extra=keep");
    const preferences = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("grids-ui-v1")),
    );
    expect(preferences.browsing[`library:${provider}`].request.offset).toBe(
      provider === "commons" ? 13 : 16,
    );
    await page.goBack();
    await expect(online.locator(".library-heading")).toHaveCount(10);
    await expect(page).toHaveURL(cleanUrl);
    await page.goForward();
    await expect(online.locator(".library-heading").last()).toHaveValue(last);
    await expect(page).toHaveURL(cleanUrl);
    await openSidebarPanel(page, "Settings");
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "Settings", exact: true }),
    ).toBeDisabled();
    await openSidebarPanel(page, "Images");
    await expect(page.locator("#sidebar-image-source")).toHaveText(
      provider === "commons" ? "Wikimedia Commons" : "The Met",
    );
    await expect(
      online.getByRole("searchbox", { name: "Search images", exact: true }),
    ).toHaveValue("paged");
    await expect(online.locator(".library-heading").last()).toHaveValue(last);
    await online
      .getByRole("button", { name: "Previous results", exact: true })
      .click();
    await expect(online.locator(".library-heading")).toHaveCount(10);
    await online
      .getByRole("button", { name: "Next results", exact: true })
      .click();
    await expect(online.locator(".library-heading").last()).toHaveValue(last);
    await sidebarToggle(page, true).click();
    await page.reload();
    await expect(sidebarToggle(page, false)).toBeVisible();
    await openSidebarPanel(page, "Images");
    await expect(online.locator(".library-heading").last()).toHaveValue(last);
    const url = new URL(page.url());
    expect(url.searchParams.get("extra")).toBe("keep");
    expect(url.hash).toBe("#anchor");
    await selectField(
      page,
      "sidebar-image-source",
      provider === "commons" ? "met" : "commons",
    );
    await selectField(page, "sidebar-image-source", provider);
    await expect(online.locator(".library-heading").last()).toHaveValue(last);
    const topic = provider === "commons" ? "Nature" : "Sculpture";
    await online.getByRole("button", { name: topic, exact: true }).click();
    await expect(online).toHaveAttribute("aria-busy", "false");
    await page.reload();
    await expect(
      online.getByRole("button", { name: topic, exact: true }),
    ).toBeDisabled();
    await expect(
      online.getByRole("searchbox", { name: "Search images", exact: true }),
    ).toHaveValue("paged");
    expect(new URL(page.url()).search).toBe("?extra=keep");
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("grids-ui-v1")),
    );
    expect(saved.browsing[`library:${provider}`].request).toMatchObject({
      topic: topic.toLowerCase(),
      offset: 0,
    });
  });

  nativeTouchTest(
    `${provider} caches pages across views and refreshes after one hour`,
    async ({ page }) => {
      const mock = await (provider === "commons"
        ? mockCommons(page)
        : mockMet(page));
      await page.goto("./");
      await selectField(page, "sidebar-image-source", provider);
      const online = page.getByRole("region", { name: "Online", exact: true });
      await expect(online.locator(".library-heading")).toHaveValue(
        provider === "commons" ? "Earth" : "Iris",
      );
      await expect(online).toHaveAttribute("aria-busy", "false");
      await searchCommons(page, "paged");
      await expect(online.locator(".library-heading")).toHaveCount(10);
      await online
        .getByRole("button", { name: "Next results", exact: true })
        .click();
      await expect(
        online.locator(".library-heading").nth(provider === "commons" ? 0 : 2),
      ).toHaveValue(provider === "commons" ? "Moon" : "Vase");
      const visited = mock.requests.length;
      await online
        .getByRole("button", { name: "Previous results", exact: true })
        .click();
      await expect(online.locator(".library-heading")).toHaveCount(10);
      expect(mock.requests).toHaveLength(visited);
      await online.locator(".library-heading").first().fill("Local caption");
      await searchCommons(page, "different");
      const different = mock.requests.length;
      await searchCommons(page, "paged");
      await expect(online.locator(".library-heading").first()).toHaveValue(
        provider === "commons" ? "Earth" : "Iris",
      );
      expect(mock.requests).toHaveLength(different);
      await selectField(page, "sidebar-image-source", "imported");
      await selectField(page, "sidebar-image-source", provider);
      await expect(online.locator(".library-heading")).toHaveCount(10);
      await expect(online.locator(".library-heading").first()).toHaveValue(
        provider === "commons" ? "Earth" : "Iris",
      );
      expect(mock.requests).toHaveLength(different);
      if (provider === "met")
        expect(mock.detailRequests.filter((id) => id === 1)).toHaveLength(1);
      await page.locator(".cell-image-button").first().tap();
      const picker = page.getByRole("dialog", {
        name: "Choose image",
        exact: true,
      });
      await selectField(page, "picker-image-source", provider);
      const pickerOnline = picker.getByRole("region", {
        name: "Online",
        exact: true,
      });
      await expect(pickerOnline.locator(".library-heading")).toHaveValue(
        provider === "commons" ? "Earth" : "Iris",
      );
      await pickerOnline
        .getByRole("searchbox", { name: "Search images", exact: true })
        .fill("paged");
      await expect(pickerOnline.locator(".library-heading")).toHaveCount(10);
      expect(mock.requests).toHaveLength(different);
      const pickerPaged = mock.requests.length;
      await page.clock.setFixedTime(new Date(Date.now() + 3600000 + 5000));
      await pickerOnline
        .getByRole("searchbox", { name: "Search images", exact: true })
        .fill("different");
      await expect(pickerOnline).toHaveAttribute("aria-busy", "false");
      expect(mock.requests).toHaveLength(pickerPaged + 1);
      if (provider === "met")
        expect(mock.detailRequests.filter((id) => id === 1)).toHaveLength(2);
    },
  );

  test(`${provider} fills eligible pages and keeps exact next and previous cursors`, async ({
    page,
  }) => {
    const mock = await (provider === "commons"
      ? mockCommons(page)
      : mockMet(page));
    await page.goto("./");
    await selectField(page, "sidebar-image-source", provider);
    const online = await searchCommons(page, "paged");
    const headings = online.locator(".library-heading");
    const titles = [
      provider === "commons" ? "Earth" : "Iris",
      ...Array.from({ length: 9 }, (_, index) => `Open ${index + 10}`),
    ];
    await expect
      .poll(() =>
        headings.evaluateAll((elements) =>
          elements.map((element) => element.value),
        ),
      )
      .toEqual(titles);
    expect(
      mock.requests
        .filter((request) => request.query.startsWith("paged"))
        .map(({ offset, limit }) => ({ offset, limit })),
    ).toEqual([
      { offset: 0, limit: 10 },
      { offset: 10, limit: provider === "commons" ? 3 : 6 },
    ]);
    await online
      .getByRole("button", { name: "Next results", exact: true })
      .click();
    await expect
      .poll(() =>
        headings.evaluateAll((elements) =>
          elements.map((element) => element.value),
        ),
      )
      .toEqual(
        provider === "commons"
          ? ["Moon", "Open 19", "Open 20"]
          : ["Open 19", "Open 20", "Vase"],
      );
    expect(mock.requests.at(-1).offset).toBe(provider === "commons" ? 13 : 16);
    await expect(
      online.getByRole("button", { name: "Next results", exact: true }),
    ).toBeDisabled();
    await online
      .getByRole("button", { name: "Previous results", exact: true })
      .click();
    await expect
      .poll(() =>
        headings.evaluateAll((elements) =>
          elements.map((element) => element.value),
        ),
      )
      .toEqual(titles);
    await expect(
      online.getByRole("button", { name: "Previous results", exact: true }),
    ).toBeDisabled();
  });
}

test("Commons disables Next on a short filtered page even with a continuation cursor", async ({
  page,
}) => {
  const mock = await mockCommons(page);
  await page.goto("./?panel=images&source=commons&topic=all&q=shortcursor");
  const online = page.getByRole("region", { name: "Online", exact: true });
  await expect(online.locator(".library-heading")).toHaveCount(2);
  await expect(online).toHaveAttribute("aria-busy", "false");
  expect(mock.requests).toHaveLength(5);
  expect(mock.requests.at(-1).offset + mock.requests.at(-1).limit).toBeLessThan(
    72,
  );
  await expect(
    online.getByRole("button", { name: "Next results", exact: true }),
  ).toBeDisabled();
  await expect(online.getByRole("alert")).toHaveCount(0);
});

async function expectOnlineMessage(online, role) {
  await expect(online.getByRole(role)).toBeVisible();
}

test("online browsing exposes loading, empty results and errors", async ({
  page,
}) => {
  const mock = await mockCommons(page);
  await page.goto("./?panel=images&source=commons&topic=all");
  const online = page.getByRole("region", { name: "Online", exact: true });
  await expect(online.locator(".library-heading")).toHaveValue("Earth");
  await searchCommons(page, "slow", false);
  await expect
    .poll(() => mock.requests.some(({ query }) => query.startsWith("slow")))
    .toBe(true);
  await expect(online).toHaveAttribute("aria-busy", "true");
  page.emit("commons-release");
  await expect(online.locator(".library-heading")).toHaveValue("Stale");
  await expect(online).toHaveAttribute("aria-busy", "false");
  await searchCommons(page, "empty");
  await expect(online.getByRole("status")).toBeVisible();
  await searchCommons(page, "invalid");
  await expect(online.getByRole("alert")).toBeVisible();
});

for (const [mode, pickerTest] of [
  ["desktop", nativeTouchTest],
  ["mobile", touchTest],
]) {
  pickerTest(
    `image picker ${mode} handles loading, pagination, empty results and failures`,
    async ({ page }, testInfo) => {
      const mock = await mockCommons(page);
      await page.goto("./");
      await page.locator(".cell-image-button").first().tap();
      const picker = page.getByRole("dialog", {
        name: "Choose image",
        exact: true,
      });
      const imported = picker.getByRole("region", {
        name: "My images",
        exact: true,
      });
      await expect(imported.locator("[data-upload-tile]")).toHaveCount(1);

      await selectField(page, "picker-image-source", "commons");
      const online = picker.getByRole("region", {
        name: "Online",
        exact: true,
      });
      const placeholders = online.locator("[data-image-placeholder]");
      await expect(online.locator(".library-heading")).toHaveValue("Earth");

      await online.getByRole("searchbox").fill("slow");
      await expect
        .poll(() => mock.requests.some(({ query }) => query.startsWith("slow")))
        .toBe(true);

      await page.screenshot({
        path: testInfo.outputPath(`picker-${mode}-loading.png`),
        fullPage: true,
      });
      page.emit("commons-release");
      await expect(online).toHaveAttribute("aria-busy", "false");
      await expect(online.locator(".library-heading")).toHaveValue("Stale");

      for (const placeholder of await placeholders.all()) {
        await expect(placeholder).toHaveAttribute("aria-hidden", "true");
        await expect(
          placeholder.locator("button, a, input, textarea"),
        ).toHaveCount(0);
      }
      await online.getByRole("searchbox").fill("paged");
      await expect(online.locator(".library-heading")).toHaveCount(10);

      await online
        .getByRole("button", { name: "Next results", exact: true })
        .click();
      await expect(online.locator(".library-heading")).toHaveCount(3);

      await expect(
        online.getByRole("button", { name: "Next results", exact: true }),
      ).toBeDisabled();
      await online
        .getByRole("button", { name: "Previous results", exact: true })
        .click();
      await expect(online.locator(".library-heading")).toHaveCount(10);
      await online.getByRole("searchbox").fill("empty");
      await expect(online).toHaveAttribute("aria-busy", "false");

      await expectOnlineMessage(online, "status");
      await page.screenshot({
        path: testInfo.outputPath(`picker-${mode}-empty.png`),
        fullPage: true,
      });
      await online.getByRole("searchbox").fill("invalid");
      await expect(online.getByRole("alert")).toBeVisible();

      await expectOnlineMessage(online, "alert");
    },
  );
}

test("Commons paginates cached full pages when image-history continuation omits the search cursor", async ({
  page,
}) => {
  const mock = await mockCommons(page);
  await page.goto("./?panel=images&source=commons&topic=all&q=pagedhistory");
  const online = page.getByRole("region", { name: "Online", exact: true });
  const next = online.getByRole("button", {
    name: "Next results",
    exact: true,
  });
  const headings = online.locator(".library-heading");
  await expect(headings).toHaveCount(10);
  await expect(headings.last()).toHaveValue("Open 18");
  await expect(next).toBeEnabled();
  expect(mock.requests.map(({ offset, limit }) => ({ offset, limit }))).toEqual(
    [
      { offset: 0, limit: 10 },
      { offset: 10, limit: 3 },
    ],
  );
  await next.click();
  await expect(headings).toHaveCount(3);
  await expect(headings.first()).toHaveValue("Moon");
  await expect(headings.last()).toHaveValue("Open 20");
  await expect(next).toBeDisabled();
  expect(mock.requests.at(-1)).toMatchObject({ offset: 13, limit: 10 });
  await online
    .getByRole("button", { name: "Previous results", exact: true })
    .click();
  await expect(headings).toHaveCount(10);
  await expect(next).toBeEnabled();
  expect(mock.requests).toHaveLength(3);
});

test("Commons keeps collected images when the final batch has only image-history continuation", async ({
  page,
}) => {
  const mock = await mockCommons(page);
  await page.goto(
    "./?panel=images&source=commons&topic=all&q=historycontinuation",
  );
  const online = page.getByRole("region", { name: "Online", exact: true });
  const headings = online.locator(".library-heading");
  await expect(headings).toHaveCount(10);
  await expect(headings.first()).toHaveValue("Earth");
  await expect(headings.last()).toHaveValue("Open 18");
  await expect(online.getByRole("alert")).toHaveCount(0);
  await expect(
    online.getByRole("button", { name: "Next results", exact: true }),
  ).toBeDisabled();
  expect(mock.requests.map(({ offset, limit }) => ({ offset, limit }))).toEqual(
    [
      { offset: 0, limit: 10 },
      { offset: 10, limit: 1 },
    ],
  );
  await page.reload();
  await expect(headings).toHaveCount(10);
  await expect(online.getByRole("alert")).toHaveCount(0);
  expect(mock.requests).toHaveLength(4);
  await searchCommons(page, "invalidcursor");
  await expect(online.getByRole("alert")).toHaveText(
    "Wikimedia Commons returned an unexpected response.",
  );
});

test("Commons reports busy search responses without claiming a provider outage", async ({
  page,
}) => {
  const mock = await mockCommons(page);
  await page.goto("./?source=commons&topic=space&q=busy");
  const online = page.getByRole("region", { name: "Online", exact: true });
  await expect(online.getByRole("alert")).toHaveText(
    "Wikimedia Commons search is busy. Try again shortly.",
  );
  expect(mock.requests).toHaveLength(1);
  await searchCommons(page, "earth");
  await expect(online.locator(".library-heading")).toHaveValue("Earth");
  await searchCommons(page, "maxlag");
  await expect(online.getByRole("alert")).toHaveText(
    "Wikimedia Commons search is busy. Try again shortly.",
  );
  await searchCommons(page, "invalid");
  await expect(online.getByRole("alert")).toHaveText(
    "Wikimedia Commons returned an unexpected response.",
  );
  await searchCommons(page, "servicefailure");
  await expect(online.getByRole("alert")).toHaveText(
    "Could not load images from Wikimedia Commons. Try again.",
  );
  await searchCommons(page, "earth");
  await expect(online.locator(".library-heading")).toHaveValue("Earth");
  await expect(online.getByRole("alert")).toHaveCount(0);
});

test("Commons ignores stale searches and isolates empty malformed quota and offline failures", async ({
  page,
}) => {
  const mock = await mockCommons(page);
  await page.goto("./");
  await openSidebarPanel(page, "Images");
  await selectField(page, "sidebar-image-source", "commons");
  const online = await searchCommons(page, "slow", false);
  await expect
    .poll(() =>
      mock.requests.some((request) => request.query.startsWith("slow")),
    )
    .toBe(true);
  await searchCommons(page, "earth");
  await expect(online.locator(".library-heading")).toHaveValue("Earth");
  page.emit("commons-release");
  await expect(online.locator(".library-heading")).not.toHaveValue("Stale");
  await searchCommons(page, "empty");
  await expect(online.getByRole("status")).toHaveText(
    "No eligible images found. Try another search.",
  );
  await searchCommons(page, "invalid");
  await expect(online.getByRole("alert")).toHaveText(
    "Wikimedia Commons returned an unexpected response.",
  );
  await searchCommons(page, "quota");
  await expect(online.getByRole("alert")).toContainText("rate limiting");
  const requestsBefore = mock.requests.length;
  await searchCommons(page, "cooldown");
  await expect(online.getByRole("alert")).toContainText("rate limiting");
  expect(mock.requests).toHaveLength(requestsBefore);
  await searchCommons(page, "earth");
  await expect(online.locator(".library-heading")).toHaveValue("Earth");
  await expect(online.getByRole("alert")).toHaveCount(0);
  expect(mock.requests).toHaveLength(requestsBefore);
  await page.context().setOffline(true);
  await searchCommons(page, "offline");
  await expect(online.getByRole("alert")).toHaveText(
    "You are offline. Your saved images are still available.",
  );
  await page.context().setOffline(false);
  await selectField(page, "sidebar-image-source", "imported");
  await expect(page.locator("#asset-library")).toBeVisible();
  await expect(page.locator("#upload")).toBeAttached();
  await expect(page.locator(".grid-cell")).toHaveCount(9);
});

test("canvas padding keeps overflow inside its viewport on short and narrow screens", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1000 });
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  for (const id of ["canvas-padding", "gap"]) {
    await expect(page.locator(`#${id}`)).toHaveValue("50");
    await expect(page.locator(`#${id}`)).toHaveAttribute("max", "100");
    await page.locator(`#${id}`).fill("100");
  }
  for (const size of [
    { width: 1440, height: 360 },
    { width: 960, height: 360 },
    { width: 390, height: 560 },
    { width: 260, height: 560 },
  ]) {
    await setEditorViewport(page, size);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const workspace = document.querySelector(".workspace");
          const canvas = document.querySelector(".canvas-area");
          const frame = document
            .querySelector("[data-resize-frame]")
            .getBoundingClientRect();
          const bounds = canvas.getBoundingClientRect();
          return {
            workspaceHeight:
              workspace.scrollHeight <= workspace.clientHeight + 1,
            workspaceWidth: workspace.scrollWidth <= workspace.clientWidth + 1,
            pageWidth: document.documentElement.scrollWidth <= innerWidth,
            pageHeight:
              document.documentElement.scrollHeight <= innerHeight + 1,
            frameFits:
              frame.bottom <=
              bounds.bottom -
                parseFloat(getComputedStyle(canvas).paddingBottom) +
                1,
          };
        }),
      )
      .toEqual({
        workspaceHeight: true,
        workspaceWidth: true,
        pageWidth: true,
        pageHeight: true,
        frameFits: true,
      });
    const workspace = page.getByRole("region", {
      name: "Grid editor",
      exact: true,
    });

    const viewport = page.locator("[data-canvas-viewport]");
    await expect
      .poll(() =>
        viewport.evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    const heading = await page.locator(".board-export-heading").boundingBox();
    await viewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.scrollLeft = element.scrollWidth;
    });
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect(await page.locator(".board-export-heading").boundingBox()).toEqual(
      heading,
    );
    expect(
      await workspace.evaluate((element) => ({
        top: element.scrollTop,
        left: element.scrollLeft,
      })),
    ).toEqual({ top: 0, left: 0 });
  }
  await page.screenshot({
    path: testInfo.outputPath("canvas-only-scroll-narrow.png"),
  });
  await expect
    .poll(async () => {
      const { grid } = (await localDatabase(page)).document;
      return { gap: grid.gap, padding: grid.canvasPadding };
    })
    .toEqual({ gap: 120, padding: 120 });
  await page.reload();
  await openSidebarPanel(page, "Settings");
  await expect(page.locator("#canvas-padding")).toHaveValue("100");
  await expect(page.locator("#gap")).toHaveValue("100");
});

test("settings sliders use normalized percentages and midpoint defaults", async ({
  page,
}) => {
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  const sliders = page.locator('.settings-panel input[type="range"]');
  await expect(sliders).toHaveCount(9);
  for (const slider of await sliders.all()) {
    const id = await slider.getAttribute("id");
    const value =
      id === "cell-font-size" ? "20" : id === "caption-opacity" ? "60" : "50";
    await expect(slider).toHaveAttribute("min", "0");
    await expect(slider).toHaveAttribute("max", "100");
    await expect(slider).toHaveValue(value);
    await expect(slider.locator("..").locator("output")).toHaveText(
      id.endsWith("font-weight") ? "500" : `${value}%`,
    );
  }
  const padding = page.locator("#canvas-padding");
  await padding.click();
  await expect(padding).toBeFocused();

  const bounds = await padding.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.7,
    bounds.y + bounds.height / 2,
    { steps: 4 },
  );

  await page.mouse.up();

  await padding.press("Tab");
  const gap = page.locator("#gap");
  await expect(gap).toBeFocused();

  await gap.press("ArrowRight");

  await page.locator("#cell-font-size").fill("100");
  expect((await savedWorkspace(page)).grid.cellFontSize).toBe(36);
  for (const [id, percent] of [
    ["canvas-padding", 100],
    ["gap", 0],
    ["corner-rounding", 100],
    ["heading-font-size", 100],
    ["heading-padding", 100],
    ["cell-font-size", 0],
    ["heading-font-weight", 0],
    ["cell-font-weight", 100],
    ["caption-opacity", 0],
  ]) {
    await page.locator(`#${id}`).fill(String(percent));
    const output =
      id === "heading-font-weight"
        ? "100"
        : id === "cell-font-weight"
          ? "900"
          : `${percent}%`;
    await expect(
      page.locator(`#${id}`).locator("..").locator("output"),
    ).toHaveText(output);
  }
  expect((await savedWorkspace(page)).grid).toMatchObject({
    canvasPadding: 120,
    gap: 0,
    cornerRadius: 25,
    headingFontSize: 36,
    headingPadding: 60,
    cellFontSize: 6,
    headingFontWeight: 100,
    cellFontWeight: 900,
    captionOverlayOpacity: 0,
  });
  await reloadWorkspace(page);
  await openSidebarPanel(page, "Settings");
  await expect(page.locator("#canvas-padding")).toHaveValue("100");
  await expect(page.locator("#cell-font-size")).toHaveValue("0");
  await expect(page.locator("#heading-padding")).toHaveValue("100");
  await page.locator("#export-grid-header").click();
  await selectField(page, "format", "image/jpeg");
  const quality = page.locator("#quality");
  await expect(quality).toHaveAttribute("min", "0");
  await expect(quality).toHaveAttribute("max", "100");
  await expect(quality).toHaveValue("90");
  await expect(page.locator("#quality-value")).toHaveText("90%");
  expect((await savedWorkspace(page)).exportSettings.quality).toBe(95);
  await quality.fill("0");
  expect((await savedWorkspace(page)).exportSettings.quality).toBe(50);
  await quality.fill("100");
  expect((await savedWorkspace(page)).exportSettings.quality).toBe(100);
});

test("corner rounding is shared by headings, cards, pickers and exports", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await mockCommons(page);
  await page.goto("./");
  await uploadCellImage(page);
  await editHeading(page, "Rounded heading");
  await openSidebarPanel(page, "Settings");
  const canvasStyle = page.getByRole("group", {
    name: "Canvas style",
    exact: true,
  });
  const rounding = canvasStyle.getByRole("slider", {
    name: /^Corner rounding/,
  });
  await expect(rounding).toHaveValue("50");
  async function checkRounding(cards, percent) {
    await expect(cards.first()).toBeVisible();
    for (const card of await cards.all()) {
      expect(
        await card.evaluate((element, percent) => {
          const bounds = element.getBoundingClientRect();
          const radii =
            getComputedStyle(element).borderTopLeftRadius.split(" ");
          const horizontal = radii[0].endsWith("%")
            ? (parseFloat(radii[0]) * bounds.width) / 100
            : parseFloat(radii[0]);
          const verticalValue = radii[1] ?? radii[0];
          const vertical = verticalValue.endsWith("%")
            ? (parseFloat(verticalValue) * bounds.height) / 100
            : parseFloat(verticalValue);
          const expected = (bounds.width * percent) / 100;
          return Math.max(
            Math.abs(horizontal - expected),
            Math.abs(vertical - expected),
          );
        }, percent),
      ).toBeLessThan(1);
    }
  }
  await expect(
    page
      .getByRole("group", { name: "Card style", exact: true })
      .locator("#corner-rounding"),
  ).toHaveCount(0);
  for (const [id, value] of [
    ["background-value", "#17191b"],
    ["heading-background-color-value", "#ed1d24"],
    ["cell-background-color-value", "#0085c7"],
  ]) {
    await page.locator(`#${id}`).fill(value);
    await page.locator(`#${id}`).press("Tab");
  }
  for (const radius of [12, 0]) {
    await openSidebarPanel(page, "Settings");
    await rounding.fill(String(radius * 4));
    await reloadWorkspace(page);
    await openSidebarPanel(page, "Settings");
    await expect(rounding).toHaveValue(String(radius * 4));
    await expect(
      canvasStyle.locator('label[for="corner-rounding"] output'),
    ).toHaveText(`${radius * 4}%`);
    await checkRounding(page.locator(".grid-cell"), radius);
    const headingRadius = await page
      .locator(".board-export-heading")
      .evaluate((heading) =>
        parseFloat(getComputedStyle(heading).borderTopLeftRadius),
      );
    const cardWidth = await page
      .locator(".grid-cell")
      .first()
      .evaluate((card) => card.getBoundingClientRect().width);
    expect(headingRadius).toBeCloseTo((cardWidth * radius) / 100, 0);
    const grid = (await savedWorkspace(page)).grid;
    expect(grid.cornerRadius).toBe(radius);
    for (const size of [150, 300]) {
      await selectExportField(page, "resolution", String(size));
      const download = await downloadBoard(page);
      const bytes = [...(await readFile(await download.path()))];
      const pixels = await page.evaluate(
        async ({ bytes, grid, size }) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)]),
          );
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          const padding = Math.round(((grid.canvasPadding ?? 12) * size) / 600);
          const gap = Math.round((grid.gap * size) / 600);
          const top =
            padding +
            Math.round(
              size *
                (Math.max(0.28, (grid.headingFontSize ?? 21) * 0.014) +
                  (grid.headingPadding ?? 30) / 300),
            ) +
            gap;
          return [
            [padding, padding],
            [canvas.width / 2, padding + 1],
            [padding, top],
            [padding + size / 2, top + 1],
          ].map(([left, top]) => [
            ...context.getImageData(left, top, 1, 1).data,
          ]);
        },
        { bytes, grid, size },
      );
      expect(pixels).toEqual([
        radius ? [23, 25, 27, 255] : [237, 29, 36, 255],
        [237, 29, 36, 255],
        radius ? [23, 25, 27, 255] : [0, 133, 199, 255],
        [0, 133, 199, 255],
      ]);
    }
  }
  await openSidebarPanel(page, "Settings");
  await rounding.fill("48");
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1000 });
    if (width > 900) {
      await openSidebarPanel(page, "Images");
      await checkRounding(page.locator(".asset-panel .image-card"), 12);
    }
    await page.locator(".cell-image-button").nth(1).click();
    const picker = page.getByRole("dialog", {
      name: "Choose image",
      exact: true,
    });
    await selectField(page, "picker-image-source", "imported");
    await checkRounding(picker.locator("[data-library-image] .image-card"), 12);
    await selectField(page, "picker-image-source", "commons");
    await expect(
      picker.getByRole("region", { name: "Online", exact: true }),
    ).toHaveAttribute("aria-busy", "false");
    await checkRounding(picker.locator("[data-library-image] .image-card"), 12);
    await page.screenshot({
      path: testInfo.outputPath(`shared-rounding-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
  }
  await openSidebarPanel(page, "Settings");
  await page.getByRole("switch", { name: "Show heading", exact: true }).click();
  await page.getByRole("switch", { name: "Show titles", exact: true }).click();
  await expect(rounding).toBeVisible();
});

test("appearance choices support keyboard selection on narrow and desktop screens", async ({
  page,
}, testInfo) => {
  for (const width of [1440, 390, 260]) {
    await setEditorViewport(page, { width, height: 1000 });
    await page.goto("./");
    await openSidebarPanel(page, "Settings");
    const shapes = page.getByRole("radiogroup", {
      name: "Shape",
      exact: true,
    });
    const headings = page.getByRole("radiogroup", {
      name: "Card heading",
      exact: true,
    });
    await expect(shapes.getByRole("radio")).toHaveCount(3);
    await expect(
      page
        .getByRole("group", { name: "Card style", exact: true })
        .locator("#image-shape"),
    ).toHaveCount(1);
    await expect(
      page
        .getByRole("group", { name: "Canvas style", exact: true })
        .locator("#image-shape"),
    ).toHaveCount(0);
    await expect(headings.getByRole("radio")).toHaveCount(4);
    await expect(
      page.getByRole("toolbar", { name: "Grid appearance" }),
    ).toHaveCount(0);
    for (const name of ["Canvas style", "Canvas heading style", "Card style"]) {
    }
    const portrait = shapes.getByRole("radio", {
      name: "Portrait",
      exact: true,
    });
    if (!(await portrait.isChecked())) await portrait.click();
    await expect(portrait).toBeDisabled();
    await expect(portrait).toHaveJSProperty("disabled", true);

    await expect(portrait).toHaveAttribute("tabindex", "-1");
    const landscape = shapes.getByRole("radio", {
      name: "Landscape",
      exact: true,
    });
    await expect(landscape).toBeEnabled();
    await landscape.focus();
    await landscape.press(" ");
    await expect(
      shapes.getByRole("radio", { name: "Landscape", exact: true }),
    ).toBeChecked();
    await expect(landscape).toBeDisabled();
    await expect(landscape).toHaveJSProperty("disabled", true);

    await expect(portrait).toBeEnabled();
    const overlayTop = headings.getByRole("radio", {
      name: "Overlay top",
      exact: true,
    });
    if (!(await overlayTop.isChecked())) await overlayTop.click();
    await expect(overlayTop).toHaveJSProperty("disabled", true);

    await expect(
      headings.getByRole("radio", { name: "Overlay top", exact: true }),
    ).toBeChecked();
    await expect(
      headings.getByRole("radio", { name: "Overlay top", exact: true }),
    ).toBeDisabled();
    expect((await savedWorkspace(page)).grid).toMatchObject({
      imageAspect: "landscape",
      captionPlacement: "overlay",
      captionAlignment: "top",
    });
    await reloadWorkspace(page);
    await expect(
      shapes.getByRole("radio", { name: "Landscape", exact: true }),
    ).toBeChecked();
    await expect(
      headings.getByRole("radio", { name: "Overlay top", exact: true }),
    ).toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("header actions open export and restore sidebar settings and focus", async ({
  page,
}) => {
  await setEditorViewport(page, { width: 1440, height: 900 });
  await page.goto("./");
  const header = page.locator("[data-canvas-header]");
  const sidebar = page.locator("[data-editor-sidebar]");
  await header
    .getByRole("button", { name: "Menu", exact: true })
    .click({ trial: true });
  await openSidebarPanel(page, "Settings");
  await page.locator("#background-value").fill("#112233");
  await page.locator("#background-value").press("Enter");
  await closeSidebarPanel(page);
  const show = header.getByRole("button", {
    name: "Show sidebar",
    exact: true,
  });
  await expect(show).toBeFocused();
  await show.click();
  await expect(sidebar).toBeVisible();
  await expect(page.locator("#background-value")).toHaveValue("#112233");
  const exportButton = header.getByRole("button", {
    name: "Export grid",
    exact: true,
  });
  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(exportButton).toBeFocused();
});

test("sidebar keyboard navigation skips selected tabs and preserves settings across toggles", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  const sidebar = page.locator("[data-editor-sidebar]");
  const header = page.locator("[data-canvas-header]");
  const commands = sidebar.getByRole("tablist", {
    name: "Editor panels",
    exact: true,
  });
  await expect(sidebar.getByRole("tablist")).toHaveCount(1);
  await expect(header.getByRole("tab")).toHaveCount(0);
  await expect(sidebar.locator("[data-sidebar-brand]")).toHaveCount(0);
  await expect(
    header.getByRole("link", { name: "Gridz", exact: true }),
  ).toBeVisible();

  await expect(commands.locator(":scope > button")).toHaveCount(3);
  const images = commands.getByRole("tab", { name: "Images", exact: true });
  const settings = commands.getByRole("tab", { name: "Settings", exact: true });
  const exportButton = page
    .locator("[data-canvas-header]")
    .getByRole("button", {
      name: "Export grid",
      exact: true,
    });
  await expect(images).toHaveAttribute("aria-selected", "true");
  await expect(images).toBeDisabled();
  await expect(images).toHaveJSProperty("disabled", true);

  await expect(images).toHaveAttribute("tabindex", "-1");
  const closeSidebar = page
    .locator("[data-canvas-header]")
    .getByRole("button", {
      name: "Close sidebar",
      exact: true,
    });
  await closeSidebar.focus();
  await tabThroughTo(page, settings);
  await expect(settings).toBeFocused();
  await settings.press("Enter");
  await expect(settings).toHaveAttribute("aria-selected", "true");
  await expect(settings).toBeDisabled();
  await expect(settings).toHaveJSProperty("disabled", true);

  await expect(images).toBeEnabled();
  await expect(
    sidebar.getByRole("group", { name: "Canvas style", exact: true }),
  ).toBeVisible();
  await closeSidebar.focus();
  await tabThroughTo(page, images);
  await expect(images).toBeFocused();
  await images.press("Enter");
  await expect(images).toHaveAttribute("aria-selected", "true");
  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(exportButton).toBeFocused();
  await commands.screenshot({
    path: testInfo.outputPath("sidebar-command-tiles.png"),
  });
  await settings.click();
  await page.locator("#background-value").fill("#112233");
  await page.locator("#background-value").press("Enter");
  await closeSidebar.click();
  await expect(sidebar).toHaveCount(0);
  const canvasHeader = page.locator("[data-canvas-header]");
  const canvasSettings = canvasHeader.getByRole("button", {
    name: "Show sidebar",
    exact: true,
  });
  await expect(canvasSettings).toBeFocused();

  await expect(
    canvasHeader
      .getByRole("group", { name: "Editor panels", exact: true })
      .locator(":scope > button"),
  ).toHaveCount(3);
  await page.screenshot({
    path: testInfo.outputPath("desktop-sidebar-closed.png"),
  });
  await canvasSettings.click();
  await expect(sidebar).toBeVisible();
  await expect(canvasHeader).toBeVisible();
  await expect(settings).toHaveJSProperty("disabled", true);
  await expect(page.locator("#background-value")).toHaveValue("#112233");
  await closeSidebar.click();
});

test("sidebar controls remain reachable while scrolling images", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 600 });
  await page.goto("./");
  await useComicExample(page, "dc");
  const sidebar = page.locator("[data-editor-sidebar]");
  const sticky = sidebar.locator("[data-sidebar-sticky]");
  const controls = sidebar.locator("[data-panel-controls]");
  await expect(
    page
      .locator("[data-canvas-header]")
      .getByRole("link", { name: "Gridz", exact: true }),
  ).toBeVisible();
  await expect(sidebar.locator("[data-sidebar-brand]")).toHaveCount(0);

  expect(
    await sidebar.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  for (const scrollTop of [100, 200, 300, 400, 500, 600]) {
    await sidebar.evaluate((element, top) => {
      element.scrollTop = top;
    }, scrollTop);
    await expect(sticky).toBeInViewport();
    expect(
      await sticky.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        for (let offset = 4; offset < bounds.height; offset += 8) {
          const foreground = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + offset,
          );
          if (!element.contains(foreground)) return false;
        }
        return true;
      }),
    ).toBe(true);
  }
  await sidebar.screenshot({
    path: testInfo.outputPath("sticky-sidebar-scrolled.png"),
  });
});

test("right sidebar switches images and settings with an image source dropdown", async ({
  page,
}) => {
  await mockCommons(page);
  await page.goto("./");
  const sidebar = page.locator("[data-editor-sidebar]");
  const images = sidebar.getByRole("tab", { name: "Images", exact: true });
  const settings = sidebar.getByRole("tab", { name: "Settings", exact: true });
  await expect(sidebar).toHaveCount(1);
  await expect(images).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sidebar-image-source")).toBeVisible();
  await expect(page.locator("#background-value")).toBeHidden();

  await page.locator("#sidebar-image-source").click();
  await expect(page.getByRole("option")).toHaveText([
    "My images",
    "Wikimedia Commons",
    "The Met",
    "SMK",
    "iNaturalist",
    "Openverse",
    "Rijksmuseum",
    "Wellcome Collection",
  ]);
  await expect(
    page.getByRole("option", { name: "My images", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "My images", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("option", { name: "Wikimedia Commons", exact: true }),
  ).toBeEnabled();
  await page.getByRole("listbox").press("Escape");
  await page.locator("#upload").setInputFiles({
    name: "panel-image.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff0000"/></svg>',
    ),
  });
  await expect(sidebar.locator(".asset")).toHaveCount(1);

  await selectField(page, "sidebar-image-source", "commons");
  await expect(
    page.getByRole("region", { name: "Online", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.locator("button[aria-haspopup='listbox']:visible"),
  ).toHaveCount(1);
  await selectField(page, "sidebar-image-source", "imported");
  await expect(sidebar.locator(".asset")).toBeVisible();
  await settings.click();
  await expect(page.locator("#sidebar-image-source")).toBeHidden();
  await page.locator("#background-value").fill("#112233");
  await page.locator("#background-value").press("Enter");
  await images.click();
  await expect(sidebar.locator(".asset")).toBeVisible();
  await settings.press("Enter");
  await expect(settings).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#background-value")).toHaveValue("#112233");
  const content = sidebar;
  await content.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "Reset grid settings", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await images.click();
  await page
    .getByRole("button", { name: "Add image to cell 1", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await expect(picker.locator("#picker-image-source")).toBeVisible();
  await expect(picker.getByRole("tablist")).toHaveCount(0);
  await picker
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await setEditorViewport(page, { width: 390, height: 844 });
  await expect(sidebar).toHaveCount(1);
  await settings.click();
  await expect(page.locator("#background-value")).toHaveValue("#112233");
});

test("responsive grid resizing keeps controls reachable and preserves cell contents", async ({
  page,
}) => {
  await page.goto("./");
  await uploadCellImage(page);
  await page.locator(".cell-heading").first().fill("Keep caption");
  const original = await savedWorkspace(page);
  for (const viewport of [
    { width: 1900, height: 1000 },
    { width: 1440, height: 1000 },
    { width: 390, height: 720 },
    { width: 1440, height: 360 },
  ]) {
    await setEditorViewport(page, viewport);
    for (const dimension of ["row", "column"]) {
      await page
        .getByRole("button", { name: `Add ${dimension}`, exact: true })
        .click();
      await expect(page.locator(".grid-cell")).toHaveCount(12);
      await expect(page.locator(".cell-heading").first()).toHaveValue(
        "Keep caption",
      );
      for (const name of [
        "Add row",
        "Remove row",
        "Add column",
        "Remove column",
        "Reset grid",
      ]) {
        const button = page.getByRole("button", { name, exact: true });
        await expect(button).toBeInViewport();
        await button.click({ trial: true });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: `Remove ${dimension}`, exact: true })
        .click();
      await expect(page.locator(".grid-cell")).toHaveCount(9);
      expect((await savedWorkspace(page)).grid.cells).toEqual(
        original.grid.cells,
      );
    }
  }
  await setEditorViewport(page, { width: 390, height: 720 });
  for (let count = 0; count < 2; count++)
    await page.getByRole("button", { name: "Add row", exact: true }).click();
  const scroller = page.locator("[data-canvas-viewport]");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
  });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(page.locator(".board-export-heading")).toBeInViewport();
});

scrollbarTest(
  "horizontal-only grid overflow shows a usable workspace scrollbar",
  async ({ page }, testInfo) => {
    await page.goto("./");
    for (let count = 0; count < 2; count++)
      await page
        .getByRole("button", { name: "Remove row", exact: true })
        .click();
    await openSidebarPanel(page, "Settings");
    await selectField(page, "caption-position", "overlay-bottom");
    await closeSidebarPanel(page);
    const scroller = page.locator("[data-workspace-scroll]");
    const viewport = page.locator("[data-canvas-viewport]");
    for (const width of [462, 390]) {
      await setEditorViewport(page, { width, height: 727 });
      await scroller.evaluate((element) => element.scrollTo(0, 0));
      await expect
        .poll(() =>
          viewport.evaluate(
            (element) => element.scrollWidth - element.clientWidth,
          ),
        )
        .toBeGreaterThan(0);
      const overflow = await viewport.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      );
      const gutter = await page.evaluate(() =>
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--native-scrollbar-width",
          ),
        ),
      );
      expect(gutter).toBeGreaterThan(0);
      if (width === 462) expect(overflow).toBeLessThan(gutter);
      await expect
        .poll(() =>
          scroller.evaluate(
            (element) => element.offsetHeight - element.clientHeight,
          ),
        )
        .toBeGreaterThan(0);
      expect(
        await viewport.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      ).toBe(0);
      const heading = page.locator(".board-export-heading");
      const before = await heading.boundingBox();
      const bounds = await scroller.boundingBox();
      await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await page.mouse.wheel(1000, 0);
      await expect
        .poll(() => viewport.evaluate((element) => element.scrollLeft))
        .toBe(overflow);
      expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(
        overflow,
      );
      expect(await heading.boundingBox()).toEqual(before);
      const last = await page.locator(".grid-cell").last().boundingBox();
      const visible = await viewport.boundingBox();
      expect(last.x + last.width).toBeLessThanOrEqual(
        visible.x + visible.width + 1,
      );
      await page.screenshot({
        path: testInfo.outputPath(`horizontal-only-${width}.png`),
      });
    }
  },
);

nativeTouchTest(
  "workspace-edge scrolling moves grid items while heading and controls stay fixed",
  async ({ page }, testInfo) => {
    await setEditorViewport(page, { width: 960, height: 600 });
    await page.goto("./");
    await useComicExample(page);
    for (const dimension of ["column", "row"])
      for (let count = 0; count < 4; count++)
        await page
          .getByRole("button", { name: `Add ${dimension}`, exact: true })
          .click();
    const scroller = page.locator("[data-workspace-scroll]");
    const gridViewport = page.locator("[data-canvas-viewport]");
    const fixed = [
      page.locator("[data-canvas-header]"),
      page.locator(".board-export-heading"),
      page.getByRole("group", { name: "Row controls", exact: true }),
      page.getByRole("group", { name: "Column controls", exact: true }),
      page.getByRole("button", { name: "Reset grid", exact: true }),
    ];
    for (const width of [960, 390]) {
      await setEditorViewport(page, { width, height: 600 });
      await scroller.evaluate((element) => element.scrollTo(0, 0));
      await expect
        .poll(() =>
          gridViewport.evaluate((element) => [
            element.scrollLeft,
            element.scrollTop,
          ]),
        )
        .toEqual([0, 0]);

      expect(
        await scroller.evaluate((element) => [
          element.scrollWidth > element.clientWidth,
          element.scrollHeight > element.clientHeight,
        ]),
      ).toEqual([true, true]);
      const bounds = await scroller.boundingBox();
      const region = await page.locator(".workspace").boundingBox();
      expect(bounds.x + bounds.width).toBe(region.x + region.width);
      expect(bounds.y + bounds.height).toBe(region.y + region.height);
      const before = await Promise.all(
        fixed.map((locator) => locator.boundingBox()),
      );
      const cardBefore = await page.locator(".grid-cell").first().boundingBox();
      if (width === 960) {
        expect(
          await scroller.evaluate(async (outer) => {
            const inner = outer.querySelector("[data-canvas-viewport]");
            let advanced = false;
            const advanceScroll = () => {
              if (!advanced && outer.scrollTop === 100) {
                advanced = true;
                outer.scrollTo(200, 200);
              }
            };
            outer.addEventListener("scroll", advanceScroll);
            try {
              outer.scrollTo(100, 100);
              for (let frame = 0; frame < 6; frame++)
                await new Promise(requestAnimationFrame);
              return [
                outer.scrollLeft,
                outer.scrollTop,
                inner.scrollLeft,
                inner.scrollTop,
              ];
            } finally {
              outer.removeEventListener("scroll", advanceScroll);
            }
          }),
        ).toEqual([200, 200, 200, 200]);
        await scroller.evaluate((element) => element.scrollTo(0, 0));
        await expect
          .poll(() =>
            gridViewport.evaluate((element) => [
              element.scrollLeft,
              element.scrollTop,
            ]),
          )
          .toEqual([0, 0]);
        await page.mouse.move(bounds.x + 4, bounds.y + 120);
        await page.mouse.wheel(160, 180);
        await expect
          .poll(() =>
            scroller.evaluate((element) => [
              element.scrollLeft,
              element.scrollTop,
            ]),
          )
          .toEqual([160, 180]);
      } else {
        const session = await page.context().newCDPSession(page);
        const swipe = async (start, end) => {
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ ...start, id: 1 }],
          });
          for (let step = 1; step <= 8; step++)
            await session.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [
                {
                  x: start.x + ((end.x - start.x) * step) / 8,
                  y: start.y + ((end.y - start.y) * step) / 8,
                  id: 1,
                },
              ],
            });
          await session.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        };
        await swipe(
          { x: bounds.x + 4, y: bounds.y + 350 },
          { x: bounds.x + 4, y: bounds.y + 180 },
        );
        const area = await scroller.evaluate((element) => ({
          width: element.clientWidth,
          height: element.clientHeight,
        }));
        await swipe(
          { x: bounds.x + area.width * 0.8, y: bounds.y + area.height - 4 },
          { x: bounds.x + area.width * 0.3, y: bounds.y + area.height - 4 },
        );
        await session.detach();
      }
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await expect
        .poll(async () => {
          const outer = await scroller.evaluate((element) => [
            element.scrollLeft,
            element.scrollTop,
          ]);
          const inner = await gridViewport.evaluate((element) => [
            element.scrollLeft,
            element.scrollTop,
          ]);
          return Math.max(
            ...outer.map((offset, index) => Math.abs(offset - inner[index])),
          );
        })
        .toBeLessThan(1);
      const cardAfter = await page.locator(".grid-cell").first().boundingBox();
      expect(cardAfter.x).toBeLessThan(cardBefore.x);
      expect(cardAfter.y).toBeLessThan(cardBefore.y);
      expect(
        await Promise.all(fixed.map((locator) => locator.boundingBox())),
      ).toEqual(before);
      expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
      await page.screenshot({
        path: testInfo.outputPath(`workspace-scroll-${width}.png`),
      });
    }
  },
);

test("full grid reset confirms a clean slate and retains library images through reload", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  await editHeading(page, "Reset this heading");
  await openSidebarPanel(page, "Settings");
  await page.locator("#gap").fill("20");
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  const before = await savedWorkspace(page);
  const blobs = (await localDatabase(page)).images;
  const trigger = page.getByRole("button", { name: "Reset grid", exact: true });
  const dialog = page.getByRole("dialog", { name: "Reset grid", exact: true });
  for (const width of [260, 390, 1440]) {
    await setEditorViewport(page, { width, height: 900 });
    await openSidebarPanel(page, "Settings");
    const settingsReset = page.getByRole("button", {
      name: "Reset grid settings",
      exact: true,
    });
    await settingsReset.scrollIntoViewIfNeeded();
    await expect(settingsReset).toBeVisible();
    await expect(
      page
        .locator(".settings-panel")
        .getByRole("button", { name: "Reset grid", exact: true }),
    ).toHaveCount(0);
    await closeSidebarPanel(page);
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("title", "Reset grid");

    expect(await trigger.textContent()).toBe("");
    const gridBounds = await trigger.boundingBox();

    const controlsOwner = page.locator(
      (await page
        .locator("[data-canvas-header]")
        .getByRole("button", { name: "Add row", exact: true })
        .count())
        ? "[data-canvas-header]"
        : "[data-resize-frame]",
    );
    await expect(
      controlsOwner.getByRole("button", { name: "Reset grid", exact: true }),
    ).toBeVisible();
    const ownerBounds = await controlsOwner.boundingBox();
    expect(gridBounds.x).toBeGreaterThanOrEqual(ownerBounds.x);
    expect(gridBounds.x + gridBounds.width).toBeLessThanOrEqual(
      ownerBounds.x + ownerBounds.width,
    );
    expect(gridBounds.y).toBeGreaterThanOrEqual(ownerBounds.y);
    expect(gridBounds.y + gridBounds.height).toBeLessThanOrEqual(
      ownerBounds.y + ownerBounds.height,
    );
    for (const label of [
      "Add row",
      "Remove row",
      "Add column",
      "Remove column",
    ]) {
      const controls = await controlsOwner
        .getByRole("button", { name: label, exact: true })
        .boundingBox();
      const button = controlsOwner.getByRole("button", {
        name: label,
        exact: true,
      });
      await page.mouse.move(0, 0);
      await expect(button.locator("svg")).toHaveCount(1);
      expect(await button.textContent()).toBe("");
      const colors = await button.evaluate((element) => {
        const style = getComputedStyle(element);
        const reset = getComputedStyle(
          document.querySelector('button[aria-label="Reset grid"]'),
        );
        return {
          actual: [style.backgroundColor, style.color, style.borderColor],
          reset: [reset.backgroundColor, reset.color, reset.borderColor],
        };
      });
      expect(colors.actual).toEqual(colors.reset);
      expect(
        gridBounds.x < controls.x + controls.width &&
          gridBounds.x + gridBounds.width > controls.x &&
          gridBounds.y < controls.y + controls.height &&
          gridBounds.y + gridBounds.height > controls.y,
      ).toBe(false);
    }
    await page.screenshot({
      path: testInfo.outputPath(`canvas-reset-${width}.png`),
    });
    await trigger.click();
    await expect(dialog).toContainText("Images in My images are kept.");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect((await localDatabase(page)).document).toEqual(before);
  }
  await trigger.click();
  await dialog.getByRole("button", { name: "Reset grid", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.id)
    .not.toBe(before.grid.id);
  const reset = await savedWorkspace(page);
  expect(reset.grid).toMatchObject({
    rows: 3,
    columns: 3,
    heading: "",
    gap: 60,
    overflow: [],
  });
  expect(
    reset.grid.cells.every(
      (cell) => !cell.assetId && !cell.title && !cell.crop,
    ),
  ).toBe(true);
  expect(reset.assets).toEqual(before.assets);
  expect((await localDatabase(page)).images).toEqual(blobs);
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).grid).toEqual(reset.grid);
  await openSidebarPanel(page, "Images");
  await expect(page.locator(".asset")).toHaveCount(before.assets.length);
  await expect(page.locator(".grid-cell img")).toHaveCount(0);
});

test("sidebar scrolling stays independent of page scrolling and export dialogs remain usable", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  await page.locator("#upload").setInputFiles(
    ["One", "Two", "Three"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(3);
  await savedWorkspace(page);
  for (const width of [1440, 960]) {
    await setEditorViewport(page, { width, height: 3000 });
    await openSidebarPanel(page, "Images");
    for (const selector of [".asset-panel", ".settings-panel"]) {
      const sidebar = page.locator("[data-editor-sidebar]");
      await openSidebarPanel(
        page,
        selector === ".asset-panel" ? "Images" : "Settings",
      );
      const aside = page.locator(selector);

      const body = sidebar;

      const header = sidebar.locator("[data-sidebar-sticky]");
      const before = await body.evaluate((element) => {
        element.scrollTop = 0;
        const child = element
          .querySelector(
            '[role="tabpanel"]:not([hidden]) [data-sidebar-content]',
          )
          .getBoundingClientRect();
        return {
          x: child.x,
          width: child.width,
          height: element.getBoundingClientRect().height,
          overflowing: element.scrollHeight > element.clientHeight,
        };
      });
      expect(before.height).toBeGreaterThan(0);
      expect(before.height).toBeLessThan(3000);
      expect(before.overflowing).toBe(false);
      await body.evaluate((element) => {
        const spacer = document.createElement("div");
        spacer.dataset.scrollProbe = "";
        spacer.style.height = "6000px";
        spacer.style.flexShrink = "0";
        element.append(spacer);
      });
      await expect
        .poll(() =>
          body.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        )
        .toBe(true);
      const pageScroll = await page.evaluate(() => scrollY);
      await body.hover();
      await page.mouse.wheel(0, 160);
      await expect
        .poll(() => body.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
      await expect(header).toBeInViewport();
      await body.evaluate((element) => {
        element.querySelector("[data-scroll-probe]").remove();
        element.scrollTop = 0;
      });
      expect(
        await aside.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await aside.screenshot({
        path: testInfo.outputPath(`aside-${selector.slice(1)}-${width}.png`),
      });
    }
  }
  const settings = page.locator(".settings-panel");
  await page.locator("#export-grid-header").click();
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  await expect(dialog).toBeVisible();

  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);

  await setEditorViewport(page, { width: 390, height: 844 });
  await showSidebar(page);
});

test("font previews and independent weights persist and match exports without themes", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1000 });
  await page.addInitScript(() => {
    window.fontWeightDraws = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.fontWeightDraws.push({ text, font: this.font });
      return fillText.call(this, text, ...args);
    };
  });
  await page.goto("./");
  await uploadCellImage(page);
  await openSidebarPanel(page, "Settings");
  await expect(page.locator("#theme-selector")).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Superhero sub-theme", exact: true }),
  ).toHaveCount(0);
  for (const id of ["heading-font", "cell-font"]) {
    await page.locator(`#${id}`).click();
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
      "Bangers",
      "Bebas Neue",
      "Boogaloo",
      "Manrope",
    ]);
    const selected = page
      .getByRole("listbox")
      .locator('[aria-selected="true"]');
    await expect(selected).toHaveJSProperty("disabled", true);

    await page.getByRole("listbox").press("Home");
    await expect(
      page.getByRole("option", { name: "Bangers", exact: true }),
    ).toHaveAttribute("data-focus", "");
    await expect(selected).not.toHaveAttribute("data-focus", "");

    for (const font of ["Manrope", "Bangers", "Boogaloo", "Bebas Neue"]) {
      const option = page
        .getByRole("listbox")
        .locator(`[data-value="${font}"]`);

      await expect
        .poll(() =>
          option.evaluate((element) =>
            getComputedStyle(element).fontFamily.replaceAll('"', ""),
          ),
        )
        .toBe(font);
    }
    await page.keyboard.press("Escape");
    for (const font of ["Bangers", "Boogaloo", "Bebas Neue", "Manrope"]) {
      await selectField(page, id, font);

      await expect
        .poll(() =>
          page
            .locator(`#${id} span`)
            .evaluate((element) =>
              getComputedStyle(element).fontFamily.replaceAll('"', ""),
            ),
        )
        .toBe(font);
      const weight = page.locator(`#${id}-weight`);
      await expect(weight).toHaveAttribute("type", "range");
      await expect(weight).toHaveAttribute("min", "0");
      await expect(weight).toHaveAttribute("max", "100");
      await expect(weight).toHaveAttribute(
        "step",
        font === "Manrope" ? "12.5" : "100",
      );
      await weight.fill(font === "Manrope" ? "37.5" : "0");
      await expect(weight).toHaveValue(font === "Manrope" ? "37.5" : "0");
      await weight.press("ArrowRight");
      await expect(weight).toHaveValue(font === "Manrope" ? "50" : "100");
      await weight.press("ArrowLeft");
      await expect(weight).toHaveValue(font === "Manrope" ? "37.5" : "0");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    }
  }
  await page.locator("#heading-font-weight").press("End");
  await page.locator("#heading-font-weight").press("ArrowLeft");
  await selectField(page, "heading-font", "Bangers");
  await expect(page.locator("#heading-font-weight")).toHaveValue("100");
  await expect(page.locator("#heading-font-weight")).toHaveAttribute(
    "aria-valuetext",
    "Bold",
  );
  await selectField(page, "heading-font", "Manrope");
  await expect(page.locator("#heading-font-weight")).toHaveAttribute(
    "max",
    "100",
  );
  await page.locator("#heading-font-weight").press("End");
  await page.locator("#heading-font-weight").press("ArrowLeft");
  await expect(page.locator("#heading-font-weight")).toHaveValue("87.5");
  await page.locator("#cell-font-weight").fill("75");
  await page.locator("#cell-font-size").fill("20");
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Weight check");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  await page
    .locator("#board-grid .cell-heading")
    .first()
    .fill("Weighted caption");
  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "font-weight",
    "800",
  );
  await expect(page.locator("#board-grid .cell-heading").first()).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.locator("#heading-font span")).toHaveCSS(
    "font-weight",
    "800",
  );
  await expect(page.locator("#cell-font span")).toHaveCSS("font-weight", "700");
  await page.locator("#heading-font").click();
  await page.screenshot({
    path: testInfo.outputPath("font-previews-desktop.png"),
  });
  await page.keyboard.press("Escape");
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await downloadBoard(page);
  const draws = await page.evaluate(() => window.fontWeightDraws);
  expect(draws.find((entry) => entry.text === "WEIGHT CHECK")?.font).toMatch(
    /^800 .*Manrope/,
  );
  const captions = draws.filter((entry) =>
    ["Weighted", "caption", "Weighted caption"].includes(entry.text),
  );
  expect(captions.map((entry) => entry.text).join(" ")).toBe(
    "Weighted caption",
  );
  for (const caption of captions)
    expect(caption.font).toMatch(/^(700|bold) .*Manrope/);
  const saved = await savedWorkspace(page);
  expect(saved.grid).toMatchObject({
    headingFontWeight: 800,
    cellFontWeight: 700,
  });
  expect(saved.grid).not.toHaveProperty("template");
  expect(saved).not.toHaveProperty("themeSettings");
  await reloadWorkspace(page);
  await expect(page.locator("#heading-font-weight")).toHaveValue("87.5");
  await expect(page.locator("#heading-font-weight")).toHaveAttribute(
    "aria-valuetext",
    "Extra bold",
  );
  await expect(page.locator("#cell-font-weight")).toHaveValue("75");
  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "font-weight",
    "800",
  );
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-settings-v1")),
  );
  expect(settings.style).toMatchObject({
    headingFontWeight: 800,
    cellFontWeight: 700,
  });
  expect(settings).not.toHaveProperty("themeSettings");
  await setEditorViewport(page, { width: 390, height: 844 });
  await showSidebar(page);
  await page.locator("#cell-font-weight").fill("62.5");
  await expect(page.locator("#board-grid .cell-heading").first()).toHaveCSS(
    "font-weight",
    "600",
  );
  await page.locator("#cell-font-weight").fill("75");
  await page.locator("#heading-font").click();
  await expect(
    page.getByRole("listbox").locator('[data-value="Manrope"]'),
  ).toHaveCSS("font-weight", "800");
  await expect
    .poll(() =>
      page.getByRole("listbox").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("font-previews-mobile.png"),
  });
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("heading and card typography controls are independent across previews, exports and saved settings", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Team");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  await page.locator("#upload").setInputFiles({
    name: "Caption.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await openSidebarPanel(page, "Images");
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await openSidebarPanel(page, "Settings");
  await expect(
    page.getByRole("group", { name: "Canvas heading style", exact: true }),
  ).toContainText("Font");
  await expect(
    page.getByRole("group", { name: "Card style", exact: true }),
  ).toContainText("Font");
  await selectField(page, "heading-font", "Bebas Neue");
  await page.locator("#heading-font-size").fill("80");
  const headingHex = page
    .getByRole("group", { name: "Canvas heading style", exact: true })
    .getByRole("textbox", { name: "Text color hex value", exact: true });
  await headingHex.fill("#cc4488");
  await headingHex.press("Tab");
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "color",
    "rgb(244, 244, 239)",
  );
  await selectField(page, "cell-font", "Boogaloo");
  await page.locator("#cell-font-size").fill("60");
  const cardHex = page
    .getByRole("group", { name: "Card style", exact: true })
    .getByRole("textbox", { name: "Text color hex value", exact: true });
  await cardHex.fill("#39a36f");
  await cardHex.press("Tab");
  const verify = async () => {
    await expect(
      page.getByRole("button", { name: /^Edit grid heading: / }),
    ).toHaveCSS("color", "rgb(204, 68, 136)");
    await expect(
      page.getByRole("button", { name: /^Edit grid heading: / }),
    ).toHaveCSS("font-family", /Bebas Neue/);
    await expect(page.locator(".cell-heading").first()).toHaveCSS(
      "color",
      "rgb(57, 163, 111)",
    );
    if (page.viewportSize().width > 900)
      await expect(page.locator(".asset-name").first()).toHaveCSS(
        "color",
        "rgb(57, 163, 111)",
      );
    await expect(page.locator(".cell-heading").first()).toHaveCSS(
      "font-family",
      /Boogaloo/,
    );
    for (const selector of page.viewportSize().width > 900
      ? [".cell-heading", ".asset-name"]
      : [".cell-heading"]) {
      await expect
        .poll(() =>
          page
            .locator(selector)
            .first()
            .evaluate((field) => {
              const style = getComputedStyle(field);
              return (
                Math.abs(
                  parseFloat(style.fontSize) -
                    field.getBoundingClientRect().width * 0.24,
                ) < 0.2 && field.scrollHeight <= field.clientHeight + 1
              );
            }),
        )
        .toBe(true);
    }
  };
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1000 });
    await verify();
    if (width <= 900) await showSidebar(page);
    for (const name of ["Canvas style", "Canvas heading style", "Card style"]) {
      const section = page.getByRole("group", { name, exact: true });
    }
    for (const name of ["Canvas heading style", "Card style"]) {
      const section = page.getByRole("group", { name, exact: true });
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({
        path: testInfo.outputPath(`${name.replaceAll(" ", "-")}-${width}.png`),
      });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const configured = await savedWorkspace(page);
  await expect(page.locator("#cell-font-size")).toHaveValue("60");
  await reloadWorkspace(page);
  await verify();
  expect((await savedWorkspace(page)).grid.cells).toEqual(
    configured.grid.cells,
  );
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-settings-v1")),
  );
  expect(settings.style).toMatchObject({
    headingFontSize: 30,
    cellFontSize: 24,
    headingTextColor: "#cc4488",
    cellTextColor: "#39a36f",
  });
  expect(JSON.stringify(settings)).not.toContain("Caption.svg");
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.typographyDrawing = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.typographyDrawing.push({
        text,
        font: this.font,
        color: this.fillStyle,
      });
      return original.call(this, text, ...parameters);
    };
  });
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const bytes = await readFile(await download.path());
  expect(bytes.length).toBeGreaterThan(100);
  const drawing = await page.evaluate(() => window.typographyDrawing);
  expect(
    drawing.some(
      (entry) =>
        entry.text === "TEAM" &&
        entry.font.includes("Bebas Neue") &&
        parseFloat(entry.font) === 45 &&
        entry.color === "#cc4488",
    ),
  ).toBe(true);
  expect(
    drawing.some(
      (entry) =>
        entry.text === "Caption" &&
        entry.font.includes("Boogaloo") &&
        parseFloat(entry.font) === 36 &&
        entry.color === "#39a36f",
    ),
  ).toBe(true);
});

test("empty headings use accessible inline placeholders and reserve no export bands", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  await page.locator("#gap").fill("10");
  await page.locator("#canvas-padding").fill("10");
  await selectField(page, "image-shape", "square");
  await page.locator("#cell-text-color-value").fill("#a6d8ff");
  await page.locator("#cell-text-color-value").press("Tab");
  await page.locator("#upload").setInputFiles({
    name: "Original.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await openSidebarPanel(page, "Images");
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await page.locator(".cell-heading").first().fill("");
  await expect(
    page.getByRole("switch", { name: "Show heading", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add heading", exact: true }),
  ).toHaveCount(0);
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1000 });
    await page.locator("#export-grid-header").focus();
    await page.mouse.move(1, 1);
    const trigger = page.getByRole("button", {
      name: /^Edit grid heading: /,
    });
    const placeholder = trigger.locator("[data-heading-placeholder]");
    await expect(placeholder).toHaveText("Add heading");
    await expect(trigger).toHaveAccessibleName(
      "Edit grid heading: Add heading",
    );

    const contrast = await placeholder.evaluate((element) => {
      const context = document.createElement("canvas").getContext("2d");
      const luminance = (color) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(
        getComputedStyle(element.closest("h2")).backgroundColor,
      );
      return (
        (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05)
      );
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await trigger.hover();

    for (const selector of width > 900
      ? [".cell-heading", ".asset-name"]
      : [".cell-heading"]) {
      const field = page.locator(selector).first();
      await expect(field).toHaveAttribute("placeholder", "Add heading");
      const textColor = await field.evaluate(
        (element) => getComputedStyle(element).color,
      );
      expect(textColor).toBe("rgb(166, 216, 255)");
      await page.mouse.move(1, 1);

      expect(
        await field.evaluate(
          (element) => getComputedStyle(element, "::placeholder").color,
        ),
      ).toBe(textColor);
      await field.hover();

      if (selector === ".cell-heading") {
        const preview = field.locator("..").locator("[data-caption-preview]");

        await expect(preview).toHaveCSS("color", textColor);

        await page.mouse.move(1, 1);

        await field.focus();
        await expect(preview).toBeHidden();

        await field.fill("Written title");

        await expect(field).toHaveCSS("color", textColor);
        await page.locator("#export-grid-header").focus();
        await expect(preview).toBeVisible();
        await expect(preview).toHaveText("Written title");
        await expect(preview).toHaveCSS("color", textColor);

        await field.fill("");
        await page.locator("#export-grid-header").focus();
      }
    }
    await trigger.click();
    const heading = page.getByRole("textbox", {
      name: "Grid heading",
      exact: true,
    });
    await expect(heading).toHaveAttribute("placeholder", "Add heading");
    await heading.fill("Temporary");
    await heading.press("Enter");
    await expect(trigger).toHaveText("Temporary");
    await expect(trigger).toHaveAccessibleName("Edit grid heading: Temporary");
    await trigger.click();
    await heading.fill("");
    await heading.press("Enter");
    await expect(placeholder).toHaveText("Add heading");
    await page.locator("#board-grid").screenshot({
      path: testInfo.outputPath(`empty-heading-placeholders-${width}.png`),
    });
  }
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.emptyHeadingDrawing = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.emptyHeadingDrawing.push(text);
      return original.call(this, text, ...parameters);
    };
  });
  const exportSize = async () => {
    await page.locator("#export-grid-header").click();
    await selectField(page, "resolution", "150");
    const download = await downloadBoard(page);
    const bytes = await readFile(await download.path());
    return page.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return dimensions;
      },
      [...bytes],
    );
  };
  for (const mode of ["above", "below", "overlay-bottom"]) {
    await selectField(page, "caption-position", mode);
    expect(await exportSize()).toEqual({ width: 462, height: 462 });
  }
  expect(await page.evaluate(() => window.emptyHeadingDrawing)).toEqual([]);
  await selectField(page, "caption-position", "below");
  await page.locator(".cell-heading").first().fill("Filled");
  expect(await exportSize()).toEqual({ width: 462, height: 498 });
  await page.locator(".cell-heading").first().fill("");
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Team");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  expect(await exportSize()).toEqual({ width: 462, height: 524 });
  await page.locator(".cell-heading").first().fill("Filled");
  expect(await exportSize()).toEqual({ width: 462, height: 560 });
});

test("grid headings support mouse and keyboard editing across viewport sizes", async ({
  page,
}) => {
  await page.goto("./");
  for (const viewport of [
    { width: 1440, height: 844 },
    { width: 960, height: 844 },
    { width: 390, height: 844 },
    { width: 1440, height: 360 },
  ]) {
    await setEditorViewport(page, viewport);
    const trigger = page.getByRole("button", { name: /^Edit grid heading: / });
    await trigger.click();
    const field = page.getByRole("textbox", {
      name: "Grid heading",
      exact: true,
    });
    await expect(field).toBeFocused();
    await field.fill("Team DC edited");
    await field.press("Escape");
    await expect(trigger).toHaveText("Team DC edited");
    await trigger.focus();
    await trigger.press("Enter");
    await expect(field).toBeFocused();
    await field.fill("");
    await field.press("Enter");
    await expect(trigger).toHaveAccessibleName(
      "Edit grid heading: Add heading",
    );
    await trigger.click();
    await field.fill("Team DC");
    await field.press("Enter");
    await expect(trigger).toHaveText("Team DC");
  }
  await reloadWorkspace(page);
  await expect(
    page.getByRole("button", {
      name: "Edit grid heading: Team DC",
      exact: true,
    }),
  ).toBeVisible();
});

test("canvas has no appearance toolbar and the sidebar header stays fixed", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  for (const width of [1440, 960, 780, 390, 320]) {
    await setEditorViewport(page, { width, height: 600 });
    await expect(
      page.getByRole("toolbar", { name: "Grid appearance" }),
    ).toHaveCount(0);
    const frame = page.locator("[data-resize-frame]");
    const trigger = page.getByRole("button", {
      name: "Export grid",
      exact: true,
    });
    await expect(page.locator(".app-header")).toHaveCount(0);
    await expect(trigger).toHaveCount(1);
    await expect(frame).toBeInViewport({ ratio: 1 });
    if (width > 900) {
      const sidebar = page.locator("[data-editor-sidebar]");
      const header = page.locator("[data-canvas-header]");
      const headerBounds = await header.boundingBox();
      expect((await sidebar.boundingBox()).y).toBe(
        headerBounds.y + headerBounds.height,
      );
      expect((await sidebar.boundingBox()).height).toBe(
        (await page.evaluate(() => innerHeight)) - headerBounds.height,
      );
      for (const [panel, selector] of [
        ["Images", ".asset-panel"],
        ["Settings", ".settings-panel"],
      ]) {
        await openSidebarPanel(page, panel);
        const before = await header.boundingBox();
        const scroller = sidebar;
        expect(
          await scroller.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        ).toBe(true);
        await scroller.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        expect(
          await scroller.evaluate((element) => element.scrollTop),
        ).toBeGreaterThan(0);
        expect(await header.boundingBox()).toEqual(before);
      }
      await expect(trigger).toBeInViewport({ ratio: 1 });
    } else {
      await selectField(page, "caption-position", "overlay-bottom");
      const workspace = await page
        .getByRole("region", { name: "Grid editor", exact: true })
        .boundingBox();
      const button = await trigger.boundingBox();
      const headerBounds = await page
        .locator("[data-canvas-header]")
        .boundingBox();
      expect(button.width).toBeGreaterThanOrEqual(44);

      expect(workspace.y).toBe(headerBounds.y + headerBounds.height);
      expect(button.y).toBeGreaterThanOrEqual(headerBounds.y);
      expect(button.y + button.height).toBeLessThanOrEqual(workspace.y);
      expect(button.x + button.width).toBeLessThanOrEqual(
        workspace.x + workspace.width,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`fixed-sidebar-aligned-canvas-${width}.png`),
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Export grid",
      exact: true,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("export combines settings and downloads on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  await expect(
    page.getByRole("tab", { name: "Export", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Canvas style", exact: true }),
  ).toBeVisible();
  const trigger = page.getByRole("button", {
    name: "Export grid",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  for (const [format, extension, signature] of [
    ["image/png", "png", [137, 80, 78, 71]],
    ["image/jpeg", "jpg", [255, 216]],
    ["image/webp", "webp", [82, 73, 70, 70]],
  ]) {
    await trigger.click();
    await expect(dialog).toBeVisible();
    await selectField(page, "format", format);
    await selectField(page, "resolution", "150");
    if (format === "image/png") {
      await expect(dialog.locator("#quality")).toHaveCount(0);
      await expect(dialog.locator('label[for="quality"]')).toHaveCount(0);
      await expect(dialog.locator("#quality-value")).toHaveCount(0);
    } else {
      await expect(dialog.locator("#quality")).toBeEnabled();
      await dialog.locator("#quality").fill("60");
    }
    if (format === "image/png")
      await page.screenshot({
        path: testInfo.outputPath("export-dialog-desktop.png"),
      });
    const download = await downloadBoard(page);
    expect(download.suggestedFilename()).toBe(`grid.${extension}`);
    const bytes = await readFile(await download.path());
    expect([...bytes.subarray(0, signature.length)]).toEqual(signature);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await reloadWorkspace(page);
  await setEditorViewport(page, { width: 390, height: 844 });
  await trigger.click();
  await expect(dialog.locator("#format")).toHaveText("WebP");
  await expect(dialog.locator("#resolution")).toHaveText("150 px / image");
  await expect(dialog.locator("#quality")).toHaveValue("60");
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await selectField(page, "format", "image/png");
  await expect(dialog.locator("#quality")).toHaveCount(0);
  await expect(dialog.locator('label[for="quality"]')).toHaveCount(0);
  await expect(dialog.locator("#quality-value")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("export-dialog-mobile.png"),
  });
  await selectField(page, "format", "image/jpeg");
  await expect(dialog.locator("#quality")).toBeEnabled();
  await expect(dialog.locator("#quality")).toHaveValue("60");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("fullscreen visual cropping preserves originals and matches preview and export", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  test.setTimeout(60000);
  await page.goto("./");
  await selectField(page, "image-shape", "square");
  const original = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="200" height="200" fill="#ff0000"/><rect x="200" width="200" height="200" fill="#00ff00"/><rect x="400" width="200" height="200" fill="#0000ff"/></svg>',
  );
  await page.locator("#upload").setInputFiles({
    name: "wide.svg",
    mimeType: "image/svg+xml",
    buffer: original,
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const image = page.locator(".cell-image-button").first();
  await chooseImage(page, "wide");
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await page.locator(".cell-heading").first().fill("Keep this caption");
  const identity = (await savedWorkspace(page)).grid.cells[0];
  async function sample(bytes, x = 0.5, y = 0.5) {
    return page.evaluate(
      async ({ bytes, x, y }) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const color = [
          ...context.getImageData(
            Math.floor(bitmap.width * x),
            Math.floor(bitmap.height * y),
            1,
            1,
          ).data,
        ];
        bitmap.close();
        return color;
      },
      { bytes: [...bytes], x, y },
    );
  }
  await page.mouse.move(0, 0);
  expect(await sample(await image.screenshot())).toEqual([0, 255, 0, 255]);
  await expect(
    page.getByRole("button", { name: /^(Fit|Fill) image$/ }),
  ).toHaveCount(0);
  const dialog = page.getByRole("dialog", { name: "Crop image", exact: true });
  async function openCrop() {
    await image.hover();
    await page.getByRole("button", { name: "Crop image", exact: true }).click();
    await expect(dialog).toBeVisible();

    await expect(
      dialog.getByRole("button", { name: "Apply crop", exact: true }),
    ).toBeEnabled();
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds.x).toBeCloseTo(0, 0);
    expect(bounds.y).toBeCloseTo(0, 0);
    expect(bounds.width).toBeGreaterThan(viewport.width - 20);
    expect(bounds.height).toBeGreaterThan(viewport.height - 2);
    expect(
      await page.evaluate(() =>
        document.activeElement?.matches("input,textarea"),
      ),
    ).toBe(false);
  }
  await openCrop();
  const cropWindow = dialog.locator(".crop-window");
  const initialWindow = await cropWindow.boundingBox();
  expect(initialWindow.width / initialWindow.height).toBeCloseTo(1, 2);
  await dialog.getByRole("button", { name: "Toggle crop guides" }).click();
  await dialog.locator("#crop-zoom").fill("2");
  const preview = dialog.getByLabel("Crop preview", { exact: true });
  const windowBounds = await cropWindow.boundingBox();
  const centerY = windowBounds.y + windowBounds.height / 2;
  await page.mouse.move(windowBounds.x + windowBounds.width / 2, centerY);
  await page.mouse.down();
  await page.mouse.move(16, centerY, { steps: 12 });
  await page.mouse.up();
  await preview.press("ArrowRight");
  expect(await sample(await cropWindow.screenshot())).toEqual([0, 0, 255, 255]);
  await page.screenshot({
    path: testInfo.outputPath("crop-editor-desktop.png"),
  });
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
  await expect
    .poll(
      async () => (await localDatabase(page)).document?.grid.cells[0].crop?.x,
    )
    .toBeGreaterThan(0.6);
  const saved = await savedWorkspace(page);
  const applied = saved.grid.cells[0].crop;
  expect(saved.grid.cells[0]).toMatchObject({
    id: identity.id,
    assetId: identity.assetId,
    title: "Keep this caption",
  });
  expect(await sample(await image.screenshot())).toEqual([0, 0, 255, 255]);
  const readOriginal = () =>
    page.evaluate(
      (assetId) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("grids-client-v1");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction("images", "readonly");
            const record = transaction.objectStore("images").get(assetId);
            record.onsuccess = async () =>
              resolve([
                ...new Uint8Array(await record.result.blob.arrayBuffer()),
              ]);
            record.onerror = () => reject(record.error);
            transaction.oncomplete = () => database.close();
          };
        }),
      identity.assetId,
    );
  expect(await readOriginal()).toEqual([...original]);
  await openCrop();
  await expect
    .poll(async () => Number(await dialog.locator("#crop-zoom").inputValue()))
    .toBeCloseTo(2, 1);
  expect(await sample(await cropWindow.screenshot())).toEqual([0, 0, 255, 255]);
  await dialog.locator("#crop-zoom").fill("3");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
  expect((await savedWorkspace(page)).grid.cells[0].crop).toEqual(applied);
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).grid.cells[0].crop).toEqual(applied);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  expect(await sample(await image.screenshot())).toEqual([0, 0, 255, 255]);
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const exported = await readFile(await download.path());
  expect(await sample(exported, 78 / 462, 78 / 567)).toEqual([0, 0, 255, 255]);
  await chooseImage(page, "wide", 1);
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue("wide");
  await page.locator(".cell-heading").nth(1).fill("Second caption");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  await expect(page.locator(".library-heading").first()).toHaveValue("wide");
  const copies = (await savedWorkspace(page)).grid.cells.slice(0, 2);
  expect(copies[0].crop).toEqual(applied);
  expect(copies[1].crop).toBeUndefined();
  expect(
    await sample(await page.locator(".cell-image-button").nth(1).screenshot()),
  ).toEqual([0, 255, 0, 255]);
  await selectField(page, "image-shape", "landscape");
  await openCrop();
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const landscapeCrop = (await savedWorkspace(page)).grid.cells[0].crop;
  expect(landscapeCrop.width).toBeCloseTo(applied.width, 6);
  expect(landscapeCrop.height).toBeCloseTo((applied.height * 3) / 4, 6);
  await selectField(page, "image-shape", "square");
  await openCrop();
  await dialog.getByRole("button", { name: "Reset crop" }).click();
  await expect(dialog.locator("#crop-zoom")).toHaveValue("1");
  expect(await sample(await cropWindow.screenshot())).toEqual([0, 255, 0, 255]);
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await sample(await image.screenshot())).toEqual([0, 255, 0, 255]);
  expect(await readOriginal()).toEqual([...original]);
  expect(
    JSON.stringify(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("grids-settings-v1")),
      ),
    ),
  ).not.toContain('"crop"');
});

test("imported captions preserve library capitalization in the canvas and export", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "  DC -  Color__Kid  .svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const title = await page.locator(".asset-name").first().inputValue();
  expect(title).toBe("DC Color Kid");
  await page
    .locator(".asset")
    .first()
    .locator("[data-library-thumbnail]")
    .dragTo(page.locator(".cell-image-button").first());
  await expect(page.locator(".cell-heading").first()).toHaveValue(title);
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "text-transform",
    "none",
  );
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.exportedCaptionText = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.exportedCaptionText.push(text);
      return original.call(this, text, ...parameters);
    };
  });
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await downloadBoard(page);
  const rendered = await page.evaluate(() => window.exportedCaptionText);
  expect(rendered.join(" ")).toContain(title);
  expect(rendered.join(" ")).not.toContain(title.toUpperCase());
  await setEditorViewport(page, { width: 960, height: 1080 });
  await selectField(page, "caption-position", "above");
  await page.locator(".cell-heading").first().fill("DC   Friendly Fire");
  await expect
    .poll(() =>
      page
        .locator(".cell-heading")
        .first()
        .evaluate((field) => field.scrollHeight <= field.clientHeight),
    )
    .toBe(true);
  await page
    .locator(".grid-cell")
    .first()
    .screenshot({ path: testInfo.outputPath("padded-caption-narrow.png") });
});

for (const provider of [
  "smk",
  "inaturalist",
  "openverse",
  "rijksmuseum",
  "wellcome",
]) {
  test(`${provider} searches without keys and imports durable references without image blobs`, async ({
    page,
  }) => {
    const bytes = await readFile(
      path.join(projectRoot, "tests/fixtures/assets/DC - Color Kid.jpg"),
    );
    const requests = [];
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const routes = {
      smk: {
        api: "https://api.smk.dk/api/v1/art/search?*",
        image: /^https:\/\/iip\.smk\.dk\//,
        title: "Artwork",
        license: "Public domain",
        response: {
          found: 1,
          items: [
            {
              object_number: "KKS1",
              titles: [{ title: "Artwork" }],
              artist: ["Artist"],
              frontend_url: "https://open.smk.dk/artwork/image/KKS1",
              public_domain: true,
              rights: "https://creativecommons.org/publicdomain/mark/1.0/",
              image_iiif_id: "https://iip.smk.dk/iiif/jp2/1.jp2",
              image_width: 800,
              image_height: 600,
            },
          ],
        },
      },
      inaturalist: {
        api: "https://api.inaturalist.org/v1/observations?*",
        image: /^https:\/\/inaturalist-open-data\.s3\.amazonaws\.com\//,
        title: "Bird",
        license: "CC0",
        response: {
          total_results: 1,
          results: [
            {
              taxon: { name: "Bird", preferred_common_name: "Bird" },
              photos: [
                {
                  id: 1,
                  url: "https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpg",
                  license_code: "cc0",
                  attribution: "Creator",
                  original_dimensions: { width: 800, height: 600 },
                },
              ],
            },
          ],
        },
      },
      openverse: {
        api: "https://api.openverse.org/v1/images/?*",
        image:
          /^https:\/\/(api\.openverse\.org\/v1\/images\/[^/]+\/thumb\/|live\.staticflickr\.com\/)/,
        title: "Photograph",
        license: "CC0",
        response: {
          result_count: 1,
          page_count: 1,
          results: [
            {
              id,
              title: "Photograph",
              creator: "Photographer",
              url: "https://live.staticflickr.com/1/photo.jpg",
              foreign_landing_url: "https://www.flickr.com/photos/example/1",
              license: "cc0",
              license_version: "1.0",
              license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
              width: 800,
              height: 600,
              filesize: bytes.length,
              mature: false,
            },
          ],
        },
      },
      rijksmuseum: {
        api: "https://data.rijksmuseum.nl/search/collection?*",
        image: /^https:\/\/iiif\.micr\.io\/test\/full\//,
        title: "Artwork",
        license: "Public domain",
        response: {
          partOf: { totalItems: 1 },
          orderedItems: [{ id: "https://id.rijksmuseum.nl/123" }],
        },
      },
      wellcome: {
        api: "https://api.wellcomecollection.org/catalogue/v2/works?*",
        image: /^https:\/\/iiif\.wellcomecollection\.org\/image\/V1\/full\//,
        title: "Flowers",
        license: "Public domain",
        response: {
          totalResults: 1,
          results: [
            {
              id: "abcd1234",
              title: "Flowers",
              items: [
                {
                  locations: [
                    {
                      url: "https://iiif.wellcomecollection.org/image/V1/info.json",
                      license: {
                        id: "pdm",
                        url: "https://creativecommons.org/share-your-work/public-domain/pdm/",
                      },
                      locationType: { id: "iiif-image" },
                      accessConditions: [{ status: { id: "open" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };
    const fixture = routes[provider];
    if (provider === "rijksmuseum") {
      await page.route("https://data.rijksmuseum.nl/123", (route) =>
        route.fulfill({
          json: {
            id: "https://id.rijksmuseum.nl/123",
            identified_by: [{ type: "Name", content: "Artwork" }],
            subject_of: [
              {
                digitally_carried_by: [
                  {
                    access_point: [
                      {
                        id: "https://iiif.micr.io/test/full/max/0/default.jpg",
                      },
                    ],
                    referred_to_by: [
                      {
                        classified_as: [
                          { id: "https://vocab.getty.edu/aat/300460240" },
                        ],
                        content:
                          "https://creativecommons.org/publicdomain/mark/1.0/",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      );
    }
    for (const base of [
      "https://iiif.micr.io/test",
      "https://iiif.wellcomecollection.org/image/V1",
    ])
      await page.route(`${base}/info.json`, (route) =>
        route.fulfill({ json: { id: base, width: 800, height: 600 } }),
      );
    await page.route(fixture.image, (route) =>
      route.fulfill({ contentType: "image/jpeg", body: bytes }),
    );
    await page.route(fixture.api, (route) => {
      requests.push(new URL(route.request().url()));
      return route.fulfill({ json: fixture.response });
    });
    await page.goto("./");
    await selectField(page, "sidebar-image-source", provider);
    const online = page.getByRole("region", { name: "Online", exact: true });
    await online
      .getByRole("searchbox", { name: "Search images", exact: true })
      .fill("Bird");
    await expect(online).toHaveAttribute("aria-busy", "false");
    await online
      .getByRole("button", {
        name: `Image options: ${fixture.title}`,
        exact: true,
      })
      .click();
    await online
      .getByRole("button", { name: `Import ${fixture.title}`, exact: true })
      .click();
    await selectField(page, "sidebar-image-source", "imported");
    await expect(page.locator(".asset-name")).toHaveJSProperty(
      "readOnly",
      false,
    );
    await chooseImage(page, fixture.title);
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toBeVisible();
    await reloadWorkspace(page);
    const saved = await localDatabase(page);
    expect(saved.document.assets[0].provenance).toMatchObject({
      provider,
      license: fixture.license,
    });
    expect(saved.images).toEqual([]);
    if (provider === "rijksmuseum" || provider === "wellcome") {
      await page.locator("#export-grid-header").click();
      await selectField(page, "resolution", "150");
      const download = await downloadBoard(page);
      const exported = await readFile(await download.path());
      expect([...exported.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    }
    expect(requests.length).toBeGreaterThan(0);
    for (const url of requests) {
      for (const key of [
        "api_key",
        "apiKey",
        "key",
        "access_token",
        "token",
        "secret",
      ])
        expect(url.searchParams.has(key)).toBe(false);
      if (provider === "openverse")
        expect(url.searchParams.get("license")).toBe("cc0,pdm");
      if (provider === "inaturalist")
        expect(url.searchParams.get("photo_license")).toBe("cc0");
    }
  });
}

test("Commons excludes images requiring credit and keeps public-domain titles editable", async ({
  page,
}) => {
  await mockCommons(page);
  const searched = page.waitForResponse(
    (response) =>
      response.url().startsWith("https://commons.wikimedia.org/w/api.php") &&
      new URL(response.url()).searchParams
        .get("gsrsearch")
        ?.startsWith("credited"),
  );
  await page.goto("./?source=commons&q=credited&topic=all");
  await searched;
  const online = page.getByRole("region", { name: "Online", exact: true });
  await expect(online).toHaveAttribute("aria-busy", "false");
  await expect(online.locator(".asset-name")).toHaveCount(0);
  await online
    .getByRole("searchbox", { name: "Search images", exact: true })
    .fill("moon");
  await online
    .getByRole("button", { name: "Image options: Moon", exact: true })
    .click();
  await online
    .getByRole("button", { name: "Import Moon", exact: true })
    .click();
  await selectField(page, "sidebar-image-source", "imported");
  await chooseImage(page, "Moon");
  const caption = page.locator(".cell-heading").first();
  await caption.fill("My editable heading");
  await reloadWorkspace(page);
  await expect(caption).toHaveValue("My editable heading");
  await expect(page.locator("[data-image-credits]")).toHaveCount(0);
});

test("legacy credited images are removed persistently without losing local images or settings", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "Keep.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset-name")).toHaveValue("Keep");
  const original = await savedWorkspace(page);
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("grids-client-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("documents", "readwrite");
          const documents = transaction.objectStore("documents");
          const get = documents.get("guest");
          get.onsuccess = () => {
            const document = get.result;
            const id = crypto.randomUUID();
            document.assets.push({
              id,
              title: "Legacy credit",
              category: "Imported",
              provenance: {
                provider: "openverse",
                entityId: crypto.randomUUID(),
                title: "Legacy credit",
                creator: "Photographer",
                sourcePage: "https://www.flickr.com/photos/example/123",
                originalUrl: "https://live.staticflickr.com/1/photo.jpg",
                license: "CC BY 4.0",
                licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
              },
            });
            document.grid.cells[0] = {
              ...document.grid.cells[0],
              assetId: id,
              title: "Legacy credit",
            };
            document.grid.cells[1] = {
              ...document.grid.cells[1],
              assetId: document.assets[0].id,
              title: "Keep caption",
              crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
            };
            document.grid.gap = 42;
            documents.put(document);
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await expect(
    page.getByText(
      "Images requiring attribution were removed. Other images and settings were kept.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator(".grid-cell").nth(1).locator("img")).toBeVisible();
  const migrated = await savedWorkspace(page);
  expect(migrated.assets).toEqual(original.assets);
  expect(migrated.grid.cells[0]).toMatchObject({ assetId: null, title: "" });
  expect(migrated.grid.cells[1]).toMatchObject({
    assetId: original.assets[0].id,
    title: "Keep caption",
    crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
  });
  expect(migrated.grid.gap).toBe(42);
  expect((await localDatabase(page)).images).toHaveLength(1);
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).assets).toEqual(original.assets);
  await expect(page.locator("[data-image-credits]")).toHaveCount(0);
});

test("hovering images preserves caption focus and keyboard actions remain available", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["Eye Boy", "Kite Man"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  for (const index of [0, 1])
    await page
      .locator("[data-library-thumbnail]")
      .nth(index)
      .dragTo(page.locator(".cell-image-button").nth(index));
  for (const [width, expanded] of [
    [960, false],
    [780, false],
    [780, true],
  ]) {
    await setEditorViewport(page, { width, height: 1080 });
    if (expanded) await openSidebarPanel(page, "Settings");
    await selectField(page, "caption-position", "above");
    if (expanded) await closeSidebarPanel(page);
    for (const selector of width > 900
      ? [".grid-cell", ".asset"]
      : [".grid-cell"]) {
      const cards = page.locator(selector);
      const image = cards.nth(0).locator("[data-card-image] > button");
      const header = cards.nth(1).locator("textarea");
      await header.click();
      await image.hover();

      await expect(header).toBeFocused();
      await expect(image).not.toBeFocused();
      await header.hover();

      await expect(header).toBeFocused();
      await image.focus();
      await image.press("Enter");
      await expect(
        cards.nth(0).getByRole("group", { name: "Cell tools", exact: true }),
      ).toBeVisible();

      await image.press("Escape");
      await header.click();
    }
  }
});

test("empty cells hide captions and dropped replacements use the incoming image title", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["First", "Second"].map((title) => ({
      name: `${title}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>',
      ),
    })),
  );
  const cell = page.locator(".grid-cell").first();
  const caption = cell.locator(".cell-heading");
  await expect(caption).toBeHidden();
  await expect(cell.locator("[data-caption-feedback]")).toBeHidden();
  await page
    .locator("[data-library-thumbnail]")
    .nth(0)
    .dragTo(cell.locator(".cell-image-button"));
  await expect(caption).toBeVisible();
  await expect(caption).toHaveValue("First");
  await caption.fill("Custom caption");
  await page
    .locator("[data-library-thumbnail]")
    .nth(1)
    .dragTo(cell.locator(".cell-image-button"));
  await expect(caption).toHaveValue("Second");
  await reloadWorkspace(page);
  await expect(caption).toBeVisible();
  await expect(caption).toHaveValue("Second");
  await cell.locator(".cell-image-button").hover();
  await cell.getByRole("button", { name: "Clear cell", exact: true }).click();
  await expect(caption).toBeHidden();
  await expect(cell.locator("[data-caption-feedback]")).toBeHidden();
  await reloadWorkspace(page);
  await expect(caption).toBeHidden();
  await page
    .locator("[data-library-thumbnail]")
    .nth(0)
    .dragTo(cell.locator(".cell-image-button"));
  await expect(caption).toBeVisible();
  await expect(caption).toHaveValue("First");
});

test("large-font overlays with one visible line have matching bands in preview and export", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["Hi", "Long"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  for (const index of [0, 1])
    await page
      .locator("[data-library-thumbnail]")
      .nth(index)
      .dragTo(page.locator(".cell-image-button").nth(index));
  const captions = page.locator(".cell-heading");
  const multiline = "Line One\nLine Two\nLine Three";
  await captions.nth(1).fill(multiline);
  await openSidebarPanel(page, "Settings");
  await selectField(page, "image-shape", "portrait");
  await selectField(page, "caption-position", "overlay-bottom");
  await page.locator("#cell-font-size").fill("100");
  await expect
    .poll(() =>
      captions.evaluateAll((fields) => {
        const [short, long] = fields;
        return (
          Math.abs(
            short.getBoundingClientRect().height -
              long.getBoundingClientRect().height,
          ) < 0.1 &&
          [short, long].every(
            (field) =>
              field.parentElement.style.getPropertyValue(
                "--library-caption-lines",
              ) === "1",
          )
        );
      }),
    )
    .toBe(true);
  await page.evaluate(() => {
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    window.overlayBands = [];
    CanvasRenderingContext2D.prototype.fillRect = function (
      x,
      y,
      width,
      height,
    ) {
      if (this.globalAlpha > 0 && this.globalAlpha < 1)
        window.overlayBands.push({ width, height });
      return fillRect.call(this, x, y, width, height);
    };
  });
  for (const resolution of [150, 300]) {
    await page.evaluate(() => {
      window.overlayBands = [];
    });
    await page.locator("#export-grid-header").click();
    await selectField(page, "resolution", String(resolution));
    const download = await downloadBoard(page);
    const bytes = await readFile(await download.path());
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(resolution);
    const bands = await page.evaluate(() => window.overlayBands);
    expect(bands).toHaveLength(2);
    expect(bands[0].width).toBe(resolution);
    expect(bands[0].height).toBe(bands[1].height);
  }
  await expect(captions.nth(1)).toHaveValue(multiline);
});

test("captions share external bands and fit individual overlays across canvas, library and export", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  await page.locator("#gap").fill("10");
  await page.locator("#canvas-padding").fill("10");
  await selectField(page, "image-shape", "square");
  await page.locator("#upload").setInputFiles(
    ["Short", "Lines", "Word"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await openSidebarPanel(page, "Images");
  const multiline =
    "Line One\nLine Two\nLine Three\nLine Four\nLine Five\nLine Six";
  await page.locator(".library-heading").nth(1).fill(multiline);
  await page
    .locator(".library-heading")
    .nth(2)
    .fill("LongUnbrokenWordWithoutSpaces");
  for (const index of [0, 1, 2])
    await page
      .locator("[data-library-thumbnail]")
      .nth(index)
      .dragTo(page.locator(".cell-image-button").nth(index));
  for (const width of [960]) {
    await setEditorViewport(page, { width, height: 1080 });
    for (const placement of ["above", "below"]) {
      await selectField(page, "caption-position", placement);
      await expect
        .poll(() =>
          page.locator(".image-card:has(textarea:visible)").evaluateAll(
            (cards) =>
              cards.length > 0 &&
              cards.every((card) => {
                const field = card.querySelector("textarea");
                const width = field.getBoundingClientRect().width;
                const fontSize = parseFloat(getComputedStyle(field).fontSize);
                return width > 0 && Math.abs(fontSize - width * 0.12) < 0.05;
              }),
          ),
        )
        .toBe(true);
      const metrics = await page
        .locator(".image-card:has(textarea:visible)")
        .evaluateAll((cards) =>
          cards.map((card) => {
            const field = card.querySelector("textarea");
            const bounds = card.getBoundingClientRect();
            const caption = field.getBoundingClientRect();
            return {
              library: card.classList.contains("asset"),
              width: caption.width,
              height: bounds.height,
              captionHeight: caption.height,
              fontSize: parseFloat(getComputedStyle(field).fontSize),
              scrollHeight: field.scrollHeight,
              clientHeight: field.clientHeight,
            };
          }),
        );
      for (const library of [false, true]) {
        const group = metrics.filter((item) => item.library === library);
        expect(group).toHaveLength(3);
        expect(
          Math.max(...group.map((item) => item.height)) -
            Math.min(...group.map((item) => item.height)),
        ).toBeLessThan(0.1);
        expect(
          Math.max(...group.map((item) => item.captionHeight)) -
            Math.min(...group.map((item) => item.captionHeight)),
        ).toBeLessThan(0.1);
        for (const item of group) {
          expect(item.fontSize).toBeCloseTo(item.width * 0.12, 1);
          expect(item.captionHeight).toBeGreaterThan(item.fontSize * 3 * 1.05);
        }
      }
      await expect(page.locator(".cell-heading").nth(1)).toHaveValue(multiline);
    }
    for (const shape of ["portrait", "landscape", "square"]) {
      await selectField(page, "image-shape", shape);
      for (const position of ["overlay-top", "overlay-bottom"]) {
        await selectField(page, "caption-position", position);
        const captions = page.locator(".cell-heading");
        await expect
          .poll(() =>
            page
              .locator(".grid-cell [data-caption-preview] span")
              .nth(1)
              .evaluate((text) => {
                const style = getComputedStyle(text);
                return (
                  Number(style.webkitLineClamp) <= 3 &&
                  text.getBoundingClientRect().height <=
                    parseFloat(style.lineHeight) * 3 + 0.1
                );
              }),
          )
          .toBe(true);
        const short = await captions.first().boundingBox();
        const long = await captions.nth(1).boundingBox();
        if (shape === "landscape")
          expect(Math.abs(short.height - long.height)).toBeLessThan(0.1);
        else expect(short.height).toBeLessThan(long.height);
        const card = await page.locator(".grid-cell").nth(1).boundingBox();
        expect(card.height - long.height).toBeGreaterThanOrEqual(
          card.width * 0.5 - 1,
        );
        if (shape === "landscape") {
          const font = await captions
            .nth(1)
            .evaluate((field) => parseFloat(getComputedStyle(field).fontSize));
          expect(font).toBeCloseTo(long.width * 0.12, 1);
        }
      }
    }
    await selectField(page, "image-shape", "square");
    await selectField(page, "caption-position", "above");
    await page.screenshot({
      path: testInfo.outputPath(`multiline-cards-${width}.png`),
    });
  }
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.captionDrawing = [];
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.captionDrawing.push({ text, font: this.font });
      return original.call(this, text, ...parameters);
    };
  });
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const bytes = await readFile(await download.path());
  const dimensions = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const result = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return result;
    },
    [...bytes],
  );
  expect(dimensions).toEqual({ width: 462, height: 536 });
  const drawing = await page.evaluate(() => window.captionDrawing);
  for (const line of multiline.split("\n").slice(0, 2))
    expect(
      drawing.some(
        (entry) =>
          entry.text === line &&
          Number(entry.font.match(/([\d.]+)px/)[1]) === 18,
      ),
    ).toBe(true);
  expect(drawing.some((entry) => entry.text === "Line Three\u2026")).toBe(true);
  expect(drawing.some((entry) => entry.text === "Line Six")).toBe(false);
  expect(
    drawing.some(
      (entry) =>
        entry.text === "Short" &&
        Number(entry.font.match(/([\d.]+)px/)[1]) === 18,
    ),
  ).toBe(true);
  await selectField(page, "image-shape", "landscape");
  for (const position of ["overlay-top", "overlay-bottom"]) {
    await selectField(page, "caption-position", position);
    const expectedFont = await page
      .locator(".cell-heading")
      .nth(1)
      .evaluate(
        (field) =>
          (parseFloat(getComputedStyle(field).fontSize) /
            field.getBoundingClientRect().width) *
          150,
      );
    await page.evaluate(() => {
      window.captionDrawing = [];
    });
    await downloadBoard(page);
    const overlayDrawing = await page.evaluate(() => window.captionDrawing);
    const entry = overlayDrawing.find(
      (entry) => entry.text === "Line One\u2026",
    );
    expect(entry).toBeTruthy();
    expect(
      Math.abs(Number(entry.font.match(/([\d.]+)px/)[1]) - expectedFont),
    ).toBeLessThan(0.1);
    expect(overlayDrawing.some((entry) => entry.text === "Line Six")).toBe(
      false,
    );
    expect(
      overlayDrawing.some(
        (entry) =>
          entry.text === "Short" &&
          Number(entry.font.match(/([\d.]+)px/)[1]) === 18,
      ),
    ).toBe(true);
  }
});

test("small library caption clicks retain caret focus after image hover", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["One", "Two"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  for (const width of [960, 1440]) {
    await setEditorViewport(page, { width, height: 1080 });
    await selectField(page, "image-shape", "landscape");
    for (const placement of [
      "above",
      "below",
      "overlay-top",
      "overlay-bottom",
    ]) {
      await selectField(page, "caption-position", placement);
      await page.locator(".library-heading").nth(0).fill("One");
      await page.locator(".library-heading").nth(1).fill("Two");
      for (const index of [0, 1, 0, 1]) {
        const asset = page.locator(".asset").nth(index);
        const image = asset.locator("[data-library-thumbnail]");
        const caption = asset.locator(".library-heading");
        await expect(image).toBeInViewport({ ratio: 1 });
        await expect(caption).toBeInViewport({ ratio: 1 });

        const captionBounds = await caption.boundingBox();
        await image.hover();
        await expect(caption).not.toBeFocused();
        const previous = await caption.inputValue();
        await caption.click({
          position: { x: 5, y: captionBounds.height / 2 },
        });
        await page.keyboard.press("Control+End");
        await page.keyboard.insertText("x");
        await expect(caption).toHaveValue(`${previous}x`);
        await expect(caption).toBeFocused();
        expect(await caption.evaluate((field) => field.selectionStart)).toBe(
          previous.length + 1,
        );
      }
    }
  }
});

for (const viewportWidth of [1440, 780]) {
  test(`canvas dragging moves into empty cells and swaps occupied cells with crops at ${viewportWidth}px`, async ({
    page,
  }) => {
    await setEditorViewport(page, { width: 1440, height: 1080 });
    await page.goto("./");
    await page.locator("#upload").setInputFiles([
      {
        name: "first.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ff0000"/></svg>',
        ),
      },
      {
        name: "second.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0000ff"/></svg>',
        ),
      },
    ]);
    await expect(page.locator(".asset")).toHaveCount(2);
    const images = page.locator(".cell-image-button");
    const headings = page.locator(".cell-heading");
    await selectField(page, "image-shape", "portrait");
    await selectField(page, "caption-position", "overlay-bottom");
    await page
      .locator(".asset")
      .nth(0)
      .dragTo(images.nth(0), { sourcePosition: { x: 5, y: 50 } });
    await page
      .locator(".asset")
      .nth(1)
      .dragTo(images.nth(1), { sourcePosition: { x: 5, y: 50 } });
    await headings.nth(0).fill("First item");
    await headings.nth(1).fill("Second item");
    await setEditorViewport(page, { width: viewportWidth, height: 1080 });
    await images.nth(0).hover();
    await page.getByRole("button", { name: "Crop image", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Crop image",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Apply crop", exact: true }),
    ).toBeEnabled();
    await dialog.locator("#crop-zoom").fill("4");
    await dialog
      .getByRole("button", { name: "Apply crop", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const before = await savedWorkspace(page);
    expect(before.grid.cells[0].crop).toBeDefined();

    const picture = await images.nth(0).boundingBox();
    const headingBounds = await page
      .locator(".cell-heading")
      .first()
      .boundingBox();
    const bottomY = Math.floor(headingBounds.y - picture.y - 5);
    await images.nth(0).hover({ position: { x: 8, y: bottomY } });
    expect(
      await images.nth(0).evaluate((button, y) => {
        const bounds = button.getBoundingClientRect();
        return document.elementFromPoint(bounds.x + 8, bounds.y + y) === button;
      }, bottomY),
    ).toBe(true);

    const source = await images.nth(0).locator("img").boundingBox();
    expect(source.width).toBeGreaterThan(picture.width * 3);
    expect(
      await images.nth(0).evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        return [8, bounds.width - 8].every(
          (x) =>
            document.elementFromPoint(
              bounds.x + x,
              bounds.y + bounds.height / 2,
            ) === button,
        );
      }),
    ).toBe(true);
    await page.evaluate(() => {
      const original = DataTransfer.prototype.setDragImage;
      window.canvasDragPreviews = [];
      DataTransfer.prototype.setDragImage = function (element, x, y) {
        window.canvasDragPreviews.push({
          tag: element.tagName,
          width: element.width,
          height: element.height,
          x,
          y,
          color: [
            ...element
              .getContext("2d")
              .getImageData(
                Math.floor(element.width / 2),
                Math.floor(element.height / 2),
                1,
                1,
              ).data,
          ],
        });
        return original.call(this, element, x, y);
      };
    });
    await images.nth(0).dragTo(images.nth(2), {
      sourcePosition: { x: 8, y: bottomY },
    });
    await expect(page.locator(".grid-cell").nth(0).locator("img")).toHaveCount(
      0,
    );
    await expect(headings.nth(0)).toHaveValue("");
    await expect(headings.nth(2)).toHaveValue("First item");

    await expect(
      page
        .locator(".grid-cell")
        .nth(0)
        .getByRole("group", { name: "Cell tools" }),
    ).toHaveCount(0);
    const previews = await page.evaluate(() => window.canvasDragPreviews);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      tag: "CANVAS",
      width: 1,
      height: 1,
      color: [0, 0, 0, 0],
    });
    expect(previews[0].x).toBe(0);
    expect(previews[0].y).toBe(0);
    await expect(page.locator("body > canvas")).toHaveCount(0);
    let current = await savedWorkspace(page);
    expect(current.grid.cells[2]).toEqual({
      ...before.grid.cells[0],
      id: before.grid.cells[2].id,
    });
    await images.nth(2).dragTo(images.nth(1));
    await expect(headings.nth(1)).toHaveValue("First item");
    await expect(headings.nth(2)).toHaveValue("Second item");

    await expect(
      page
        .locator(".grid-cell")
        .nth(2)
        .getByRole("group", { name: "Cell tools" }),
    ).toHaveCount(0);
    await expect(page.locator("body > canvas")).toHaveCount(0);
    current = await savedWorkspace(page);
    expect(current.grid.cells[1]).toEqual({
      ...before.grid.cells[0],
      id: before.grid.cells[1].id,
    });
    expect(current.grid.cells[2]).toEqual({
      ...before.grid.cells[1],
      id: before.grid.cells[2].id,
    });
    expect(current.assets).toEqual(before.assets);
    await reloadWorkspace(page);
    await expect(headings.nth(1)).toHaveValue("First item");
    await expect(headings.nth(2)).toHaveValue("Second item");
    expect((await savedWorkspace(page)).grid.cells).toEqual(current.grid.cells);
  });
}

test("touch crop editor fills the viewport and keeps portrait controls usable", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  await selectField(page, "image-shape", "portrait");
  const image = page.locator(".cell-image-button").first();
  await image.tap({ position: { x: 5, y: 5 } });
  await page
    .getByRole("dialog", { name: "Choose image", exact: true })
    .locator("#picker-cell-upload")
    .setInputFiles({
      name: "touch crop.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="200" height="200" fill="#ff0000"/><rect x="200" width="200" height="200" fill="#00ff00"/><rect x="400" width="200" height="200" fill="#0000ff"/></svg>',
      ),
    });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await image.tap();
  await page.getByRole("button", { name: "Crop image", exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "Crop image", exact: true });

  await expect(
    dialog.getByRole("button", { name: "Apply crop", exact: true }),
  ).toBeEnabled();
  const bounds = await dialog.boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, height: 844 });
  expect(bounds.width).toBeGreaterThanOrEqual(370);
  const cropWindow = dialog.locator(".crop-window");
  const cropBounds = await cropWindow.boundingBox();
  expect(cropBounds.width / cropBounds.height).toBeCloseTo(3 / 4, 2);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  for (const name of [
    "Toggle crop guides",
    "Reset crop",
    "Cancel",
    "Apply crop",
  ]) {
    const button = dialog.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const rectangle = await button.boundingBox();
    expect(rectangle.height).toBeGreaterThanOrEqual(44);
    expect(rectangle.width).toBeGreaterThanOrEqual(44);
    expect(rectangle.x).toBeGreaterThanOrEqual(0);
    expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(390);
    expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(844);
  }
  await dialog.getByRole("button", { name: "Toggle crop guides" }).tap();
  await dialog.locator("#crop-zoom").fill("2");
  const session = await context.newCDPSession(page);
  const y = cropBounds.y + cropBounds.height / 2;
  const x = cropBounds.x + cropBounds.width / 2;
  const before = await dialog
    .locator("img")
    .evaluate((element) => element.style.transform);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 12; step++)
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + ((4 - x) * step) / 12, y }],
    });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      dialog.locator("img").evaluate((element) => element.style.transform),
    )
    .not.toBe(before);
  await page.screenshot({
    path: testInfo.outputPath("crop-editor-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
  await expect
    .poll(
      async () => (await localDatabase(page)).document?.grid.cells[0].crop?.x,
    )
    .toBeGreaterThan(0.6);
  await image.tap();
  await page.getByRole("button", { name: "Crop image", exact: true }).tap();
  await expect(dialog.locator("#crop-zoom")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(image).toBeFocused();
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  await session.detach();
  await context.close();
});

test("resizing across large and narrow screens preserves removed images and captions", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 3840, height: 2160 });
  await page.goto("./");
  for (const dimension of ["row", "column"]) {
    for (let count = 0; count < 2; count++)
      await page
        .getByRole("button", { name: `Remove ${dimension}`, exact: true })
        .click();
  }
  await expect(page.locator(".grid-cell")).toHaveCount(1);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(2);
  await page.locator("#upload").setInputFiles({
    name: "Removed.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>',
    ),
  });
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").nth(1));
  await setEditorViewport(page, { width: 260, height: 844 });
  await expect
    .poll(() =>
      page
        .locator("[data-canvas-viewport]")
        .evaluate((viewport) => viewport.scrollWidth > viewport.clientWidth),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator(".cell-heading").nth(1).fill("Removed caption");
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  await expect(page.locator(".grid-cell")).toHaveCount(1);
  expect(
    (await savedWorkspace(page)).grid.overflow.some(
      (entry) => entry.cell.title === "Removed caption",
    ),
  ).toBe(true);
  await expect(
    page.getByRole("region", { name: "Removed cells", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Restore cell:/ }),
  ).toHaveCount(0);
  await reloadWorkspace(page);
  await expect(
    page.getByRole("region", { name: "Removed cells", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Restore cell:/ }),
  ).toHaveCount(0);
});

test("failures show readable, dismissible notifications without success noise", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1000 });
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  const notices = page.locator("[data-sonner-toast]");
  await expect(notices).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reset grid settings", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Reset grid settings", exact: true })
    .getByRole("button", { name: "Reset settings", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(notices).toHaveCount(0);
  await openSidebarPanel(page, "Images");
  await downloadBoard(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(notices).toHaveCount(0);
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1000 });
    const uploadInput =
      width > 900 ? page.locator("#upload") : await beginCellUpload(page, 0);
    await expect
      .poll(() =>
        uploadInput.evaluate(async (element) => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return element.isConnected;
        }),
      )
      .toBe(true);
    const names = ["first", "second", "third"].map(
      (name) => `${name}-${width}`,
    );
    const files = names.map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from("not an image"),
    }));
    if ((await uploadInput.getAttribute("multiple")) !== null)
      await uploadInput.setInputFiles(files);
    else for (const file of files) await uploadInput.setInputFiles(file);
    await expect(notices).toHaveCount(3);
    for (const name of names)
      await expect(
        notices.filter({ hasText: `Could not load ${name}.svg` }),
      ).toHaveCount(1);

    await expect
      .poll(async () =>
        notices.evaluateAll((elements) => {
          const bounds = elements
            .map((element) => element.getBoundingClientRect())
            .sort((first, second) => first.top - second.top);
          return bounds.every(
            (rect, index) =>
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              rect.top >= 0 &&
              rect.bottom <= innerHeight &&
              (index === 0 || rect.top >= bounds[index - 1].bottom),
          );
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`error-notifications-${width}.png`),
    });
    for (const name of names)
      await notices
        .filter({ hasText: `Could not load ${name}.svg` })
        .getByRole("button", { name: "Close toast", exact: true })
        .click();
    await expect(notices).toHaveCount(0);
  }
});

test("independent spacing and canvas backgrounds match preview and export", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1000 });
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  await page.locator("#corner-rounding").fill("0");
  await page.locator("#heading-font-size").fill("40");
  await page.locator("#heading-padding").fill("0");
  await page.locator("#cell-font-size").fill("17");
  const canvasStyle = page.getByRole("group", {
    name: "Canvas style",
    exact: true,
  });
  await expect(
    page.getByRole("group", { name: "Grid style", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#theme-selector")).toHaveCount(0);
  await expect(
    canvasStyle.getByRole("slider", { name: "Gap", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator("#heading-gap")).toHaveCount(0);
  await expect(canvasStyle.locator("#background-value")).toHaveValue(
    /^#17191b$/i,
  );
  await expect(page.locator("[data-image-canvas-background]")).toHaveCSS(
    "background-color",
    "rgb(23, 25, 27)",
  );
  await expect(page.locator("#board-grid")).toHaveCSS(
    "background-color",
    "rgb(23, 25, 27)",
  );

  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  const initialDownload = await downloadBoard(page);
  const initialBytes = await readFile(await initialDownload.path());
  const initialBackground = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const color = [...context.getImageData(0, 0, 1, 1).data];
      bitmap.close();
      return color;
    },
    [...initialBytes],
  );
  expect(initialBackground).toEqual([23, 25, 27, 255]);
  await uploadCellImage(page);
  await selectField(page, "image-shape", "square");
  await selectField(page, "caption-position", "below");
  await page.locator(".cell-heading").first().fill("Blue");
  await page.getByRole("button", { name: /^Edit grid heading: / }).click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Title");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  async function ratios() {
    return page.evaluate(() => {
      const grid = document.querySelector("#board-grid");
      const style = getComputedStyle(grid);
      const cell = grid.firstElementChild.getBoundingClientRect();
      const viewport = document
        .querySelector("[data-canvas-viewport]")
        .getBoundingClientRect();
      const heading = document
        .querySelector(".board-export-heading")
        .getBoundingClientRect();
      return {
        gap: Math.round((parseFloat(style.columnGap) / cell.width) * 1000) / 10,
        padding:
          Math.round((parseFloat(style.paddingLeft) / cell.width) * 1000) / 10,
        heading:
          Math.round(
            ((grid.getBoundingClientRect().top - heading.bottom) / cell.width) *
              1000,
          ) / 10,
      };
    });
  }
  async function checkCanvasPadding() {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas = document
            .querySelector("[data-image-canvas-background]")
            .getBoundingClientRect();
          const grid = document.querySelector("#board-grid");
          const heading = document
            .querySelector(".board-export-heading")
            .getBoundingClientRect();
          const first = grid.firstElementChild.getBoundingClientRect();
          const last = grid.lastElementChild.getBoundingClientRect();
          const viewport = document.querySelector("[data-canvas-viewport]");
          const padding = parseFloat(getComputedStyle(grid).paddingLeft);
          return Math.max(
            Math.abs(heading.top - canvas.top - padding),
            Math.abs(heading.left - canvas.left - padding),
            Math.abs(canvas.right - heading.right - padding),
            Math.abs(first.left - canvas.left - padding),
            Math.abs(canvas.right - last.right - padding),
            Math.abs(canvas.bottom - last.bottom - padding),
            Math.abs(
              canvas.width -
                (viewport.clientWidth -
                  2 * parseFloat(getComputedStyle(viewport).paddingLeft)),
            ),
          );
        }),
      )
      .toBeLessThan(1);
  }
  const expected = { gap: 10, padding: 10, heading: 10 };
  await expect.poll(ratios).toEqual(expected);
  await checkCanvasPadding();
  for (const [id, key, value] of [
    ["canvas-padding", "padding", 5],
    ["gap", "gap", 10],
  ]) {
    await page.locator(`#${id}`).fill(String(value * 5));
    expected[key] = value;
    if (id === "gap") expected.heading = value;
    await expect.poll(ratios).toEqual(expected);
    await expect(page.locator(`#${id}-value`)).toHaveText(`${value * 5}%`);
    await checkCanvasPadding();
  }
  await canvasStyle.locator("#background-value").fill("#d9e7f0");
  await page.locator("#canvas-padding").fill("20");
  expected.padding = 4;
  await expect(page.locator("#canvas-padding-value")).toHaveText("20%");
  await checkCanvasPadding();
  await expect
    .poll(() =>
      page.locator("#board-grid").evaluate((grid) => {
        const cell = grid.firstElementChild.getBoundingClientRect();
        return (
          (parseFloat(getComputedStyle(grid).paddingLeft) / cell.width) * 100
        );
      }),
    )
    .toBeCloseTo(4, 1);
  await page.locator("#heading-background-color-value").fill("#114455");
  await page.locator("#cell-background-color-value").fill("#335577");
  const cardStyle = page.getByRole("group", {
    name: "Card style",
    exact: true,
  });
  await expect(cardStyle.locator("#caption-overlay-value")).toBeVisible();
  await expect(cardStyle.locator("#caption-opacity")).toBeEnabled();
  await cardStyle.locator("#caption-overlay-value").fill("#7700bb");
  await cardStyle.locator("#caption-opacity").fill("35");
  await page.mouse.move(0, 0);

  await expect(page.locator("[data-image-canvas-background]")).toHaveCSS(
    "background-color",
    "rgb(217, 231, 240)",
  );
  await expect(page.locator("#board-grid")).toHaveCSS(
    "background-color",
    "rgb(217, 231, 240)",
  );

  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "background-color",
    "rgb(17, 68, 85)",
  );
  await expect(page.locator(".grid-cell").first()).toHaveCSS(
    "background-color",
    "rgb(51, 85, 119)",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "background-color",
    "rgb(51, 85, 119)",
  );
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const download = await downloadBoard(page);
  const bytes = await readFile(await download.path());
  const pixels = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const sample = (left, top) => [
        ...context.getImageData(left, top, 1, 1).data,
      ];
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        heading: sample(11, 11),
        card: sample(11, 63),
        caption: sample(11, 213),
        padding: sample(1, 53),
        gap: sample(161, 63),
        edges: [
          sample(11, 5),
          sample(5, 11),
          sample(bitmap.width - 6, 11),
          sample(11, bitmap.height - 6),
        ],
      };
      bitmap.close();
      return result;
    },
    [...bytes],
  );
  expect(pixels).toEqual({
    width: 492,
    height: 584,
    heading: [17, 68, 85, 255],
    card: [51, 85, 119, 255],
    caption: [51, 85, 119, 255],
    padding: [217, 231, 240, 255],
    gap: [217, 231, 240, 255],
    edges: Array.from({ length: 4 }, () => [217, 231, 240, 255]),
  });
  await page.locator("#canvas-padding").fill("40");
  expected.padding = 8;
  await expect(page.locator("#canvas-padding-value")).toHaveText("40%");
  await checkCanvasPadding();

  await expect
    .poll(() =>
      page.locator("#board-grid").evaluate((grid) => {
        const cell = grid.firstElementChild.getBoundingClientRect();
        return (
          (parseFloat(getComputedStyle(grid).paddingLeft) / cell.width) * 100
        );
      }),
    )
    .toBeCloseTo(8, 1);
  const padded = await downloadBoard(page);
  const paddedBytes = await readFile(await padded.path());
  expect(paddedBytes).not.toEqual(bytes);
  expect(
    await page.evaluate(
      async (bytes) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
      },
      [...paddedBytes],
    ),
  ).toEqual({ width: 504, height: 596 });
  await reloadWorkspace(page);
  expect((await savedWorkspace(page)).grid).toMatchObject({
    gap: 60,
    canvasPadding: 48,
    background: "#d9e7f0",
    headingBackgroundColor: "#114455",
    cellBackgroundColor: "#335577",
    captionOverlayColor: "#7700bb",
    captionOverlayOpacity: 35,
  });
  await expect(canvasStyle.locator("#background-value")).toHaveValue(
    /^#d9e7f0$/i,
  );
  await expect(page.locator("[data-image-canvas-background]")).toHaveCSS(
    "background-color",
    "rgb(217, 231, 240)",
  );

  await expect.poll(ratios).toEqual(expected);
  await page
    .getByRole("region", { name: "Grid editor", exact: true })
    .screenshot({
      path: testInfo.outputPath("image-canvas-background-desktop.png"),
    });
  await page
    .getByRole("group", { name: "Canvas style", exact: true })
    .screenshot({ path: testInfo.outputPath("canvas-style-desktop.png") });
  await cardStyle.screenshot({
    path: testInfo.outputPath("card-style-desktop.png"),
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  await expect.poll(ratios).toEqual(expected);
  await openSidebarPanel(page, "Settings");
  await expect(page.locator("#canvas-padding")).toHaveValue("40");
  await expect
    .poll(() =>
      page.locator("[data-canvas-viewport]").evaluate((viewport) => {
        const cell = viewport
          .querySelector(".grid-cell")
          .getBoundingClientRect();
        const bounds = viewport.getBoundingClientRect();
        return (
          viewport.clientHeight > 128 &&
          cell.top < bounds.bottom &&
          cell.bottom > bounds.top &&
          cell.left < bounds.right
        );
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await openSidebarPanel(page, "Settings");
  await expect(cardStyle.locator("#caption-overlay-value")).toBeVisible();
  await expect(cardStyle.locator("#caption-opacity")).toBeEnabled();
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  await cardStyle.locator("#caption-overlay-value").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("canvas-card-style-mobile.png"),
  });
});

test("appearance settings preserve content and match exported ratios and captions", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  await page.locator("#gap").fill("10");
  await page.locator("#canvas-padding").fill("10");
  await expect(page.locator('#image-shape [aria-checked="true"]')).toHaveText(
    "Portrait",
  );
  await expect(
    page.locator('#caption-position [aria-checked="true"]'),
  ).toHaveText("Overlay bottom");
  await expect(
    page.locator("#caption-position").getByRole("radio"),
  ).toHaveCount(4);
  await expect(
    page
      .locator("#caption-position")
      .getByRole("radio", { name: /middle|center/i }),
  ).toHaveCount(0);
  await page
    .locator("#image-shape")
    .getByRole("radio", { name: "Landscape", exact: true })
    .press("Enter");
  await expect(page.locator('#image-shape [aria-checked="true"]')).toHaveText(
    "Landscape",
  );
  await selectField(page, "image-shape", "portrait");
  await page.locator("#upload").setInputFiles({
    name: "solid.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#4064c8"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const image = page.locator(".cell-image-button").first();
  const caption = page.locator(".cell-heading").first();
  await openSidebarPanel(page, "Images");
  await page.locator(".asset").dragTo(image);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await openSidebarPanel(page, "Settings");
  await image.hover();
  await caption.fill("Blue");
  const identity = (await savedWorkspace(page)).grid.cells[0];
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  async function pixels(imageHeight, placement, alignment = "bottom") {
    const captionHeight = 36;
    const captionTop =
      placement === "above"
        ? 0
        : placement === "below"
          ? imageHeight
          : alignment === "top"
            ? 0
            : alignment === "middle"
              ? Math.round((imageHeight - captionHeight) / 2)
              : imageHeight - captionHeight;
    const imageTop = placement === "above" ? captionHeight : 0;
    const download = await downloadBoard(page);
    const bytes = await readFile(await download.path());
    const result = await page.evaluate(
      async ({ bytes, captionTop, imageTop, imageHeight, alignment }) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const color = (y) => [...context.getImageData(13, y, 1, 1).data];
        const result = {
          width: bitmap.width,
          height: bitmap.height,
          caption: color(3 + captionTop + 3),
          image: color(
            3 +
              imageTop +
              Math.round(imageHeight * (alignment === "middle" ? 0.3 : 0.5)),
          ),
        };
        bitmap.close();
        return result;
      },
      { bytes: [...bytes], captionTop, imageTop, imageHeight, alignment },
    );
    expect(result.width).toBe(462);
    expect(result.height).toBe(
      3 * imageHeight + (placement === "overlay" ? 0 : captionHeight) + 12,
    );
    expect(result.image).toEqual([64, 100, 200, 255]);
    return result.caption;
  }
  for (const [aspect, ratio, imageHeight] of [
    ["Portrait", 3 / 4, 200],
    ["Landscape", 4 / 3, 113],
    ["Square", 1, 150],
  ]) {
    await selectField(page, "image-shape", aspect.toLowerCase());
    await expect(page.locator('#image-shape [aria-checked="true"]')).toHaveText(
      aspect,
    );
    for (const placement of ["above", "below", "overlay"]) {
      await selectField(
        page,
        "caption-position",
        placement === "overlay" ? "overlay-bottom" : placement,
      );
      const bounds = await image.boundingBox();
      expect(Math.abs(bounds.width / bounds.height - ratio)).toBeLessThan(
        0.015,
      );
      const field = await caption.boundingBox();
      if (placement === "above")
        expect(field.y + field.height).toBeCloseTo(bounds.y, 0);
      if (placement === "below")
        expect(field.y).toBeCloseTo(bounds.y + bounds.height, 0);
      if (placement !== "overlay") {
        await expect(
          page.getByRole("button", { name: "Text overlay settings" }),
        ).toHaveCount(0);
        expect(await pixels(imageHeight, placement)).toEqual([32, 35, 37, 255]);
        continue;
      }
      await expect(
        page.getByRole("textbox", {
          name: "Overlay color hex value",
          exact: true,
        }),
      ).not.toBeFocused();
      await page
        .getByRole("textbox", { name: "Overlay color hex value", exact: true })
        .fill("#00ff00");
      await page.locator("#caption-opacity").fill("50");
      for (const alignment of ["top", "bottom"]) {
        await selectField(page, "caption-position", `overlay-${alignment}`);

        const imageBounds = await image.boundingBox();
        const captionBounds = await caption.boundingBox();
        const expected =
          alignment === "top"
            ? imageBounds.y
            : alignment === "middle"
              ? imageBounds.y + (imageBounds.height - captionBounds.height) / 2
              : imageBounds.y + imageBounds.height - captionBounds.height;
        expect(captionBounds.y).toBeCloseTo(expected, 0);
        await image.hover();
        const toolBounds = await page
          .getByRole("group", { name: "Cell tools", exact: true })
          .locator("button")
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const rect = button.getBoundingClientRect();
              return { top: rect.top, bottom: rect.bottom };
            }),
          );
        expect(toolBounds).toHaveLength(3);
        for (const rect of toolBounds)
          expect(
            rect.bottom <= captionBounds.y + 1 ||
              rect.top >= captionBounds.y + captionBounds.height - 1,
          ).toBe(true);
        await page.mouse.move(0, 0);
        const pixel = await pixels(imageHeight, "overlay", alignment);
        expect(Math.abs(pixel[0] - 32)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixel[1] - 178)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixel[2] - 100)).toBeLessThanOrEqual(1);
        expect(pixel[3]).toBe(255);
      }
    }
  }
  for (const [opacity, expected] of [
    [0, [64, 100, 200, 255]],
    [100, [0, 255, 0, 255]],
  ]) {
    await page.locator("#caption-opacity").fill(String(opacity));
    expect(await pixels(150, "overlay")).toEqual(expected);
  }
  await caption.fill("A surprisingly long caption that remains editable");
  await expect(caption).toHaveValue(
    "A surprisingly long caption that remains editable",
  );
  await caption.press("Tab");
  const longCaptionPreview = page
    .locator(".grid-cell")
    .first()
    .locator("[data-caption-preview] span");
  await expect(longCaptionPreview).toBeVisible();
  await expect
    .poll(() =>
      longCaptionPreview.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          Number(style.webkitLineClamp) <= 3 &&
          element.getBoundingClientRect().height <=
            parseFloat(style.lineHeight) * 3 + 0.1
        );
      }),
    )
    .toBe(true);
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: testInfo.outputPath("appearance-desktop.png"),
  });
  await reloadWorkspace(page);
  await expect(caption).toHaveValue(
    "A surprisingly long caption that remains editable",
  );
  const saved = await savedWorkspace(page);
  expect(saved.grid.cells[0]).toMatchObject({
    id: identity.id,
    assetId: identity.assetId,
    fit: "cover",
  });
  expect(saved.grid).toMatchObject({
    imageAspect: "square",
    captionPlacement: "overlay",
    captionAlignment: "bottom",
    captionOverlayColor: "#00ff00",
    captionOverlayOpacity: 100,
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  for (const width of [390, 320]) {
    await setEditorViewport(page, { width, height: 844 });
    await showSidebar(page);
    await expect(page.locator("#image-shape")).toHaveAccessibleName("Shape");
    await expect(page.locator("#caption-position")).toHaveAccessibleName(
      "Card heading",
    );
    const positions = page.locator("#caption-position");
    await expect(positions.getByRole("radio")).toHaveCount(4);
    await positions.scrollIntoViewIfNeeded();
    expect(
      await positions.getByRole("radio").evaluateAll((buttons) =>
        buttons.every((button) => {
          const rect = button.getBoundingClientRect();
          return (
            rect.x >= 0 &&
            rect.right <= innerWidth &&
            rect.width >= 44 &&
            rect.height >= 44
          );
        }),
      ),
    ).toBe(true);
  }
  await setEditorViewport(page, { width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await showSidebar(page);
  const color = page.getByRole("textbox", {
    name: "Overlay color hex value",
    exact: true,
  });
  await expect(color).toBeVisible();
  await expect(color).not.toBeFocused();
  await openSidebarPanel(page, "Settings");
  const colorBounds = await color.boundingBox();
  expect(colorBounds.x).toBeGreaterThanOrEqual(0);
  expect(colorBounds.x + colorBounds.width).toBeLessThanOrEqual(390);
  await closeSidebarPanel(page);
  await selectField(page, "image-shape", "landscape");
  await selectField(page, "caption-position", "overlay-bottom");
  await caption.fill("Blue");
  await image.hover();
  await expect(
    page.getByRole("group", { name: "Cell tools", exact: true }),
  ).toBeVisible();
  const mobileCaption = await caption.boundingBox();
  const mobileTools = await page
    .getByRole("group", { name: "Cell tools", exact: true })
    .locator("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    );
  expect(mobileTools).toHaveLength(3);
  for (const rect of mobileTools)
    expect(
      rect.bottom <= mobileCaption.y + 1 ||
        rect.top >= mobileCaption.y + mobileCaption.height - 1,
    ).toBe(true);
  await caption.click();
  await page.screenshot({ path: testInfo.outputPath("appearance-mobile.png") });
});

test("editable hex color and Headless UI settings dropdowns synchronize and persist", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  await expect(
    page.getByRole("switch", { name: "Show heading", exact: true }),
  ).toBeChecked();
  await expect(page.locator(".settings-panel select")).toHaveCount(0);
  const canvasStyle = page.getByRole("group", {
    name: "Canvas style",
    exact: true,
  });
  const hex = canvasStyle.getByRole("textbox", {
    name: "Background hex value",
    exact: true,
  });
  const picker = canvasStyle.getByLabel("Background color picker", {
    exact: true,
  });
  for (const id of ["heading-font", "cell-font"]) {
    await page.locator(`label[for="${id}"]`).hover();

    await page.locator(`#${id}`).hover();

    await page.locator(`label[for="${id}"]`).click();
    await expect(page.locator(`#${id}`)).toBeFocused();
    await page.locator(`#${id}`).press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(`#${id}`)).toBeFocused();

    await page.locator(`#${id}`).screenshot({
      path: testInfo.outputPath(`focus-${id}.png`),
    });
    await page.locator(`#${id}`).press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.getByRole("listbox").press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }
  await page.locator('label[for="background-value"]').hover();

  await page.locator('label[for="background-value"]').click();
  await expect(hex).toBeFocused();
  await hex.blur();
  for (const field of [picker, hex]) {
    await page.mouse.move(0, 0);

    const value = await field.inputValue();
    const before = await field.boundingBox();
    await field.hover();

    await expect(field).toHaveValue(value);
    expect(await field.boundingBox()).toEqual(before);
  }
  const pickerBox = await picker.boundingBox();
  expect(pickerBox.width).toBeGreaterThanOrEqual(64);
  expect(pickerBox.height).toBeGreaterThanOrEqual(44);
  expect((await hex.boundingBox()).height).toBeGreaterThanOrEqual(44);

  await hex.click();
  await expect(hex).toBeFocused();
  await hex.fill("112233");
  await hex.press("Enter");
  await expect(hex).toHaveValue("#112233");
  await expect(picker).toHaveValue("#112233");
  await hex.fill("#zzzzzz");
  await expect(picker).toHaveValue("#112233");
  await hex.press("Tab");
  await expect(hex).toHaveValue("#112233");
  await hex.fill("#12");
  await hex.press("Escape");
  await expect(hex).toHaveValue("#112233");
  await picker.fill("#aabbcc");
  await expect(hex).toHaveValue("#AABBCC");
  await page.locator("#heading-font").click();
  for (const option of await page.getByRole("option").all()) {
    const spacing = await option.evaluate((element) => {
      const row = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      return {
        height: row.height,
        top: text.top - row.top,
        bottom: row.bottom - text.bottom,
      };
    });
    expect(spacing.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(spacing.top - spacing.bottom)).toBeLessThanOrEqual(2);
  }
  await expect(
    page.getByRole("option", { name: "Manrope", exact: true }),
  ).toBeDisabled();
  await page.getByRole("listbox").press("End");
  await expect(
    page.getByRole("option", { name: "Boogaloo", exact: true }),
  ).toHaveAttribute("data-focus", "");
  await page.getByRole("listbox").press("Enter");
  await expect(page.locator("#heading-font")).toHaveText("Boogaloo");
  await selectField(page, "heading-font", "Manrope");
  await expect(page.locator("#heading-font")).toHaveText("Manrope");
  await selectField(page, "cell-font", "Boogaloo");
  await expect(page.locator("#cell-font")).toHaveText("Boogaloo");
  await page.locator("#heading-font").click();
  await page.screenshot({
    path: testInfo.outputPath("color-dropdowns-desktop.png"),
  });
  await page.getByRole("listbox").press("Escape");
  await page.locator("#export-grid-header").click();
  await expect(page.locator(".settings-panel select")).toHaveCount(0);
  await selectField(page, "format", "image/webp");
  await selectField(page, "resolution", "300");
  await expect
    .poll(async () => (await localDatabase(page)).document?.exportSettings)
    .toMatchObject({ format: "image/webp", resolution: 300 });
  await reloadWorkspace(page);
  await expect(hex).toHaveValue("#AABBCC");
  await expect(page.locator("#heading-font")).toHaveText("Manrope");
  await expect(page.locator("#cell-font")).toHaveText("Boogaloo");
  await setEditorViewport(page, { width: 390, height: 844 });
  await showSidebar(page);
  await page.locator("#heading-font").click();
  await expect(async () => {
    const menuBox = await page.getByRole("listbox").boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(
      page.viewportSize().width,
    );
  }).toPass({ timeout: 5000 });
  await page.screenshot({
    path: testInfo.outputPath("color-dropdowns-mobile.png"),
  });
  await page.getByRole("listbox").press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("cell toolbar overlays the image and never selects a cell", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "overlay.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96"><rect width="192" height="96" fill="#40b4aa"/><rect width="96" height="96" fill="#e74264"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator(".asset").hover();
  const libraryDelete = page.getByRole("button", {
    name: "Delete overlay",
    exact: true,
  });
  await libraryDelete.hover();

  await page.mouse.move(3, 3);
  const image = page.locator(".cell-image-button").first();
  await page.locator(".asset").dragTo(image);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await page.mouse.move(3, 3);
  await image.hover();
  const tools = page.getByRole("group", { name: "Cell tools", exact: true });
  await expect(tools).toBeVisible();
  for (const name of ["Replace image", "Crop image", "Clear cell"]) {
    const button = tools.getByRole("button", { name, exact: true });
    const before = await button.boundingBox();
    await button.hover();

    expect(await button.boundingBox()).toEqual(before);
  }
  await image.hover();
  const picture = await image.boundingBox();
  const toolbar = await tools.boundingBox();
  expect(toolbar.x).toBeGreaterThanOrEqual(picture.x - 1);
  expect(toolbar.y).toBeGreaterThanOrEqual(picture.y - 1);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(
    picture.x + picture.width + 1,
  );
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(
    picture.y + picture.height + 1,
  );
  await expect(
    tools.getByRole("button", { name: "Edit heading", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      ".grid-cell.selected, .cell-badge, #asset-count, #board-summary, .canvas-heading",
    ),
  ).toHaveCount(0);
  await tools.getByRole("button", { name: "Crop image", exact: true }).click();
  const cropDialog = page.getByRole("dialog", {
    name: "Crop image",
    exact: true,
  });
  await expect(cropDialog).toBeVisible();
  await cropDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(cropDialog).toHaveCount(0);
  await expect(image).toBeFocused();
  await expect(
    page.getByRole("button", { name: /^(Fit|Fill) image$/ }),
  ).toHaveCount(0);
  await image.hover();
  await expect(tools.locator("button:disabled")).toHaveCount(0);

  const clear = await tools
    .getByRole("button", { name: "Clear cell", exact: true })
    .boundingBox();
  expect(clear.x).toBeGreaterThanOrEqual(picture.x);
  expect(clear.y).toBeGreaterThanOrEqual(picture.y);
  expect(clear.x + clear.width).toBeLessThanOrEqual(picture.x + picture.width);
  expect(clear.y + clear.height).toBeLessThanOrEqual(
    picture.y + picture.height,
  );
  await expect(page.locator(".grid-cell img")).toHaveCSS("object-fit", "cover");
  await page.screenshot({
    path: testInfo.outputPath("cell-overlay-desktop.png"),
  });
  await page.locator(".cell-heading").first().fill("Inline caption");
  await expect(tools).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.cells[0].title)
    .toBe("Inline caption");
});

test("touch cell overlays target the tapped image without autofocus", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  const image = page.locator(".cell-image-button").nth(2);
  await image.tap({ position: { x: 5, y: 5 } });
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input, textarea"),
    ),
  ).toBe(false);
  const picker = page.getByRole("dialog", { name: "Choose image" });
  await picker.locator("#picker-cell-upload").setInputFiles({
    name: "touch.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#40b4aa"/></svg>',
    ),
  });
  const tools = page.getByRole("group", { name: "Cell tools", exact: true });
  await expect(tools).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input, textarea"),
    ),
  ).toBe(false);
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".grid-cell").nth(2).locator("img")).toHaveCount(1);
  await expect(page.locator(".grid-cell").first().locator("img")).toHaveCount(
    0,
  );
  await image.tap();
  await expect(tools).toBeVisible();
  const picture = await image.boundingBox();
  const toolbar = await tools.boundingBox();
  expect(toolbar.x).toBeGreaterThanOrEqual(picture.x - 1);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(
    picture.x + picture.width + 1,
  );
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(
    picture.y + picture.height + 1,
  );
  const clear = await tools
    .getByRole("button", { name: "Clear cell", exact: true })
    .boundingBox();
  const drag = await tools
    .getByRole("button", { name: "Drag image", exact: true })
    .boundingBox();
  const inset = picture.x + picture.width - clear.x - clear.width;
  expect(drag.x - picture.x).toBeCloseTo(inset, 0);
  expect(drag.y - picture.y).toBeCloseTo(clear.y - picture.y, 0);
  const heading = await page
    .locator(".grid-cell")
    .nth(2)
    .locator(".cell-heading")
    .boundingBox();
  expect(toolbar.y + toolbar.height).toBeCloseTo(heading.y, 0);
  for (const name of ["Replace image", "Crop image"]) {
    const control = tools.getByRole("button", { name, exact: true });
    const button = await control.boundingBox();
    expect(toolbar.y + toolbar.height - button.y - button.height).toBeCloseTo(
      inset,
      0,
    );
    const sideGap =
      name === "Replace image"
        ? button.x - picture.x
        : picture.x + picture.width - button.x - button.width;
    expect(sideGap).toBeCloseTo(inset, 0);
    expect(button.y + button.height).toBeLessThan(heading.y);
    expect(
      await control.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          ),
        );
      }),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("cell-overlay-mobile.png"),
  });
  await selectField(page, "caption-position", "overlay-top");
  await image.tap();
  await expect(tools).toBeVisible();
  const topRegion = await tools.boundingBox();
  const topHeading = await page
    .locator(".grid-cell")
    .nth(2)
    .locator(".cell-heading")
    .boundingBox();
  expect(topRegion.y).toBeCloseTo(topHeading.y + topHeading.height, 0);
  const topPicture = await image.boundingBox();
  expect(topRegion.y + topRegion.height).toBeCloseTo(
    topPicture.y + topPicture.height,
    0,
  );
  for (const [name, side, edge] of [
    ["Drag image", "left", "top"],
    ["Clear cell", "right", "top"],
    ["Replace image", "left", "bottom"],
    ["Crop image", "right", "bottom"],
  ]) {
    const control = tools.getByRole("button", { name, exact: true });
    const button = await control.boundingBox();
    const sideGap =
      side === "left"
        ? button.x - topRegion.x
        : topRegion.x + topRegion.width - button.x - button.width;
    const edgeGap =
      edge === "top"
        ? button.y - topRegion.y
        : topRegion.y + topRegion.height - button.y - button.height;
    expect(edgeGap).toBeCloseTo(sideGap, 0);
    expect(button.y).toBeGreaterThan(topHeading.y + topHeading.height);
    expect(
      await control.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          ),
        );
      }),
    ).toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("cell-overlay-top-mobile.png"),
  });
  for (const position of ["overlay-bottom", "overlay-top"]) {
    await selectField(page, "caption-position", position);
    await image.tap();
    await expect(tools).toBeVisible();
    await image.hover();
    await expect(page.locator(".grid-cell").nth(2)).toHaveAttribute(
      "data-image-hovered",
      "",
    );
    const paintInset = await tools.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;width:var(--card-paint-inset,0px);height:0;pointer-events:none";
      element.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    });
    expect(paintInset).toBe(0);
    const region = await tools.boundingBox();
    for (const [name, side, edge] of [
      ["Drag image", "left", "top"],
      ["Clear cell", "right", "top"],
      ["Replace image", "left", "bottom"],
      ["Crop image", "right", "bottom"],
    ]) {
      const button = await tools
        .getByRole("button", { name, exact: true })
        .boundingBox();
      const visibleSideGap =
        (side === "left"
          ? button.x - region.x
          : region.x + region.width - button.x - button.width) - paintInset;
      const headingEdge = position === `overlay-${edge}`;
      const visibleEdgeGap =
        (edge === "top"
          ? button.y - region.y
          : region.y + region.height - button.y - button.height) -
        (headingEdge ? 0 : paintInset);
      expect(visibleSideGap).toBeGreaterThan(0);
      expect(visibleEdgeGap).toBeCloseTo(visibleSideGap, 0);
    }
    await page.screenshot({
      path: testInfo.outputPath(`cell-${position}-hover.png`),
    });
  }
  const caption = page.locator(".grid-cell").nth(2).locator(".cell-heading");
  await caption.fill("One\nTwo\nThree\nFour\nFive\nSix");
  for (const shape of ["portrait", "landscape", "square"]) {
    await selectField(page, "image-shape", shape);
    for (const position of ["overlay-top", "overlay-bottom"]) {
      await selectField(page, "caption-position", position);
      const bounds = await image.boundingBox();
      await image.tap({
        position: {
          x: 5,
          y: position === "overlay-top" ? bounds.height - 5 : 5,
        },
      });
      await expect(tools).toBeVisible();
      const buttons = await tools.locator("button").evaluateAll((buttons) =>
        buttons.map((button) => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
      expect(buttons).toHaveLength(4);
      const heading = await caption.boundingBox();
      for (const [index, button] of buttons.entries()) {
        expect(button.width).toBeGreaterThan(bounds.width * 0.15);
        if (position === "overlay-top")
          expect(button.y - heading.y - heading.height).toBeGreaterThan(
            bounds.width * 0.04 - 1,
          );
        else
          expect(heading.y - button.y - button.height).toBeGreaterThan(
            bounds.width * 0.04 - 1,
          );
        for (const other of buttons.slice(index + 1)) {
          const horizontal = Math.max(
            0,
            button.x - other.x - other.width,
            other.x - button.x - button.width,
          );
          const vertical = Math.max(
            0,
            button.y - other.y - other.height,
            other.y - button.y - button.height,
          );
          expect(Math.hypot(horizontal, vertical)).toBeGreaterThan(
            bounds.width * 0.04 - 1,
          );
        }
      }
      await expect
        .poll(() =>
          page
            .locator(".grid-cell")
            .nth(2)
            .locator("[data-caption-preview] > span")
            .evaluate((preview) => {
              const style = getComputedStyle(preview);
              const lines = Number(style.webkitLineClamp);
              return (
                lines > 0 &&
                lines <= 3 &&
                preview.getBoundingClientRect().height <=
                  parseFloat(style.lineHeight) * 3 + 1
              );
            }),
        )
        .toBe(true);
      await expect(caption).toHaveValue("One\nTwo\nThree\nFour\nFive\nSix");
    }
  }
  await page.screenshot({
    path: testInfo.outputPath("capped-caption-tools-mobile.png"),
  });
  await context.close();
});

test("image source dropdown fits narrow panels without category filters", async ({
  page,
}) => {
  await setEditorViewport(page, { width: 960, height: 900 });
  await page.goto("./");
  await useComicExample(page, "marvel");
  await page.locator("#upload").setInputFiles({
    name: "imported.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(9);
  let source = page.locator("#sidebar-image-source");
  await expect(source).toHaveText("My images");
  await source.click();
  await expect(
    page.getByRole("option", { name: "Wikimedia Commons", exact: true }),
  ).toBeEnabled();
  await page.getByRole("listbox").press("Escape");
  const assertContained = async () => {
    await expect
      .poll(() =>
        source.evaluate((element) => {
          const panel = element.getBoundingClientRect();
          return (
            panel.left >= 0 &&
            panel.right <= innerWidth &&
            element.scrollWidth <= element.clientWidth
          );
        }),
      )
      .toBe(true);
  };
  await assertContained();
  await source.click();
  await expect(
    page.getByRole("option", { name: "My images", exact: true }),
  ).toBeDisabled();
  await page.getByRole("listbox").press("Escape");
  await expect(page.locator(".asset")).toHaveCount(9);
  const document = await savedWorkspace(page);
  document.assets.find((asset) => asset.category === "Imported").category =
    "ExtraordinarilyLongImportedCategory";
  await localDatabase(page, "write", document);
  await page.reload();
  await expect(source).toBeVisible();
  await assertContained();
  await setEditorViewport(page, { width: 390, height: 844 });
  await beginCellUpload(page, 0);
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  source = picker.locator("#picker-image-source");
  await assertContained();
  const thumbnail = picker.locator(".asset [data-library-thumbnail]").first();
  await thumbnail.hover({ position: { x: 5, y: 50 } });
  const imageButton = picker.locator(".asset").first();

  await page.mouse.move(1, 1);
  await thumbnail.focus();
  await thumbnail.press("Tab");
  await imageButton.locator("textarea").press("Shift+Tab");
  await expect(thumbnail).toBeFocused();

  await thumbnail.press("Tab");
  await imageButton.locator("textarea").press("Tab");
  const keyboardFocus = picker.locator(".asset").nth(1);
  await expect(keyboardFocus.locator("[data-library-thumbnail]")).toBeFocused();

  const uploadFocus = picker.locator("[data-upload-tile]");
  await page.mouse.move(1, 1);
  await thumbnail.focus();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await thumbnail.press("Shift+Tab");
  await expect(uploadFocus).toBeFocused();

  for (const width of [390, 714, 820]) {
    await setEditorViewport(page, { width, height: 844 });
    await assertContained();
    await expect
      .poll(() =>
        picker.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true);
  }
  await picker
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await setEditorViewport(page, { width: 1440, height: 1080 });
  const desktopImage = page.locator("#asset-library .asset").first();
  await expect(desktopImage.locator(".asset-name")).toBeVisible();
  await desktopImage.locator(".asset-name").hover();

  await page.mouse.move(1, 1);
  await desktopImage.locator("[data-library-thumbnail]").focus();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await desktopImage.locator("[data-library-thumbnail]").press("Tab");
  await desktopImage.locator("textarea").press("Tab");
  const desktopFocus = page.locator("#asset-library .asset").nth(1);
  await expect(desktopFocus.locator("[data-library-thumbnail]")).toBeFocused();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("image library has no demo header or loader on any host", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Load example", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".asset-panel .section-heading")).toHaveCount(0);
  const exampleRequests = [];
  await page.route("https://grids.example/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("comics")) exampleRequests.push(url.pathname);
    const response = await route.fetch({
      url: `http://localhost:5840${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await page.goto("https://grids.example/grids/");
  await expect(page.locator("#board-grid")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load example", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Load example", exact: true }),
  ).toHaveCount(0);
  expect(exampleRequests).toEqual([]);
});

touchTest(
  "image imports show progress and keep the editor responsive through failed files",
  async ({ page }, testInfo) => {
    await setEditorViewport(page, { width: 1440, height: 1080 });
    await page.addInitScript(() => {
      const decode = HTMLImageElement.prototype.decode;
      window.pendingImageDecodes = [];
      HTMLImageElement.prototype.decode = function () {
        if (!this.src.startsWith("blob:")) return decode.call(this);
        return new Promise((resolve, reject) => {
          window.pendingImageDecodes.push(() =>
            decode.call(this).then(resolve, reject),
          );
        });
      };
    });
    await page.goto("./");
    await page.locator("#upload").setInputFiles([
      {
        name: "first.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
        ),
      },
      {
        name: "broken.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from("not an image"),
      },
      {
        name: "second.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e74264"/></svg>',
        ),
      },
      {
        name: "third.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/></svg>',
        ),
      },
      {
        name: "fourth.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/></svg>',
        ),
      },
    ]);
    const add = page.getByRole("button", { name: "Add images", exact: true });
    const progress = add.getByRole("status");
    const library = page.getByRole("complementary", {
      name: "Image library drop zone",
      exact: true,
    });
    await expect(progress).toContainText("0 / 5");
    const loading = page.locator(
      '[data-image-placeholder][data-loading="true"]:visible',
    );
    await expect(loading).toHaveCount(5);

    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(
        new File(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/></svg>',
          ],
          "overlap.svg",
          { type: "image/svg+xml" },
        ),
      );
      return data;
    });
    await library.dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
    await expect(progress).toContainText("0 / 6");
    await expect(loading).toHaveCount(6);
    await expect(add).toBeDisabled();

    await expect(library).toHaveAttribute("aria-busy", "true");
    await openSidebarPanel(page, "Settings");
    await page.locator("#gap").fill("20");
    await expect(page.locator("#gap")).toHaveValue("20");
    await openSidebarPanel(page, "Images");
    await page.screenshot({
      path: testInfo.outputPath("import-progress-desktop.png"),
    });
    for (const completed of [0, 1, 2, 3, 4, 5]) {
      await expect(progress).toContainText(`${completed} / 6`);
      await expect(loading).toHaveCount(6 - completed);
      await expect(
        (completed > 1
          ? page.getByRole("dialog", { name: "Choose image", exact: true })
          : page
        ).locator(".asset:visible"),
      ).toHaveCount(completed - (completed >= 3 ? 1 : 0));
      await expect
        .poll(() => page.evaluate(() => window.pendingImageDecodes.length))
        .toBeGreaterThan(0);
      if (completed === 1) {
        await setEditorViewport(page, { width: 390, height: 844 });
        await page
          .locator(".cell-image-button")
          .first()
          .tap({ position: { x: 5, y: 5 } });
        await expect(progress).toBeVisible();

        const local = page.getByRole("region", {
          name: "My images",
          exact: true,
        });

        await expect(
          local.getByText("No images yet.", { exact: true }),
        ).toHaveCount(0);
        await expect
          .poll(async () => {
            const bounds = await progress.boundingBox();
            return bounds ? bounds.y + bounds.height : Infinity;
          })
          .toBeLessThanOrEqual(836);
        await page.screenshot({
          path: testInfo.outputPath("import-progress-mobile.png"),
        });
      }
      await page.evaluate(() => {
        window.pendingImageDecodes.shift()();
      });
    }
    await expect(progress).toHaveCount(0);

    await expect(add).toBeEnabled();
    await page
      .getByRole("dialog", { name: "Choose image", exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await setEditorViewport(page, { width: 1440, height: 1080 });
    await expect(library).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".asset")).toHaveCount(5);
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "Could not load broken.svg",
    );
    await expect
      .poll(async () => (await localDatabase(page)).document?.assets.length)
      .toBe(5);
    expect((await localDatabase(page)).images).toHaveLength(5);
    expect((await savedWorkspace(page)).grid.gap).toBe(24);
  },
);

test("My images has no filler cards and rejects GIF uploads and drops", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("#sidebar-image-source")).toHaveText("My images");

  await expect(page.locator("#asset-library [data-upload-tile]")).toHaveCount(
    1,
  );
  const gif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/></svg>',
  );
  for (const file of [
    { name: "ordinary.gif", mimeType: "image/gif", buffer: gif },
    { name: "disguised.png", mimeType: "image/png", buffer: gif },
    {
      name: "legacy.png",
      mimeType: "image/png",
      buffer: Buffer.concat([Buffer.from("GIF87a"), gif.subarray(6)]),
    },
    { name: "extension.GIF", mimeType: "image/svg+xml", buffer: svg },
    { name: "mime.png", mimeType: "image/gif", buffer: svg },
  ]) {
    await page.locator("#upload").setInputFiles(file);
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: file.name }),
    ).toContainText("GIF uploads are not supported.");
    await expect(page.locator(".asset")).toHaveCount(0);
    expect((await localDatabase(page)).images).toHaveLength(0);
  }
  await page.locator("#replace-upload").setInputFiles({
    name: "replacement.gif",
    mimeType: "image/gif",
    buffer: gif,
  });
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "replacement.gif" }),
  ).toContainText("GIF uploads are not supported.");
  await page.locator("#upload").setInputFiles([
    { name: "mixed.gif", mimeType: "image/gif", buffer: gif },
    { name: "Allowed.svg", mimeType: "image/svg+xml", buffer: svg },
  ]);
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator(".cell-image-button").first().press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  const local = picker.getByRole("region", { name: "My images", exact: true });

  await expect(local.locator("[data-library-image]")).toHaveCount(1);
  const accepts = await page
    .locator('input[type="file"]')
    .evaluateAll((inputs) => inputs.map((input) => input.accept));
  expect(accepts).toHaveLength(3);
  for (const accept of accepts) {
    expect(accept).not.toContain("image/*");
    expect(accept).not.toContain("image/gif");
    expect(accept).toContain("image/png");
  }
  await picker
    .locator("#picker-cell-upload")
    .setInputFiles({ name: "picker.gif", mimeType: "image/gif", buffer: gif });
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "picker.gif" }),
  ).toContainText("GIF uploads are not supported.");
  await expect(picker).toHaveCount(0);
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], "dropped.gif", { type: "image/gif" }),
      );
      return data;
    },
    [...gif],
  );
  await page
    .locator("#asset-library")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "dropped.gif" })
      .last(),
  ).toContainText("GIF uploads are not supported.");
  await page
    .locator(".grid-cell")
    .first()
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "dropped.gif" }),
  ).toHaveCount(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).images.length)
    .toBe(1);
  await expect(page.locator("#asset-library .asset")).toHaveCount(1);
  await transfer.dispose();
});

test("empty cells and image library accept direct uploads and file drops", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  const placeholder = page.getByRole("button", {
    name: "Add image to cell 5",
    exact: true,
  });
  await placeholder.hover();
  await expect(
    page.getByRole("group", { name: "Cell tools", exact: true }),
  ).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await placeholder.click();
  await (
    await chooser
  ).setFiles({
    name: "direct.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".grid-cell").nth(4).locator("img")).toHaveCount(1);
  await expect(page.locator(".grid-cell").first().locator("img")).toHaveCount(
    0,
  );
  const transfer = await page.evaluateHandle(() => {
    const files = new DataTransfer();
    files.items.add(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e74264"/></svg>',
        ],
        "dropped.svg",
        { type: "image/svg+xml" },
      ),
    );
    return files;
  });
  const library = page.getByRole("complementary", {
    name: "Image library drop zone",
    exact: true,
  });
  await expect(
    library.getByRole("button", { name: "Add images", exact: true }),
  ).toBeVisible();
  await library.dispatchEvent("dragover", { dataTransfer: transfer });

  await library.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  const cell = page.locator(".grid-cell").nth(1);
  await cell.dispatchEvent("dragover", { dataTransfer: transfer });

  await cell.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(cell.locator("img")).toHaveCount(1);

  await expect(page.locator(".asset")).toHaveCount(3);
  await expect
    .poll(async () => (await localDatabase(page)).document?.assets.length)
    .toBe(3);
  await page.screenshot({
    path: testInfo.outputPath("direct-upload-drop-zones.png"),
  });
});

test("reset and library deletion retain canvas images without confirmation", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  const addImages = page.getByRole("button", {
    name: "Add images",
    exact: true,
  });
  expect((await addImages.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(page.locator("#asset-library > :first-child")).toHaveAttribute(
    "aria-label",
    "Add images",
  );
  await expect(
    page.getByRole("group", { name: "Image category", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Grid actions", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rename grid", exact: true }),
  ).toHaveCount(0);
  await page.locator("#upload").setInputFiles(
    ["used.svg", "unused.svg"].map((name) => ({
      name,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(
    page.getByRole("group", { name: "Image category", exact: true }),
  ).toHaveCount(0);
  await chooseImage(page, "used");
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await page.locator(".cell-heading").first().fill("Keep this caption");
  await expect(page.locator(".library-heading").first()).toHaveValue("used");
  await openSidebarPanel(page, "Settings");
  await page.locator("#gap").fill("20");
  await page
    .getByRole("button", { name: "Reset grid settings", exact: true })
    .click();
  const reset = page.getByRole("dialog", {
    name: "Reset grid settings",
    exact: true,
  });
  await expect(reset).toContainText(
    "Library images, cell captions and placements are kept.",
  );
  await reset.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reset).toHaveCount(0);
  await expect(page.locator("#gap")).toHaveValue("20");
  await page
    .getByRole("button", { name: "Reset grid settings", exact: true })
    .click();
  await reset
    .getByRole("button", { name: "Reset settings", exact: true })
    .click();
  await expect(reset).toHaveCount(0);
  await expect(page.locator("#gap")).toHaveValue("50");
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.cells[0].title)
    .toBe("Keep this caption");
  await savedWorkspace(page);
  await openSidebarPanel(page, "Images");
  const tileBox = await addImages.boundingBox();
  const cardBox = await page.locator(".asset").first().boundingBox();
  expect(tileBox.width).toBeCloseTo(cardBox.width, 1);
  expect(tileBox.height).toBeCloseTo(cardBox.height, 1);
  await page
    .getByRole("button", {
      name: "Image options: used",
      exact: true,
    })
    .hover();
  await page.screenshot({
    path: testInfo.outputPath("library-delete-hover-desktop.png"),
  });
  await page.getByRole("button", { name: "Delete used", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await localDatabase(page)).document?.assets.find(
          (asset) => asset.title === "used",
        )?.libraryHidden,
    )
    .toBe(true);
  expect((await localDatabase(page)).images).toHaveLength(2);
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  await page
    .getByRole("button", { name: "Add image to cell 2", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await expect(
    picker.getByRole("button", { name: "Use used", exact: true }),
  ).toHaveCount(0);
  await picker.getByRole("button", { name: "Use unused", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await page.locator("#upload").setInputFiles({
    name: "spare.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Clear all images", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await localDatabase(page)).document?.assets.filter(
          (asset) => !asset.libraryHidden,
        ).length,
    )
    .toBe(0);
  expect((await localDatabase(page)).images).toHaveLength(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
  await expect(addImages).toBeFocused();
  await expect(page.locator(".asset")).toHaveCount(0);
  expect((await addImages.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
  await expect(
    page.locator(".grid-cell").nth(0).locator("img"),
  ).toHaveAttribute("alt", "Keep this caption");
  await expect(
    page.locator(".grid-cell").nth(1).locator("img"),
  ).toHaveAttribute("alt", "unused");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  const retained = await savedWorkspace(page);
  expect(retained.grid.cells[0].assetId).toBe(
    retained.assets.find((asset) => asset.title === "used").id,
  );
  await page.screenshot({
    path: testInfo.outputPath("clear-reset-library-cleanup-desktop.png"),
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("clear-reset-library-cleanup-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("touch library taps reveal delete and upload remains the first tile", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(testInfo.project.use.baseURL);
  const add = page.getByRole("button", { name: "Add images", exact: true });
  expect((await add.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const chooser = page.waitForEvent("filechooser");
  await add.tap();
  await (
    await chooser
  ).setFiles(
    ["first.svg", "second.svg"].map((name) => ({
      name,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(page.locator("#asset-library > :first-child")).toHaveAttribute(
    "aria-label",
    "Add images",
  );
  const addBox = await add.boundingBox();
  const imageBox = await page.locator(".asset").first().boundingBox();
  expect(addBox.width).toBeCloseTo(imageBox.width, 1);
  expect(addBox.height).toBeCloseTo(imageBox.height, 1);
  await expect(
    page.getByRole("button", { name: "Delete first", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Image options: first", exact: true })
    .tap();
  await expect(
    page.getByRole("button", { name: "Delete first", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("library-delete-tap-mobile.png"),
  });
  await page.getByRole("button", { name: "Delete first", exact: true }).tap();
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Clear all images", exact: true })
    .tap();
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).document?.assets.length)
    .toBe(0);
  expect((await localDatabase(page)).images).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("library-empty-placeholder-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("multi-tab notifications preserve local edits and require confirmed reload", async ({
  page,
  context,
}, testInfo) => {
  await context.addInitScript(() => {
    window.workspaceNotifications = [];
    const NativeChannel = window.BroadcastChannel;
    window.BroadcastChannel = class extends NativeChannel {
      constructor(name) {
        super(name);
        this.workspaceChannel = name === "grids-workspace-v1";
      }
      postMessage(data) {
        if (this.workspaceChannel)
          window.workspaceNotifications.push(structuredClone(data));
        return super.postMessage(data);
      }
    };
  });
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "shared.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "shared");
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.cells[0].title)
    .toBe("shared");
  const original = await savedWorkspace(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator(".asset")).toHaveCount(1);
  await other.clock.install();
  await other.clock.pauseAt(new Date());
  await other.clock.runFor(400);
  expect((await localDatabase(page)).document.revision).toBe(original.revision);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved in this browser",
  );
  await expect(other.locator("#save-status")).toHaveText(
    "Saved in this browser",
  );
  await page.evaluate(() => {
    const channel = new BroadcastChannel("grids-workspace-v1");
    channel.postMessage({ id: "guest", revision: crypto.randomUUID() });
    channel.postMessage({ id: "guest", revision: "invalid" });
    channel.close();
  });
  await other.clock.runFor(400);
  await expect(other.getByRole("alert")).toHaveCount(0);
  await other.locator(".cell-heading").first().fill("Unsaved second tab");
  await expect(other.locator(".cell-heading").first()).toHaveValue(
    "Unsaved second tab",
  );
  await page.locator(".cell-heading").first().fill("Saved elsewhere");
  await editHeading(page, "First tab saved");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => (await localDatabase(page)).document.grid.heading)
    .toBe("First tab saved");
  const latest = await savedWorkspace(page);
  await expect(other.locator("#save-status")).toHaveText(
    "Changed in another tab",
  );
  await expect(other.getByRole("alert")).toContainText(
    "This tab is not saving.",
  );
  await other.clock.runFor(500);
  expect((await localDatabase(page)).document).toEqual(latest);
  expect(
    await other.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  const notifications = await page.evaluate(() =>
    window.workspaceNotifications.filter(
      (message) => message.revision !== "invalid",
    ),
  );
  expect(notifications.length).toBeGreaterThan(1);
  for (const message of notifications) {
    expect(Object.keys(message).sort()).toEqual(["id", "revision"]);
    expect(message.id).toBe("guest");
    expect(message.revision).toMatch(/^[0-9a-f-]{36}$/);
  }
  await other.screenshot({ path: testInfo.outputPath("conflict-desktop.png") });
  await other.setViewportSize({ width: 390, height: 844 });
  await other.screenshot({ path: testInfo.outputPath("conflict-mobile.png") });
  expect(
    await other.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await other
    .getByRole("button", { name: "Reload saved grid", exact: true })
    .click();
  const dialog = other.getByRole("dialog", { name: "Reload saved grid" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await other.clock.runFor(300);
  await expect(dialog).toHaveCount(0);
  await expect(other.locator(".cell-heading").first()).toHaveValue(
    "Unsaved second tab",
  );
  await other.locator("#export-grid-header").click();
  await selectField(other, "resolution", "150");
  expect((await downloadBoard(other)).suggestedFilename()).toBe("grid.png");
  expect((await localDatabase(page)).document).toEqual(latest);
  const unexpectedDialogs = [];
  other.on("dialog", async (dialog) => {
    unexpectedDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await other
    .getByRole("button", { name: "Reload saved grid", exact: true })
    .click();
  const navigation = other.waitForEvent("load");
  await dialog
    .getByRole("button", { name: "Reload saved grid", exact: true })
    .click();
  await navigation;
  await expect(
    other.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("First tab saved");
  await expect(other.locator(".cell-heading").first()).toHaveValue(
    "Saved elsewhere",
  );
  await expect(other.getByRole("alert")).toHaveCount(0);
  await expect(other.locator(".grid-cell img")).toHaveCount(1);
  expect(unexpectedDialogs).toEqual([]);
  expect((await localDatabase(page)).document.revision).toBe(latest.revision);
  await other.close();
});

test("multi-tab focus and visibility checks work without BroadcastChannel", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    window.BroadcastChannel = undefined;
  });
  await page.goto("./");
  await savedWorkspace(page);
  for (const event of ["focus", "visibilitychange"]) {
    const other = await context.newPage();
    await other.goto(page.url());
    await expect(other.locator("#board-grid")).toBeVisible();
    await editHeading(page, `Saved before ${event}`);
    await expect
      .poll(async () => (await localDatabase(page)).document.grid.heading)
      .toBe(`Saved before ${event}`);
    await other.evaluate((event) => {
      if (event === "focus") window.dispatchEvent(new Event("focus"));
      else {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }
    }, event);
    await expect(other.locator("#save-status")).toHaveText(
      "Changed in another tab",
    );
    await expect(other.getByRole("alert")).toBeVisible();
    expect((await localDatabase(page)).document.grid.heading).toBe(
      `Saved before ${event}`,
    );
    await other.close();
  }
});

test("unused-image deletion protects removed cells and revokes only unreferenced media", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["used", "archived", "unused"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(3);
  await chooseImage(page, "used");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await chooseImage(page, "archived", 15);
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  const original = await savedWorkspace(page);
  const unusedId = original.assets[2].id;
  const source = await page
    .locator(".asset")
    .nth(2)
    .locator("img")
    .getAttribute("src");
  await page
    .getByRole("button", { name: "Clear all images", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).document.assets.length)
    .toBe(2);
  const purged = await savedWorkspace(page);
  expect(purged.grid).toEqual(original.grid);
  expect(purged.assets.every((asset) => asset.libraryHidden)).toBe(true);
  expect(purged.assets.some((asset) => asset.id === unusedId)).toBe(false);
  expect(purged.assets.map((asset) => asset.id)).toEqual(
    original.assets.slice(0, 2).map((asset) => asset.id),
  );
  expect(
    (await localDatabase(page)).images.map((image) => image.id).sort(),
  ).toEqual(purged.assets.map((asset) => asset.id).sort());
  expect(
    await page.evaluate(async (src) => {
      try {
        await fetch(src);
        return false;
      } catch {
        return true;
      }
    }, source),
  ).toBe(true);
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(0);
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".cell-heading").nth(15)).toHaveValue("archived");
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath("retained-overflow-media.png"),
  });
});

test("failed unused-image deletion preserves stored metadata and blobs until the retry commits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.failPurgeSave = false;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1" && window.failPurgeSave)
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "purge.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const source = await page.locator(".asset img").getAttribute("src");
  const original = await savedWorkspace(page);
  await page.evaluate(() => {
    window.failPurgeSave = true;
  });
  await page
    .getByRole("button", { name: "Clear all images", exact: true })
    .click();
  await expect(page.locator("#save-status")).toHaveText("Save failed");
  const failed = await localDatabase(page);
  expect(failed.document).toEqual(original);
  expect(failed.images).toHaveLength(1);
  expect(
    await page.evaluate(async (src) => (await fetch(src)).ok, source),
  ).toBe(true);
  await page.evaluate(() => {
    window.failPurgeSave = false;
  });
  await editHeading(page, "Retry deletion");
  expect((await savedWorkspace(page)).assets).toEqual([]);
  expect((await localDatabase(page)).images).toEqual([]);
  expect(
    await page.evaluate(async (src) => {
      try {
        await fetch(src);
        return false;
      } catch {
        return true;
      }
    }, source),
  ).toBe(true);
});

test("debounced saves coalesce edits and flush on hide while guarding unsaved navigation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.settingsWrites = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1") window.settingsWrites++;
      return setItem.call(this, key, value);
    };
  });
  await page.goto("./");
  await uploadCellImage(page);
  await savedWorkspace(page);
  await expect(page.locator("#save-status")).toBeHidden();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.evaluate(() => {
    window.settingsWrites = 0;
  });
  await page.locator(".cell-heading").first().fill("First edit");
  await page.clock.runFor(150);
  await page.locator(".cell-heading").first().fill("Latest edit");
  await expect(page.locator("#save-status")).toHaveText("Saving changes...");
  await expect(page.locator("#save-status")).toBeHidden();
  await page.clock.runFor(299);
  expect(await page.evaluate(() => window.settingsWrites)).toBe(0);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.clock.runFor(1);
  expect((await savedWorkspace(page)).grid.cells[0].title).toBe("Latest edit");
  await expect(page.locator("#save-status")).toBeHidden();
  expect(await page.evaluate(() => window.settingsWrites)).toBe(1);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await page.locator(".cell-heading").first().fill("Hide flush");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect((await savedWorkspace(page)).grid.cells[0].title).toBe("Hide flush");
  expect(await page.evaluate(() => window.settingsWrites)).toBe(2);
  await page.clock.runFor(300);
  expect(await page.evaluate(() => window.settingsWrites)).toBe(2);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1")
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.locator(".cell-heading").first().fill("Unsaved edit");
  await expect(page.locator("#save-status")).toHaveText("Save failed");
  await expect(page.locator("#save-status")).toBeHidden();
  await page.clock.runFor(50);
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Local save failed",
  );
});

test("automatic browser saves need no storage controls or persistence request", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.persistenceRequests = 0;
    window.grantPersistence = false;
    window.persistedStorage = false;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 2048, quota: 65536 }),
        persisted: async () => window.persistedStorage,
        persist: async () => {
          window.persistenceRequests++;
          window.persistedStorage = window.grantPersistence;
          return window.persistedStorage;
        },
      },
    });
  });
  await page.goto("./");
  const image = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
  );
  await page.locator("#replace-upload").setInputFiles({
    name: "storage.svg",
    mimeType: "image/svg+xml",
    buffer: image,
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await savedWorkspace(page);
  await expect(
    page.getByRole("button", {
      name: "Local storage",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.persistenceRequests)).toBe(0);
  await expect(
    page.getByRole("button", {
      name: "Request persistent storage",
      exact: true,
    }),
  ).toHaveCount(0);
  expect((await localDatabase(page)).images[0].size).toBe(image.length);
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(1);
  await setEditorViewport(page, { width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Local storage", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("automatic saves work without browser estimates or persistence APIs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => {
          throw new Error("Estimate unavailable");
        },
      },
    });
  });
  await page.goto("./");
  await openSidebarPanel(page, "Settings");
  await page.locator("#gap").fill("25");
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.gap)
    .toBe(30);
  await reloadWorkspace(page);
  await expect(page.locator("#gap")).toHaveValue("25");
});

test("IndexedDB stores image blobs and private grid content while localStorage holds settings only", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1" && value.length > 2048)
        throw new DOMException("Settings too large", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("./");
  const image = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#12a874"/>${" ".repeat(100_000)}</svg>`,
  );
  await page.locator("#replace-upload").setInputFiles({
    name: "private-photo.svg",
    mimeType: "image/svg+xml",
    buffer: image,
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "private photo");
  await editHeading(page, "Private banner");
  await page.locator(".cell-heading").first().fill("Private caption");
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await page
    .getByRole("dialog", { name: "Export grid", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const document = await savedWorkspace(page);
  const stored = await localDatabase(page);
  expect(stored.images).toEqual([
    {
      id: document.assets[0].id,
      isBlob: true,
      size: image.length,
      type: "image/svg+xml",
    },
  ]);
  expect(JSON.stringify(document)).not.toMatch(/blob:|data:/);
  const settings = await page.evaluate(() =>
    localStorage.getItem("grids-settings-v1"),
  );
  expect(settings.length).toBeLessThan(2048);
  const configuration = JSON.parse(settings);
  expect(Object.keys(configuration).sort()).toEqual([
    "exportSettings",
    "layout",
    "style",
    "version",
  ]);
  for (const privateValue of [
    document.grid.id,
    document.assets[0].id,
    "Private collection",
    "Private banner",
    "Private caption",
    "private photo",
    "blob:",
    "data:",
  ])
    expect(settings).not.toContain(privateValue);
  const originalUrl = await page.locator(".asset img").getAttribute("src");
  expect(originalUrl).toMatch(/^blob:/);
  await reloadWorkspace(page);
  await expect(
    page.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("Private banner");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Private caption",
  );
  await expect
    .poll(() =>
      page
        .locator(".asset img")
        .evaluate((image) => image.complete && image.naturalWidth === 48),
    )
    .toBe(true);
  expect(await page.locator(".asset img").getAttribute("src")).not.toBe(
    originalUrl,
  );
  await page.locator(".cell-heading").first().fill("First edit");
  await page.locator(".cell-heading").first().fill("Second edit");
  await page.locator(".cell-heading").first().fill("Latest edit");
  expect((await savedWorkspace(page)).grid.cells[0].title).toBe("Latest edit");
  await reloadWorkspace(page);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Latest edit",
  );
});

test("missing IndexedDB image data cannot overwrite the stored grid with blank defaults", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#replace-upload").setInputFiles({
    name: "retained.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await editHeading(page, "Keep stored grid");
  const original = await savedWorkspace(page);
  await localDatabase(page, "delete-image", { id: original.assets[0].id });
  await reloadWorkspace(page);
  await expect(page.locator("#save-status")).toHaveText("Session only");
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "stored grid has not been replaced",
  );
  await editHeading(page, "Session edit");
  const stored = await localDatabase(page);
  expect(stored.document).toEqual(original);
  expect(stored.images).toEqual([]);
});

test("revision notifications are emitted only after successful commits", async ({
  page,
}) => {
  const moduleUrl = await storageModuleUrl();
  await page.goto("./");
  const original = await savedWorkspace(page);
  const result = await page.evaluate(async (moduleUrl) => {
    const { LocalWorkspaceStore } = await import(moduleUrl);
    const nativeChannel = window.BroadcastChannel;
    const notifications = [];
    let closed = false;
    window.BroadcastChannel = class {
      postMessage(message) {
        notifications.push(message);
      }
      close() {
        closed = true;
      }
    };
    const store = new LocalWorkspaceStore();
    const workspace = await store.load();
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
    let failed = false;
    try {
      await store.save({
        ...workspace,
        grid: { ...workspace.grid, name: "Rejected commit" },
      });
    } catch {
      failed = true;
    }
    Storage.prototype.setItem = setItem;
    const before = notifications.length;
    await store.save({
      ...workspace,
      grid: { ...workspace.grid, name: "Committed retry" },
    });
    store.dispose();
    window.BroadcastChannel = nativeChannel;
    return { failed, before, notifications, closed };
  }, moduleUrl);
  expect(result.failed).toBe(true);
  expect(result.before).toBe(0);
  expect(result.closed).toBe(true);
  const stored = (await localDatabase(page)).document;
  expect(stored.grid.name).toBe("Committed retry");
  expect(stored.revision).not.toBe(original.revision);
  expect(result.notifications).toEqual([
    { id: "guest", revision: stored.revision },
  ]);
});

test("revision guard rejects stale writes and simultaneous writers without notifications", async ({
  page,
}) => {
  const moduleUrl = await storageModuleUrl();
  await page.goto("./");
  await savedWorkspace(page);
  const result = await page.evaluate(async (moduleUrl) => {
    const { LocalWorkspaceStore, LocalWorkspaceConflictError } = await import(
      moduleUrl
    );
    const broadcast = window.BroadcastChannel;
    window.BroadcastChannel = class {
      constructor() {
        throw new Error("Unavailable");
      }
    };
    const writer = new LocalWorkspaceStore();
    let conflicts = 0;
    const stale = new LocalWorkspaceStore(() => {
      conflicts += 1;
    });
    const latest = await writer.load();
    const older = await stale.load();
    const image = writer.createAsset(new Blob(["Saved bytes"]), "Saved image");
    const unsaved = stale.createAsset(
      new Blob(["Unsaved bytes"]),
      "Unsaved image",
    );
    await writer.save({
      ...latest,
      assets: [image],
      grid: { ...latest.grid, name: "Newer grid" },
    });
    stale.scheduleImageDeletion([image.id]);
    let rejected = false;
    try {
      await stale.save({
        ...older,
        assets: [unsaved],
        grid: { ...older.grid, name: "Stale grid" },
      });
    } catch (error) {
      rejected = error instanceof LocalWorkspaceConflictError;
    }
    const changed = await stale.checkForChanges();
    const intact = await (await fetch(image.src)).text();
    const retained = await (await fetch(unsaved.src)).text();
    writer.dispose();
    stale.dispose();
    const first = new LocalWorkspaceStore();
    const second = new LocalWorkspaceStore();
    const firstGrid = await first.load();
    const secondGrid = await second.load();
    const firstImage = first.createAsset(new Blob(["First"]), "First");
    const secondImage = second.createAsset(new Blob(["Second"]), "Second");
    const attempts = await Promise.allSettled([
      first.save({
        ...firstGrid,
        assets: [...firstGrid.assets, firstImage],
        grid: { ...firstGrid.grid, name: "First writer", gap: 15 },
      }),
      second.save({
        ...secondGrid,
        assets: [...secondGrid.assets, secondImage],
        grid: { ...secondGrid.grid, name: "Second writer", gap: 22 },
      }),
    ]);
    const winner =
      attempts[0].status === "fulfilled" ? firstImage.id : secondImage.id;
    const statuses = attempts.map((attempt) => attempt.status);
    const loserConflict =
      attempts.find((attempt) => attempt.status === "rejected")
        ?.reason instanceof LocalWorkspaceConflictError;
    first.dispose();
    second.dispose();
    window.BroadcastChannel = broadcast;
    return {
      rejected,
      changed,
      conflicts,
      intact,
      retained,
      statuses,
      loserConflict,
      winner,
      protectedId: image.id,
    };
  }, moduleUrl);
  expect(result.rejected).toBe(true);
  expect(result.changed).toBe(true);
  expect(result.conflicts).toBe(1);
  expect(result.intact).toBe("Saved bytes");
  expect(result.retained).toBe("Unsaved bytes");
  expect(result.statuses.sort()).toEqual(["fulfilled", "rejected"]);
  expect(result.loserConflict).toBe(true);
  const stored = await localDatabase(page);
  expect(stored.document.revision).toMatch(/^[0-9a-f-]{36}$/);
  expect(stored.document.assets.map((asset) => asset.id).sort()).toEqual(
    [result.protectedId, result.winner].sort(),
  );
  expect(stored.images.map((image) => image.id).sort()).toEqual(
    [result.protectedId, result.winner].sort(),
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("grids-settings-v1")).style.gap,
    ),
  ).toBe(stored.document.grid.gap);
});

test("local media ownership revokes object URLs and rejects writes after disposal", async ({
  page,
}) => {
  const moduleUrl = await storageModuleUrl();
  await page.goto("./");
  const original = await savedWorkspace(page);
  const lifecycle = await page.evaluate(async (moduleUrl) => {
    const { LocalWorkspaceStore } = await import(moduleUrl);
    const store = new LocalWorkspaceStore();
    const workspace = await store.load();
    const asset = store.createAsset(
      new Blob(["local bytes"], { type: "image/png" }),
      "Lifetime test",
    );
    const before = await (await fetch(asset.src)).text();
    store.dispose();
    let revoked = false;
    let closedWrite = false;
    let closedCreate = false;
    try {
      await fetch(asset.src);
    } catch {
      revoked = true;
    }
    try {
      await store.save(workspace);
    } catch {
      closedWrite = true;
    }
    try {
      store.createAsset(new Blob(["other bytes"]), "Closed");
    } catch {
      closedCreate = true;
    }
    return { before, revoked, closedWrite, closedCreate };
  }, moduleUrl);
  expect(lifecycle).toEqual({
    before: "local bytes",
    revoked: true,
    closedWrite: true,
    closedCreate: true,
  });
  expect((await localDatabase(page)).document).toEqual(original);
});

test("single grid starts neutral and uploaded content persists", async ({
  page,
}, testInfo) => {
  const requests = [];
  const errors = [];
  page.on("request", (request) =>
    requests.push({ type: request.resourceType(), url: request.url() }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page).toHaveTitle("Gridz - Image Boards");
  await expect(
    page.getByRole("link", { name: "Gridz", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#sidebar-image-source")).toBeVisible();
  await expect(
    page.locator("#add-board, #board-tabs, #export-all"),
  ).toHaveCount(0);
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("Add heading");
  expect((await savedWorkspace(page)).grid.publisher).toBe("none");
  await expect(page.locator("#heading-font")).toHaveText("Manrope");
  await expect(page.locator("#cell-font")).toHaveText("Manrope");
  await expect(page.locator('[data-filter="DC"]')).toHaveCount(0);
  await expect(page.locator('[data-filter="Marvel"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(requests.filter((request) => request.type === "image")).toEqual([]);
  expect(
    requests.some((request) => /\/comics-[^/]+\.js/.test(request.url)),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("neutral-desktop.png"),
    fullPage: true,
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("neutral-mobile.png"),
    fullPage: true,
  });
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await selectExportField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const bytes = [...(await readFile(await download.path()))];
  expect(download.suggestedFilename()).toBe("grid.png");
  expect(
    await page.evaluate(async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    }, bytes),
  ).toEqual({ width: 510, height: 660 });
  await page.locator("#replace-upload").setInputFiles({
    name: "personal.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#12a874"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "personal");
  await page.locator(".cell-heading").first().fill("Keep my own caption");
  const snapshot = await savedWorkspace(page);
  await reloadWorkspace(page);
  expect(await savedWorkspace(page)).toEqual(snapshot);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep my own caption",
  );
  expect(errors).toEqual([]);
});

test("image placement, title editing, grid sizing, and image exports", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await useComicExample(page);
  await expect
    .poll(() =>
      page
        .locator(".asset img")
        .evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  expect(new URL(page.url()).pathname).toBe("/grids/");
  await expect(page.locator(".grid-cell")).toHaveCount(4);
  await expect(page.locator(".board-export-heading")).toHaveText("Team DC");
  await expect(page.locator(".board-export-heading img")).toHaveCount(0);

  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "font-family",
    "Bangers, sans-serif",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "font-family",
    "Boogaloo, sans-serif",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "text-transform",
    "none",
  );

  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });

  await page
    .locator(".asset")
    .last()
    .dragTo(page.locator(".cell-image-button").first());
  await expect(page.locator(".cell-heading").first()).toHaveValue("Soft Serve");
  await page
    .locator(".cell-image-button")
    .first()
    .dragTo(page.locator(".cell-image-button").nth(1));
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue("Soft Serve");
  await page.locator(".cell-heading").nth(1).fill("A larger heading");
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue(
    "A larger heading",
  );
  await reloadWorkspace(page);
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue(
    "A larger heading",
  );

  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(6);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await (
    await beginCellUpload(page, 8)
  ).setInputFiles(
    path.join(projectRoot, "tests/fixtures/assets/DC - Kite Man.jpg"),
  );
  await expect(page.locator(".cell-heading").nth(8)).toHaveValue("DC Kite Man");

  await savedWorkspace(page);
  await localDatabase(page, "clear");
  await page.evaluate(() => localStorage.clear());
  await reloadWorkspace(page);
  await useComicExample(page);

  const exports = [];
  for (const publisher of ["dc", "marvel"]) {
    await useComicExample(page, publisher);
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      await selectExportField(page, "resolution", "600");
      await selectField(page, "format", mime);
      const download = await downloadBoard(page);
      const bytes = await readFile(await download.path());
      const expectedExtension = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
      }[mime];
      expect(download.suggestedFilename()).toBe(
        `${publisher}-characters${expectedExtension}`,
      );
      if (mime === "image/png")
        expect([...bytes.slice(0, 8)]).toEqual([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
      if (mime === "image/jpeg")
        expect([...bytes.slice(0, 3)]).toEqual([255, 216, 255]);
      if (mime === "image/webp")
        expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WEBP");
      const result = await page.evaluate(
        async ({ base64, mime, publisher }) => {
          const blob = await (
            await fetch(`data:${mime};base64,${base64}`)
          ).blob();
          const image = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          const title = context.getImageData(60, 950, 600, 138).data;
          const heading = context.getImageData(60, 60, 1260, 168).data;
          let brightTitlePixels = 0;
          let headingPixels = 0;
          for (let index = 0; index < title.length; index += 4) {
            if (
              title[index] > 180 &&
              title[index + 1] > 180 &&
              title[index + 2] > 180
            )
              brightTitlePixels++;
          }
          for (let index = 0; index < heading.length; index += 4) {
            if (
              heading[index] > 180 &&
              heading[index + 1] > 180 &&
              heading[index + 2] > 180
            )
              headingPixels++;
          }
          const headerColor = [
            ...context.getImageData(canvas.width / 2, 84, 1, 1).data,
          ].slice(0, 3);
          const headerMargin = context.getImageData(84, 84, 120, 120).data;
          let headerMarginPixels = 0;
          for (let index = 0; index < headerMargin.length; index += 4) {
            if (
              headerMargin[index] > 200 &&
              headerMargin[index + 1] > 200 &&
              headerMargin[index + 2] > 200
            )
              headerMarginPixels++;
          }
          const result = {
            publisher,
            mime: blob.type,
            width: image.width,
            height: image.height,
            brightTitlePixels,
            headingPixels,
            headerColor,
            headerMarginPixels,
          };
          image.close();
          return result;
        },
        { base64: bytes.toString("base64"), mime, publisher },
      );
      exports.push(result);
    }
  }
  expect(exports.map((result) => result.mime)).toEqual([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  for (const result of exports) {
    expect(result.width).toBe(1380);
    expect(result.height).toBe(2076);
    expect(result.brightTitlePixels).toBeGreaterThan(1000);
    expect(result.headingPixels).toBeGreaterThan(1000);
    expect(result.headerMarginPixels).toBe(0);
    const expectedColor =
      result.publisher === "dc" ? [0, 133, 199] : [237, 29, 36];
    result.headerColor.forEach((channel, index) =>
      expect(Math.abs(channel - expectedColor[index])).toBeLessThan(5),
    );
  }

  for (const publisher of ["dc", "marvel"]) {
    await useComicExample(page, publisher);
    await selectExportField(page, "resolution", "1200");
    await selectField(page, "format", "image/png");
    const download = await downloadBoard(page);
    await download.saveAs(testInfo.outputPath(download.suggestedFilename()));
  }

  await setEditorViewport(page, { width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".cell-heading")
      .evaluateAll((headings) =>
        headings.every((heading) => heading.scrollWidth <= heading.clientWidth),
      ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("grid headings and font choices persist and export correctly", async ({
  page,
}) => {
  await page.goto("./");
  await useComicExample(page);
  await page.locator(".cell-heading").first().fill("My custom character");
  await reloadWorkspace(page);
  await expect(page.locator(".board-export-heading")).toHaveText("Team DC");
  expect((await savedWorkspace(page)).grid.publisher).toBe("dc");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "My custom character",
  );
  await editHeading(page, "Team Superheroes");
  await selectField(page, "heading-font", "Boogaloo");
  await selectField(page, "cell-font", "Bangers");
  await page
    .getByRole("group", { name: "Canvas heading style", exact: true })
    .getByRole("textbox", { name: "Background hex value", exact: true })
    .fill("#ed1d24");

  await expect(page.locator(".board-export-heading img")).toHaveCount(0);
  await expect(page.locator(".board-export-heading")).toHaveText(
    "Team Superheroes",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "font-family",
    "Bangers, sans-serif",
  );
  await reloadWorkspace(page);
  await expect(page.locator(".board-export-heading")).toHaveText(
    "Team Superheroes",
  );
  await expect(page.locator("#heading-font")).toHaveText("Boogaloo");
  await expect(page.locator("#cell-font")).toHaveText("Bangers");
  expect((await savedWorkspace(page)).grid.headingBackgroundColor).toBe(
    "#ed1d24",
  );
  await useComicExample(page, "marvel");
  await expect(page.locator(".board-export-heading")).toHaveText("Team Marvel");
  await editHeading(page, "");
  await expect(
    page.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("Add heading");
  await selectExportField(page, "resolution", "600");
  const download = await downloadBoard(page);
  const base64 = (await readFile(await download.path())).toString("base64");
  const height = await page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const image = await createImageBitmap(await response.blob());
    const height = image.height;
    image.close();
    return height;
  }, base64);
  expect(height).toBe(1780);
  await editHeading(page, "A".repeat(120));
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page
        .locator(".board-export-heading")
        .evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth &&
            element.scrollHeight <= element.clientHeight,
        ),
    )
    .toBe(true);
});

test("canvas heading can be disabled without losing text or style", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("./");
  await useComicExample(page);
  await openSidebarPanel(page, "Settings");
  await selectField(page, "heading-font", "Boogaloo");
  await page.locator("#heading-text-color-value").fill("#123456");
  await page.locator("#heading-text-color-value").press("Tab");
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 900 });
    await openSidebarPanel(page, "Settings");
    const section = page.getByRole("group", {
      name: "Canvas heading style",
      exact: true,
    });
    const toggle = section.getByRole("switch", {
      name: "Show heading",
      exact: true,
    });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(
      section.locator('input, button:not([role="switch"])'),
    ).toHaveCount(0);
    await expect(page.locator(".board-export-heading")).toHaveCount(0);
    const padding = await page.locator("#board-grid").evaluate((grid) => {
      const style = getComputedStyle(grid);
      return { top: style.paddingTop, bottom: style.paddingBottom };
    });
    expect(padding.top).toBe(padding.bottom);
    await section.screenshot({
      path: testInfo.outputPath(`heading-disabled-${width}.png`),
    });
    await reloadWorkspace(page);
    await openSidebarPanel(page, "Settings");
    await expect(toggle).not.toBeChecked();
    await expect(
      section.locator('input, button:not([role="switch"])'),
    ).toHaveCount(0);
    await expect(page.locator(".board-export-heading")).toHaveCount(0);
    const saved = (await savedWorkspace(page)).grid;
    expect(saved).toMatchObject({
      headingVisible: false,
      heading: "Team DC",
      headingFont: "Boogaloo",
      headingTextColor: "#123456",
    });
    await selectExportField(page, "resolution", "600");
    const download = await downloadBoard(page);
    const bytes = [...(await readFile(await download.path()))];
    const height = await page.evaluate(async (bytes) => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
      const height = image.height;
      image.close();
      return height;
    }, bytes);
    expect(height).toBe(1780);
    await openSidebarPanel(page, "Settings");
    await toggle.click();
    await expect(page.locator(".board-export-heading")).toHaveText("Team DC");
    await expect(page.locator("#heading-font")).toHaveText("Boogaloo");
    await expect(page.locator("#heading-text-color-value")).toHaveValue(
      "#123456",
    );
  }
});

test("editor heading edits and modal scrolling preserve content and restore focus", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setEditorViewport(page, { width: 1440, height: 760 });
  await page.goto("./");
  await useComicExample(page);
  const heading = page.getByRole("button", {
    name: /^Edit grid heading: /,
  });
  await heading.click();
  const headingInput = page.getByRole("textbox", {
    name: "Grid heading",
    exact: true,
  });
  await headingInput.fill("Edited heading");
  await headingInput.press("Escape");
  await expect(heading).toHaveText("Edited heading");
  await editHeading(page, "");
  await reloadWorkspace(page);
  await expect(heading).toHaveText("Add heading");
  await selectExportField(page, "resolution", "600");
  const download = await downloadBoard(page);
  const bytes = [...(await readFile(await download.path()))];
  const exportSize = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const size = { width: image.width, height: image.height };
    image.close();
    return size;
  }, bytes);
  expect(exportSize).toEqual({ width: 1380, height: 1780 });
  await editHeading(page, "Team DC");
  const actions = page.locator("#export-grid-header");
  await actions.focus();
  const before = await page.evaluate(() => ({
    scroll: window.scrollY,
  }));
  await actions.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
    )
    .toBe(true);

  const during = await page.evaluate(() => ({
    scroll: window.scrollY,
  }));
  expect(during).toEqual(before);
  await page.evaluate(() => {
    const content = document.createElement("div");
    content.style.height = "1200px";
    document.querySelector("[data-modal-scroll] > div > div").prepend(content);
  });
  const frame = page.locator("[data-modal-scroll]");
  await frame.evaluate((element) => element.scrollTo(0, 400));
  await expect
    .poll(() => frame.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(before.scroll);
  await page.screenshot({
    path: testInfo.outputPath("modal-scroll-desktop.png"),
  });
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(actions).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(before.scroll);
  await expect(heading).toHaveText("Team DC");
  await editHeading(page, "My image board");
  await reloadWorkspace(page);
  await expect(heading).toHaveText("My image board");
  await page.screenshot({
    path: testInfo.outputPath("controls-desktop.png"),
    fullPage: true,
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await actions.click();
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("controls-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(heading).toHaveText("My image board");
  expect(errors).toEqual([]);
});

touchTest("touch dialogs do not autofocus text inputs", async ({ page }) => {
  await page.goto("./");
  await page.locator("#export-grid-header").tap();
  await expect(
    page.getByRole("dialog", { name: "Export grid", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches(
        'input, textarea, [contenteditable="true"]',
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "INPUT",
  );
  await page.getByRole("tab", { name: "Settings", exact: true }).tap();
  await page
    .getByRole("button", { name: "Reset grid settings", exact: true })
    .tap();
  const reset = page.getByRole("dialog", {
    name: "Reset grid settings",
    exact: true,
  });
  await expect(reset).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches(
        'input, textarea, [contenteditable="true"]',
      ),
    ),
  ).toBe(false);
  await reset.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(reset).toHaveCount(0);
});

test("guest reset restores settings without deleting images or removed placements", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await (
    await beginCellUpload(page, 15)
  ).setInputFiles({
    name: "local.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator(".cell-heading").nth(15).fill("Keep my custom caption");
  await editHeading(page, "Custom banner");
  await selectField(page, "heading-font", "Bangers");
  await page.locator("#gap").fill("25");
  await selectExportField(page, "format", "image/webp");
  await selectField(page, "resolution", "300");
  await page.locator("#quality").fill("40");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await reloadWorkspace(page);
  await expect(page.locator(".board-export-heading")).toHaveText(
    "Custom banner",
  );
  const original = await savedWorkspace(page);
  expect(original.exportSettings).toMatchObject({
    format: "image/webp",
    resolution: 300,
    quality: 70,
  });
  await page
    .getByRole("button", { name: "Reset grid settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Reset grid settings",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Reset settings", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(
    page.getByRole("button", { name: /^Edit grid heading: / }),
  ).toHaveText("Add heading");
  await expect(page.locator("#heading-font")).toHaveText("Manrope");
  await expect(page.locator("#gap")).toHaveValue("50");
  await expect(page.locator(".asset")).toHaveCount(1);
  const reset = await savedWorkspace(page);
  expect(reset.exportSettings).toEqual({
    format: "image/png",
    resolution: 300,
    quality: 95,
  });
  expect(reset.assets).toEqual(original.assets);
  expect(reset.grid).toMatchObject({
    name: "Grid",
    publisher: "none",
    heading: "",
    headingFont: "Manrope",
    cellFont: "Manrope",
    rows: 3,
    columns: 3,
    gap: 60,
    background: "#17191b",
  });
  expect(
    reset.grid.overflow.some(
      (entry) => entry.cell.title === "Keep my custom caption",
    ),
  ).toBe(true);
  await reloadWorkspace(page);
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".cell-heading").nth(15)).toHaveValue(
    "Keep my custom caption",
  );
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("reset-grid-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("long title overlays reach the bottom and titles can be hidden without losing text", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await uploadCellImage(page);
  const title =
    "719aa1d1e36fc0028a6b11d2317a4547 monster killer bre espresso and cream coffee can 355ml";
  await page.locator(".cell-heading").first().fill(title);
  await openSidebarPanel(page, "Images");
  await page.locator(".library-heading").fill(title);
  await selectField(page, "caption-position", "overlay-bottom");
  const canvasPreview = page
    .locator(".grid-cell [data-caption-preview]")
    .first();
  await expect(canvasPreview).toBeVisible();

  await expect(canvasPreview).toHaveText(title);
  await page.locator(".cell-heading").first().click();
  await expect(canvasPreview).toBeHidden();
  await expect(page.locator(".cell-heading").first()).toHaveValue(title);
  const canvasField = page.locator(".cell-heading").first();

  await canvasField.press("Control+End");
  await expect
    .poll(() => canvasField.evaluate((field) => field.scrollTop))
    .toBeGreaterThan(0);
  await page.locator(".cell-image-button").nth(1).press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  for (const width of [800, 390]) {
    await setEditorViewport(page, { width, height: 900 });
    await expect
      .poll(() =>
        picker.locator("[data-library-caption-preview]").evaluate((preview) => {
          const caption = preview.getBoundingClientRect();
          const content = preview.parentElement.getBoundingClientRect();
          const text = preview.querySelector("span");
          const style = getComputedStyle(text);
          return (
            style.webkitLineClamp === "3" &&
            text.getBoundingClientRect().height <=
              parseFloat(style.lineHeight) * 3 + 0.1 &&
            text.scrollHeight > text.clientHeight &&
            Math.abs(content.bottom - caption.bottom) < 0.1
          );
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`long-title-overlay-${width}.png`),
    });
    const field = picker.locator(".library-heading");
    const preview = picker.locator("[data-library-caption-preview]");
    await expect(preview).toBeVisible();

    const fieldBounds = await field.boundingBox();
    const textWidth = await field.evaluate((element) => element.clientWidth);
    await field.click();
    await expect(preview).toBeHidden();
    await expect(field).toHaveValue(title);

    expect(await field.boundingBox()).toEqual(fieldBounds);
    expect(await field.evaluate((element) => element.clientWidth)).toBe(
      textWidth,
    );

    const scrollbar = picker.locator("[data-caption-scrollbar]");
    await expect(scrollbar).toBeVisible();
    const scrollbarBounds = await scrollbar.boundingBox();
    expect(scrollbarBounds.x).toBeGreaterThanOrEqual(
      fieldBounds.x + fieldBounds.width,
    );
    await field.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect
      .poll(() => field.evaluate((element) => element.scrollTop))
      .toBe(0);
    await page.mouse.move(
      scrollbarBounds.x + scrollbarBounds.width / 2,
      scrollbarBounds.y + 3,
    );
    await page.mouse.down();
    await page.mouse.move(
      scrollbarBounds.x + scrollbarBounds.width / 2,
      scrollbarBounds.y + scrollbarBounds.height - 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(field).toBeFocused();
    await expect
      .poll(() => field.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await field.press("Control+End");
    await expect
      .poll(() => field.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await picker
      .getByRole("heading", { name: "Choose image", exact: true })
      .click();
    await expect(preview).toBeVisible();

    await expect(scrollbar).toHaveCount(0);
  }
  await picker
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await selectField(page, "caption-position", "below");
  await openSidebarPanel(page, "Settings");
  const toggle = page.getByRole("switch", { name: "Show titles", exact: true });
  await expect(toggle).toBeChecked();
  const titleColor = page.getByRole("textbox", {
    name: "Overlay color hex value",
    exact: true,
  });
  const titleOpacity = page.getByRole("slider", { name: /^Overlay opacity/ });
  const cardSettings = page.getByRole("group", {
    name: "Card style",
    exact: true,
  });
  const cardControls = cardSettings.locator(
    'input, button:not([role="switch"]):not([role="radio"]), [role="radiogroup"]:not(#image-shape)',
  );
  await expect(titleColor).toBeVisible();
  await expect(titleOpacity).toBeVisible();
  await titleColor.fill("#123456");
  await titleOpacity.fill("37");
  await toggle.click();
  await expect(toggle).toBeVisible();
  await expect(
    cardSettings.getByRole("radiogroup", { name: "Shape", exact: true }),
  ).toBeVisible();
  await expect(cardControls).toHaveCount(0);
  await expect(titleColor).toHaveCount(0);
  await expect(titleOpacity).toHaveCount(0);
  for (const width of [1440, 390]) {
    await setEditorViewport(page, { width, height: 1080 });
    await openSidebarPanel(page, "Settings");
    await cardSettings.scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "Reset grid settings", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`titles-disabled-spacing-${width}.png`),
    });
  }
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await expect(page.locator(".cell-heading").first()).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator(".grid-cell")
        .first()
        .evaluate((card) => {
          const content = card
            .querySelector("[data-card-content]")
            .getBoundingClientRect();
          const image = card
            .querySelector("[data-card-image]")
            .getBoundingClientRect();
          return Math.abs(content.height - image.height);
        }),
    )
    .toBeLessThan(0.1);
  await reloadWorkspace(page);
  await openSidebarPanel(page, "Settings");
  await expect(toggle).not.toBeChecked();
  await expect(cardControls).toHaveCount(0);
  await expect(titleColor).toHaveCount(0);
  await expect(titleOpacity).toHaveCount(0);
  await expect(page.locator(".cell-heading").first()).toBeHidden();
  await expect(page.locator(".cell-heading").first()).toHaveValue(title);
  await page.evaluate(() => {
    window.titleDrawing = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      ...parameters
    ) {
      window.titleDrawing.push(text);
      return original.call(this, text, ...parameters);
    };
  });
  await downloadBoard(page);
  expect(await page.evaluate(() => window.titleDrawing)).toEqual([]);
  await toggle.click();
  await expect(cardSettings.locator("#cell-font-size")).toHaveValue("20");
  await expect(titleColor).toHaveValue("#123456");
  await expect(titleOpacity).toHaveValue("37");
  await expect(page.locator(".cell-heading").first()).toBeVisible();
  await expect(page.locator(".cell-heading").first()).toHaveValue(title);
  await openSidebarPanel(page, "Images");
  await expect(page.locator(".library-heading")).toBeVisible();
  await expect(page.locator(".library-heading")).toHaveValue(title);
  await page.evaluate(() => {
    window.titleDrawing = [];
  });
  await downloadBoard(page);
  const exportedTitle = await page.evaluate(() => window.titleDrawing);
  expect(exportedTitle).toHaveLength(3);
  expect(exportedTitle.at(-1)).toMatch(/\u2026$/);
});

test("long imported filenames produce valid captions across reload", async ({
  page,
}) => {
  await page.goto("./");
  await selectField(page, "caption-position", "above");
  const title = "A".repeat(150);
  await page.locator("#replace-upload").setInputFiles({
    name: `${title}.svg`,
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator(".cell-image-button").first().press("Enter");
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button", { name: `Use ${title}`, exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    title.slice(0, 120),
  );
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    title.slice(0, 120),
  );
  expect((await savedWorkspace(page)).assets[0].title).toBe(title);
});

test("failed guest saves roll back blobs and recover without blocking export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.failGuestSaves = true;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-settings-v1" && window.failGuestSaves)
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("./");
  await expect(page.locator("#save-status")).toHaveText("Save failed");
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Local save failed",
  );
  await expect(page.locator("#save-status")).toBeHidden();
  await page.locator("#replace-upload").setInputFiles({
    name: "retry.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "retry");
  await selectExportField(page, "resolution", "150");
  expect((await downloadBoard(page)).suggestedFilename()).toBe("grid.png");
  await expect(page.locator("#save-status")).toHaveText("Save failed");
  const failed = await localDatabase(page);
  expect(failed.document).toBeUndefined();
  expect(failed.images).toEqual([]);
  expect(
    await page.evaluate(() => localStorage.getItem("grids-settings-v1")),
  ).toBeNull();
  await page.evaluate(() => {
    window.failGuestSaves = false;
  });
  await page.locator(".cell-heading").first().fill("Recovered save");
  expect((await savedWorkspace(page)).assets).toHaveLength(1);
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Recovered save",
  );
});

test("unavailable IndexedDB leaves session editing and image exports usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException("Local database unavailable", "InvalidStateError");
    };
  });
  await page.goto("./");
  await expect(page.locator("#save-status")).toHaveText("Session only");
  await expect(page.locator("#save-status")).toBeHidden();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Editing and exports remain available for this session.",
  );
  await page.locator("#replace-upload").setInputFiles({
    name: "session.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await chooseImage(page, "session");
  await selectExportField(page, "resolution", "150");
  expect((await downloadBoard(page)).suggestedFilename()).toBe("grid.png");
  await expect(page.locator("#save-status")).toHaveText("Session only");
});

test("fresh storage ignores obsolete prototypes and rejects invalid documents", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "gridroom-v1",
      JSON.stringify({
        boards: [{ name: "Old prototype" }],
        active: 0,
        assets: [],
      }),
    ),
  );
  await page.goto("./");
  expect((await savedWorkspace(page)).grid.name).toBe("Grid");
  for (const corruption of [
    "version",
    "cells",
    "references",
    "coordinates",
    "json",
  ]) {
    const saved = await savedWorkspace(page);
    if (corruption === "version") saved.version = 99;
    if (corruption === "cells") saved.grid.cells[1].id = saved.grid.cells[0].id;
    if (corruption === "references")
      saved.grid.cells[0].assetId = crypto.randomUUID();
    if (corruption === "coordinates") saved.grid.rows = 13;
    if (corruption === "json") {
      await localDatabase(page, "delete");
      await page.evaluate(() =>
        localStorage.setItem("grids-settings-v1", "{broken"),
      );
    } else await localDatabase(page, "write", saved);
    await reloadWorkspace(page);
    await expect(page.locator(".grid-cell")).toHaveCount(9);
    expect((await savedWorkspace(page)).grid.name).toBe("Grid");
  }
});

test("edge resizing preserves coordinates, overflow and newer edits", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  const savedCells = async () => (await savedWorkspace(page)).grid.cells;
  const original = await savedCells();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(6);
  expect((await savedCells())[3].id).toBe(original[2].id);
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.locator(".cell-heading").nth(3).fill("Edit after resizing");
  await expect(page.getByRole("button", { name: /Undo/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(6);
  await expect(page.locator(".cell-heading").nth(3)).toHaveValue(
    "Edit after resizing",
  );
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove column", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Removed cells", exact: true }),
  ).toHaveCount(0);
  await reloadWorkspace(page);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  const restored = await savedCells();
  expect(restored.map((cell) => cell.id)).toEqual(
    original.map((cell) => cell.id),
  );
  expect(restored[2].title).toBe("Edit after resizing");
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove row", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page
    .locator(".cell-image-button")
    .nth(2)
    .dragTo(page.locator(".cell-image-button").first());
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Edit after resizing",
  );
  await expect(page.locator(".cell-heading").nth(2)).toHaveValue(
    original[0].title,
  );
  await page.screenshot({
    path: testInfo.outputPath("edge-controls-desktop.png"),
    fullPage: true,
  });
  await setEditorViewport(page, { width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("edge-controls-mobile.png"),
    fullPage: true,
  });
  const geometry = await page.evaluate(() => {
    const grid = document
      .querySelector("[data-canvas-viewport]")
      .getBoundingClientRect();
    const header = document
      .querySelector("[data-canvas-header]")
      .getBoundingClientRect();
    const columns = document
      .querySelector('[aria-label="Column controls"]')
      .getBoundingClientRect();
    const rows = document
      .querySelector('[aria-label="Row controls"]')
      .getBoundingClientRect();
    return {
      columnsInHeader:
        columns.left >= header.left &&
        columns.right <= header.right &&
        columns.top >= header.top &&
        columns.bottom <= header.bottom,
      rowsInHeader:
        rows.left >= header.left &&
        rows.right <= header.right &&
        rows.top >= header.top &&
        rows.bottom <= header.bottom,
      aboveGrid: columns.bottom <= grid.top && rows.bottom <= grid.top,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(geometry).toEqual({
    columnsInHeader: true,
    rowsInHeader: true,
    aboveGrid: true,
    overflow: false,
  });
});

test("uploads follow stable cells through resize and large exports are bounded", async ({
  page,
}) => {
  await page.goto("./");
  await useComicExample(page);
  await page.evaluate(() => {
    window.pendingImageDecodes = [];
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      const decoded = original.call(this);
      return this.src.startsWith("blob:")
        ? decoded.then(
            () =>
              new Promise((resolve) =>
                window.pendingImageDecodes.push(resolve),
              ),
          )
        : decoded;
    };
  });
  await (
    await beginCellUpload(page, 2)
  ).setInputFiles(
    path.join(projectRoot, "tests/fixtures/assets/DC - Kite Man.jpg"),
  );
  await expect
    .poll(() => page.evaluate(() => window.pendingImageDecodes.length))
    .toBe(1);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page.evaluate(() =>
    window.pendingImageDecodes.splice(0).forEach((resolve) => resolve()),
  );
  await expect(page.locator(".cell-heading").nth(3)).toHaveValue("DC Kite Man");
  await expect(page.locator(".cell-heading").nth(2)).toHaveValue("");
  await (
    await beginCellUpload(page, 2)
  ).setInputFiles(
    path.join(projectRoot, "tests/fixtures/assets/Marvel - Eye-Boy.jpg"),
  );
  await expect
    .poll(() => page.evaluate(() => window.pendingImageDecodes.length))
    .toBe(1);
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  await page.evaluate(() =>
    window.pendingImageDecodes.splice(0).forEach((resolve) => resolve()),
  );
  await expect(page.locator(".asset")).toHaveCount(10);
  expect(
    await page
      .locator(".cell-heading")
      .evaluateAll((cells) => cells.some((cell) => cell.value.includes("Eye"))),
  ).toBe(false);
  const saved = await savedWorkspace(page);
  const board = saved.grid;
  board.rows = 12;
  board.columns = 12;
  board.heading = "";
  board.gap = 12;
  board.canvasPadding = 12;
  board.overflow = [];
  board.cells = Array.from({ length: 144 }, () => ({
    id: crypto.randomUUID(),
    assetId: null,
    title: "",
    fit: "contain",
  }));
  await localDatabase(page, "write", saved);
  await reloadWorkspace(page);
  await expect(
    page.getByRole("button", { name: "Add row", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add column", exact: true }),
  ).toBeDisabled();
  await selectExportField(page, "resolution", "600");
  await page
    .getByRole("button", { name: "Download image", exact: true })
    .click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Export exceeds the 32 MP limit",
  );
  await selectExportField(page, "resolution", "150");
  const download = await downloadBoard(page);
  const bytes = [...(await readFile(await download.path()))];
  const size = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  }, bytes);
  expect(size).toEqual({ width: 1839, height: 2439 });
});

test("PWA updates activate without reloading an unsaved or focused caption", async ({
  page,
}, testInfo) => {
  const dist = path.join(projectRoot, "dist");
  const directory = testInfo.outputPath("pwa-worker");
  await mkdir(directory, { recursive: true });
  const { manifestEntries } = await getManifest({
    globDirectory: dist,
    globPatterns: ["**/*.{html,js,css,woff2,png,svg}"],
    globIgnores: ["sw.js", "workbox-*.js"],
    dontCacheBustURLsMatching: /-[A-Za-z0-9_-]{8}\.(?:js|css)$/,
  });
  let worker;
  const deploy = async (version) => {
    await generateSW({
      swDest: path.join(directory, "sw.js"),
      globDirectory: directory,
      globPatterns: [],
      additionalManifestEntries: manifestEntries.map((entry) =>
        entry.url === "index.html"
          ? { ...entry, revision: `release-${version}` }
          : entry,
      ),
      skipWaiting: true,
      clientsClaim: true,
      navigateFallback: "index.html",
    });
    worker = Buffer.concat([
      await readFile(path.join(directory, "sw.js")),
      Buffer.from(
        `\nself.addEventListener("message", event => { if (event.data === "release") event.ports[0].postMessage(${version}); });`,
      ),
    ]);
  };
  await deploy(1);
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (!pathname.startsWith("/grids/")) {
        response.writeHead(404).end();
        return;
      }
      const filename =
        decodeURIComponent(pathname.slice("/grids/".length)) || "index.html";
      const content =
        filename === "sw.js"
          ? worker
          : await readFile(
              path.join(
                filename.startsWith("workbox-") ? directory : dist,
                filename,
              ),
            );
      const extension = path.extname(filename);
      const contentType =
        {
          ".js": "application/javascript",
          ".html": "text/html",
          ".css": "text/css",
          ".woff2": "font/woff2",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".webmanifest": "application/manifest+json",
        }[extension] ?? "application/octet-stream";
      response
        .writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "max-age=31536000",
        })
        .end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  try {
    await page.addInitScript(() =>
      localStorage.setItem(
        "test-boots",
        String(Number(localStorage.getItem("test-boots") ?? 0) + 1),
      ),
    );
    await page.goto(`http://localhost:${server.address().port}/grids/`);
    await expect(page.locator("#save-status")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.ready).updateViaCache,
      ),
    ).toBe("none");
    const release = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
              channel.port1.close();
              resolve(event.data);
            };
            navigator.serviceWorker.controller.postMessage("release", [
              channel.port2,
            ]);
          }),
      );
    expect(await release()).toBe(1);
    await uploadCellImage(page);
    await savedWorkspace(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const caption = page.locator(".cell-heading").first();
    await caption.fill("Keep this edit through update");
    await expect(page.locator("#save-status")).toHaveAttribute(
      "data-save-state",
      "saving",
    );
    await deploy(2);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(release).toBe(2);
    expect(await page.evaluate(() => localStorage.getItem("test-boots"))).toBe(
      "1",
    );
    await expect(caption).toBeFocused();
    await caption.blur();
    expect(await page.evaluate(() => localStorage.getItem("test-boots"))).toBe(
      "1",
    );
    await expect(page.locator("#save-status")).toHaveAttribute(
      "data-save-state",
      "saving",
    );
    const reloaded = page.waitForEvent("load");
    await page.clock.resume();
    await reloaded;
    expect(await page.evaluate(() => localStorage.getItem("test-boots"))).toBe(
      "2",
    );
    await expect(page.locator(".cell-heading").first()).toHaveValue(
      "Keep this edit through update",
    );
    expect(await release()).toBe(2);
    expect((await savedWorkspace(page)).grid.cells[0].title).toBe(
      "Keep this edit through update",
    );
  } finally {
    await page.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

touchTest(
  "phone app manifest and offline launch preserve images, edits and export",
  async ({ page, context }, testInfo) => {
    await page.goto("./");
    await expect(page.locator(".grid-cell")).toHaveCount(9);
    const emptyImage = page.getByRole("button", {
      name: "Add image to cell 1",
      exact: true,
    });
    await expect(emptyImage).toBeVisible();
    await expect(emptyImage.getByText("Drop here")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    const manifestUrl = await page
      .locator('link[rel="manifest"]')
      .evaluate((element) => element.href);
    const appUrl = new URL("./", page.url()).href;
    expect(manifestUrl).toBe(`${appUrl}manifest.webmanifest`);
    const response = await page.request.get(manifestUrl);
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      name: "Gridz",
      short_name: "Gridz",
      display: "standalone",
    });
    for (const key of ["id", "start_url", "scope"])
      expect(new URL(manifest[key], manifestUrl).href).toBe(appUrl);
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual([
      "192x192",
      "512x512",
    ]);
    for (const icon of manifest.icons) {
      const dimensions = await page.evaluate(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Missing install icon: ${url}`);
        const bitmap = await createImageBitmap(await response.blob());
        const dimensions = `${bitmap.width}x${bitmap.height}`;
        bitmap.close();
        return dimensions;
      }, new URL(icon.src, manifestUrl).href);
      expect(dimensions).toBe(icon.sizes);
    }
    await expect(
      page.locator('meta[name="apple-mobile-web-app-capable"]'),
    ).toHaveAttribute("content", "yes");
    const registration = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return {
        scope: registration.scope,
        script: registration.active.scriptURL,
      };
    });
    expect(registration).toEqual({ scope: appUrl, script: `${appUrl}sw.js` });
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    const session = await context.newCDPSession(page);
    const installability = await session.send("Page.getInstallabilityErrors");
    expect(installability.installabilityErrors).toEqual([]);
    await session.detach();
    const input = await beginCellUpload(page, 0);
    await input.setInputFiles({
      name: "Offline image.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    });
    await expect(
      page.getByRole("dialog", { name: "Choose image", exact: true }),
    ).toHaveCount(0);
    const card = page.locator(".grid-cell").first();
    await expect(card.locator("img")).toBeVisible();
    await editHeading(page, "Offline board");
    await card.locator(".cell-heading").fill("Local caption");
    await expect
      .poll(async () => (await savedWorkspace(page)).grid.cells[0].title)
      .toBe("Local caption");
    const original = await localDatabase(page);
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Edit grid heading: Offline board",
        exact: true,
      }),
    ).toBeVisible();
    await expect(card.locator(".cell-heading")).toHaveValue("Local caption");
    await expect
      .poll(() =>
        card
          .locator("img")
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await card.locator(".cell-heading").fill("Offline edit");
    await expect
      .poll(async () => (await savedWorkspace(page)).grid.cells[0].title)
      .toBe("Offline edit");
    expect((await localDatabase(page)).images).toEqual(original.images);
    await selectExportField(page, "resolution", "150");
    const download = await downloadBoard(page);
    const bytes = await readFile(await download.path());
    expect([...bytes.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    await page.screenshot({ path: testInfo.outputPath("phone-offline.png") });
  },
);

test("page metadata assets resolve and desktop library keeps mouse dragging", async ({
  page,
}, testInfo) => {
  await setEditorViewport(page, { width: 1440, height: 1080 });
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    Array.from({ length: 2 }, (_, index) => ({
      name: `Image ${index}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(2);

  await expect(
    page.getByRole("button", { name: "Move Image 0", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("[data-library-thumbnail]").first(),
  ).toHaveAttribute("draggable", "true");
  await openSidebarPanel(page, "Images");
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await openSidebarPanel(page, "Settings");
  await expect(
    page.locator(".grid-cell").first().locator("img"),
  ).toHaveAttribute("alt", "Image 0");
  await expect(page).toHaveTitle("Gridz - Image Boards");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Create image grids/,
  );
  for (const [selector, content] of [
    ['meta[name="apple-mobile-web-app-title"]', "Gridz"],
    ['meta[property="og:site_name"]', "Gridz"],
    ['meta[property="og:title"]', "Gridz - Image Boards"],
    ['meta[name="twitter:title"]', "Gridz - Image Boards"],
    [
      'meta[property="og:image:alt"]',
      "Gridz: four lime tiles on a dark background",
    ],
    [
      'meta[name="twitter:image:alt"]',
      "Gridz: four lime tiles on a dark background",
    ],
  ]) {
    await expect(page.locator(selector)).toHaveAttribute("content", content);
  }
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://gridz.pages.dev/",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://gridz.pages.dev/assets/grids-icon.png",
  );
  for (const relation of ["icon", "apple-touch-icon"]) {
    const url = await page
      .locator(`link[rel="${relation}"]`)
      .evaluate((element) => element.href);
    expect(new URL(url).pathname).toMatch(
      /^\/grids\/assets\/grids-icon\.(svg|png)$/,
    );
    const response = await page.request.get(url);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/image\/(svg\+xml|png)/);
  }
  await page.screenshot({ path: testInfo.outputPath("library-desktop.png") });
});

test("image picker keeps uploads reachable and separates deletion from placement", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    Array.from({ length: 8 }, (_, index) => ({
      name: `Grid ${index}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(page.locator(".asset")).toHaveCount(8);
  await page.locator(".cell-image-button").first().click();
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  const panel = picker.locator('[id^="headlessui-dialog-panel"]');
  await expect(picker.locator("#picker-image-source")).toHaveText("My images");
  await picker.locator("#picker-image-source").click();
  await expect(
    page.getByRole("option", { name: "Wikimedia Commons", exact: true }),
  ).toBeEnabled();
  await page.getByRole("listbox").press("Escape");
  await expect(picker.getByRole("tab", { name: /Choose|Library/ })).toHaveCount(
    0,
  );
  await expect(
    picker.getByRole("button", { name: "Delete items", exact: true }),
  ).toHaveCount(0);
  await expect(
    picker.getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
  for (const thumbnail of await picker
    .locator("[data-library-thumbnail]")
    .all()) {
    await expect(thumbnail).toHaveAttribute("draggable", "false");
  }
  for (const width of [320, 390, 780, 832, 1440]) {
    await setEditorViewport(page, { width, height: 1080 });
    await expect(panel).toBeInViewport();
    expect(
      await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          element.scrollWidth <= element.clientWidth
        );
      }),
    ).toBe(true);
    await expect(picker.locator("[data-library-image]")).toHaveCount(8);
    const lastImage = picker.getByRole("button", {
      name: "Use Grid 7",
      exact: true,
    });
    await lastImage.scrollIntoViewIfNeeded();
    await expect(lastImage).toBeInViewport();
  }
  await picker.getByRole("button", { name: "Use Grid 7", exact: true }).hover();
  await picker
    .getByRole("button", { name: "Delete Grid 7", exact: true })
    .click();
  await expect(picker.locator("[data-library-image]")).toHaveCount(7);
  await expect(page.locator(".grid-cell").first().locator("img")).toHaveCount(
    0,
  );
  await picker.getByRole("button", { name: "Use Grid 0", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(
    page.locator(".grid-cell").first().locator("img"),
  ).toHaveAttribute("alt", "Grid 0");
});

touchTest(
  "mobile picker has clear all images without deletion mode and preserves canvas images",
  async ({ page }, testInfo) => {
    await page.goto("./");
    const openPicker = async () => {
      await page
        .locator(".cell-image-button")
        .first()
        .tap({ position: { x: 5, y: 5 } });
      if (await page.locator(".grid-cell").first().locator("img").count())
        await page
          .getByRole("button", { name: "Replace image", exact: true })
          .tap();
      await expect(
        page.getByRole("dialog", { name: "Choose image", exact: true }),
      ).toBeVisible();
    };
    await openPicker();
    const picker = page.getByRole("dialog", {
      name: "Choose image",
      exact: true,
    });
    const chooserReady = page.waitForEvent("filechooser");
    await picker.getByRole("button", { name: "Add images", exact: true }).tap();
    await (
      await chooserReady
    ).setFiles(
      Array.from({ length: 3 }, (_, index) => ({
        name: `Picker ${index}.svg`,
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
        ),
      })),
    );
    await expect(picker.getByRole("img")).toHaveCount(3);
    await expect(page.locator(".grid-cell img")).toHaveCount(0);
    await picker
      .getByRole("button", { name: "Use Picker 0", exact: true })
      .tap();
    await expect(picker).toHaveCount(0);
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toHaveAttribute("alt", "Picker 0");
    await expect(page.locator(".grid-cell img")).toHaveCount(1);
    await openPicker();
    await expect(picker.getByRole("img")).toHaveCount(3);
    await expect(
      picker.getByRole("tab", { name: "Library", exact: true }),
    ).toHaveCount(0);
    for (const thumbnail of await picker
      .locator("[data-library-thumbnail]")
      .all()) {
      await expect(thumbnail).toHaveAttribute("draggable", "false");
    }
    await expect(
      picker.getByRole("button", { name: "Delete items", exact: true }),
    ).toHaveCount(0);
    await expect(picker.getByRole("checkbox")).toHaveCount(0);
    await picker
      .getByRole("button", { name: "Use Picker 2", exact: true })
      .tap({ position: { x: 5, y: 5 } });
    await expect(picker).toHaveCount(0);
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toHaveAttribute("alt", "Picker 2");
    await openPicker();
    const remove = picker.getByRole("button", {
      name: "Clear all images",
      exact: true,
    });
    const target = await remove.boundingBox();
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: testInfo.outputPath("picker-clear-all-mobile.png"),
    });
    await remove.tap();
    await expect(
      page.getByRole("dialog", { name: "Delete images", exact: true }),
    ).toHaveCount(0);
    await expect(picker.getByRole("img")).toHaveCount(0);
    await expect(picker.getByText("No images yet.")).toHaveCount(0);
    await expect(picker.locator("[data-upload-tile]")).toBeVisible();
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toHaveAttribute("alt", "Picker 2");
    await picker
      .getByRole("button", { name: "Close dialog", exact: true })
      .tap();
    await expect(picker).toHaveCount(0);
    await reloadWorkspace(page);
    await expect(
      page.locator(".grid-cell").first().locator("img"),
    ).toHaveAttribute("alt", "Picker 2");
  },
);

test("library cards support mouse and touch copying on touch-capable desktops", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["Library A", "Library B"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  const images = page.locator("#asset-library [data-library-thumbnail]");
  const cells = page.locator(".grid-cell");
  await expect(images).toHaveCount(2);
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);
  await expect(images.first()).toHaveAttribute("draggable", "true");
  await images.first().dragTo(cells.nth(0).locator(".cell-image-button"));
  await expect(cells.nth(0).locator("img")).toHaveAttribute("alt", "Library A");
  await expect(images).toHaveCount(2);
  const session = await context.newCDPSession(page);
  const touchCopy = async (targetIndex, cancel = false) => {
    await images.nth(1).tap();
    const handle = page
      .locator("#asset-library .asset")
      .nth(1)
      .getByRole("button", { name: "Drag image", exact: true });
    await expect(handle).toBeVisible();
    const source = await handle.boundingBox();
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const target = await cells
      .nth(targetIndex)
      .locator(".cell-image-button")
      .boundingBox();
    const end = { x: target.x + 10, y: target.y + 10 };
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 8; step++)
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 8,
            y: start.y + ((end.y - start.y) * step) / 8,
            id: 1,
          },
        ],
      });
    await expect(page.locator("[data-drag-floating]")).toBeVisible();

    await session.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await expect(page.locator("[data-drag-floating]")).toHaveCount(0);
  };
  await touchCopy(1);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Library B");
  await expect(images).toHaveCount(2);
  await touchCopy(2, true);
  await expect(cells.nth(2).locator("img")).toHaveCount(0);
  await images.nth(1).tap({ position: { x: 5, y: 5 } });
  await expect(
    page.getByRole("button", { name: "Delete Library B", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("touch-library-card.png"),
  });
  await session.detach();
  await context.close();
});

test("touch cards toggle tools and drag moves swaps and cancels without opening picker", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 780, height: 1080 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  const cells = page.locator(".grid-cell");
  const imageButton = (index) => cells.nth(index).locator(".cell-image-button");
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await imageButton(1).tap();
  await picker.locator("#picker-cell-upload").setInputFiles(
    ["Touch A", "Touch B"].map((name, index) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${index ? "#f26365" : "#40b4aa"}"/></svg>`,
      ),
    })),
  );
  await expect(picker).toBeVisible();
  await expect(cells.locator("img")).toHaveCount(0);
  await picker.getByRole("button", { name: "Use Touch B", exact: true }).tap();
  await expect(picker).toHaveCount(0);
  await expect(cells.nth(0).locator("img")).toHaveCount(0);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch B");
  await imageButton(0).tap();
  await picker.getByRole("button", { name: "Use Touch A", exact: true }).tap();
  await expect(picker).toHaveCount(0);
  await expect(cells.nth(0).locator("img")).toHaveAttribute("alt", "Touch A");
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch B");
  const tools = cells
    .nth(0)
    .getByRole("group", { name: "Cell tools", exact: true });
  const session = await context.newCDPSession(page);
  await imageButton(0).tap();
  await expect(tools).toBeVisible();
  await expect(picker).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input, textarea"),
    ),
  ).toBe(false);
  await imageButton(0).tap();
  await expect(tools).toHaveCount(0);
  await imageButton(0).tap();
  await tools.getByRole("button", { name: "Replace image", exact: true }).tap();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Use Touch A", exact: true }).tap();
  await expect(picker).toHaveCount(0);
  const drag = async (sourceIndex, targetIndex, cancel = false) => {
    const handle = cells
      .nth(sourceIndex)
      .getByRole("button", { name: "Drag image", exact: true });
    if (!(await handle.isVisible())) await imageButton(sourceIndex).tap();
    await expect(handle).toBeVisible();

    const source = await handle.boundingBox();
    const target = await imageButton(targetIndex).boundingBox();
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const end = { x: target.x + 10, y: target.y + 10 };
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 8,
            y: start.y + ((end.y - start.y) * step) / 8,
            id: 1,
          },
        ],
      });
    }
    await expect(page.locator("[data-drag-floating]")).toBeVisible();

    await session.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await expect(page.locator("[data-drag-floating]")).toHaveCount(0);
    await expect(page.locator(".grid-cell.drag-over")).toHaveCount(0);
    await expect(picker).toHaveCount(0);
    await expect(
      page.getByRole("group", { name: "Cell tools", exact: true }),
    ).toHaveCount(0);
  };
  await imageButton(0).tap();
  await drag(0, 2);
  await expect(cells.nth(0).locator("img")).toHaveCount(0);
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Touch A");
  await drag(2, 1);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch A");
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Touch B");
  await drag(1, 0, true);
  await expect(cells.nth(0).locator("img")).toHaveCount(0);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch A");
  await imageButton(1).tap();
  await expect(
    cells.nth(1).getByRole("group", { name: "Cell tools", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("touch-card-tools.png") });
  await reloadWorkspace(page);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch A");
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Touch B");
  await setEditorViewport(page, { width: 780, height: 540 });

  await expect(
    cells.getByRole("button", { name: "Drag image", exact: true }),
  ).toHaveCount(0);
  const originalGrid = (await savedWorkspace(page)).grid;
  const body = await imageButton(1).boundingBox();
  const start = {
    x: body.x + body.width / 2,
    y: body.y + Math.min(body.height - 12, 140),
  };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, id: 1 }],
  });
  for (let step = 1; step <= 8; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: start.x, y: start.y - (120 * step) / 8, id: 1 }],
    });
    await expect(page.locator("[data-drag-floating]")).toHaveCount(0);
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      page
        .locator("[data-workspace-scroll]")
        .evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  expect((await savedWorkspace(page)).grid).toEqual(originalGrid);
  await session.detach();
  await context.close();
});
