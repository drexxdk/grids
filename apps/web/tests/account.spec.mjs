import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const image = new URL("./fixtures/assets/DC - Kite Man.jpg", import.meta.url);
const touchTest = test.extend({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
async function mockAccount(page, { signedIn = true } = {}) {
  let user = signedIn ? { id: randomUUID(), name: "Test user", provider: "google" } : null;
  const grids = new Map();
  const presets = new Map();
  const writes = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/");
    const resource = parts[2];
    const id = parts[3];
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (resource === "session") return json({ user, providers: ["google", "facebook", "discord"] });
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
  return { writes, grids, presets };
}
async function openAccount(page) {
  await page.getByRole("button", { name: "Account and saved grids", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account and saved grids" });
  await expect(dialog.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  return dialog;
}

async function expectRedAction(button) {
  await expect(button.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  const [red, green, blue] = await button.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  });
  expect(red).toBeGreaterThan(green + 30);
  expect(red).toBeGreaterThan(blue + 20);
}

test("account provider links use accessible packaged brand icons", async ({ page }) => {
  await mockAccount(page, { signedIn: false });
  await page.goto("./?source=imported");
  const dialog = await openAccount(page);
  for (const provider of ["Google", "Facebook", "Discord"]) {
    const link = dialog.getByRole("link", { name: `Continue with ${provider}`, exact: true });
    await expect(link).toBeVisible();
    await expect(link.locator('svg[aria-hidden="true"]')).toHaveCount(1);
    await expect(link).toHaveAttribute("href", new RegExp(`/api/auth/${provider.toLowerCase()}/start$`));
    const size = await link.boundingBox();
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
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
    const identity = await dialog.getByText("Test user", { exact: true }).evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      font: Number.parseFloat(getComputedStyle(element).fontSize),
    }));
    expect(identity.height).toBeLessThanOrEqual(identity.font * 1.6);
    const input = dialog.getByLabel("Save name", { exact: true });
    expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(44);
    const checkbox = await dialog.getByRole("checkbox").boundingBox();
    expect(checkbox.width).toBeGreaterThanOrEqual(16);
    expect(checkbox.width).toBeLessThanOrEqual(24);
    expect(checkbox.height).toBeLessThanOrEqual(24);
    await dialog.getByRole("checkbox").check();
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    for (const button of await dialog.getByRole("button").all()) {
      await expect(button.locator('svg[aria-hidden="true"]')).toHaveCount(1);
    }
    for (const button of await dialog.getByRole("button", { name: /^Delete/ }).all()) {
      await expectRedAction(button);
    }
    const panel = page.locator("[data-modal-panel]");
    const dimensions = await panel.evaluate((element) => ({
      width: element.clientWidth, scroll: element.scrollWidth,
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(width);
    const mine = dialog.getByRole("region", { name: "My saved grids", exact: true });
    await mine.getByRole("button", { name: "Delete", exact: true }).click();
    await expectRedAction(dialog.getByRole("button", { name: "Confirm", exact: true }));
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(mock.grids.has(id)).toBe(true);
    await mine.getByRole("button", { name: "Delete", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(mine).toContainText("Nothing saved here yet.");
    expect(mock.grids.has(id)).toBe(false);
    await dialog.getByRole("button", { name: "Delete account and server data", exact: true }).click();
    await expectRedAction(dialog.getByRole("button", { name: "Confirm", exact: true }));
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
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
    const dialog = await openAccount(page);
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
    const again = await openAccount(page);
    await again.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(again.getByRole("link", { name: "Continue with Google", exact: true })).toBeVisible();
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
  const dialog = await openAccount(page);
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
  const dialog = page.getByRole("dialog", { name: "Account and saved grids" });
  await expect(dialog.getByRole("alert")).toContainText("Account service unavailable");
  await expect(page.locator("[data-sonner-toast]").first()).toContainText("Sign-in failed");
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
  let dialog = await openAccount(page);
  await dialog.getByLabel("Save name", { exact: true }).fill("Two columns");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Save settings as new preset", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Shared presets" })).toContainText("Two columns");
  const preset = [...mock.presets.values()][0];
  preset.settings.layout = { rows: 1, columns: 2 };
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
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
  dialog = await openAccount(page);
  await expect(dialog.getByRole("link", { name: "Continue with Google", exact: true }))
    .toHaveAttribute("href", /\/api\/auth\/google\/start$/);
  await expect(dialog.getByRole("link", { name: "Continue with Facebook", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Continue with Discord", exact: true })).toBeVisible();
});

test("account grids warn about unavailable local uploads but preserve captions and layout", async ({ page }) => {
  const mock = await mockAccount(page);
  await page.goto("./?source=imported");
  const dialog = await openAccount(page);
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
