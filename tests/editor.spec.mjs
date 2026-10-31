import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
async function downloadBoard(page) {
  const promise = page.waitForEvent("download");
  await page.locator("#export-board").click();
  return promise;
}

async function useComicExample(page, publisher = "dc") {
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Load example" });
  await dialog
    .getByRole("button", {
      name: publisher === "dc" ? "DC" : "Marvel",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Use example", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#canvas-title")).toHaveText(
    publisher === "dc" ? "DC Characters" : "Marvel Characters",
  );
}

test("single grid starts neutral and examples require deliberate replacement", async ({
  page,
}, testInfo) => {
  const requests = [];
  const errors = [];
  page.on("request", (request) =>
    requests.push({ type: request.resourceType(), url: request.url() }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page).toHaveTitle("Grids - Image Boards");
  await expect(
    page.getByRole("link", { name: "Grids IMAGE BOARDS", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(
    page.locator("#add-board, #board-tabs, #export-all"),
  ).toHaveCount(0);
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect(page.locator("#image-heading")).toHaveValue("");
  await expect(page.locator("#publisher")).toHaveValue("none");
  await expect(page.locator("#heading-font")).toHaveValue("Manrope");
  await expect(page.locator("#cell-font")).toHaveValue("Manrope");
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
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("neutral-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.locator("#resolution").selectOption("150");
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
  ).toEqual({ width: 462, height: 540 });
  await page.locator("#replace-upload").setInputFiles({
    name: "personal.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#12a874"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator("#cell-title").fill("Keep my own caption");
  const snapshot = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-editor-v1")),
  );
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Load example" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("grids-editor-v1")),
    ),
  ).toEqual(snapshot);
  await useComicExample(page);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".asset")).toHaveCount(9);
  await expect(page.locator("#image-heading")).toHaveValue("Team DC");
  await expect(page.locator(".grid-cell")).toHaveCount(4);
  const loaded = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-editor-v1")),
  );
  expect(loaded.assets[0]).toEqual(snapshot.assets[0]);
  expect(new Set(loaded.assets.map((asset) => asset.id)).size).toBe(9);
  expect(loaded).not.toHaveProperty("boards");
  expect(loaded).not.toHaveProperty("active");
  expect(loaded.version).toBe(1);
  await page.reload();
  await expect(page.locator("#canvas-title")).toHaveText("DC Characters");
  await useComicExample(page, "marvel");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".asset")).toHaveCount(9);
  const repeated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-editor-v1")),
  );
  expect(repeated.assets).toEqual(loaded.assets);
  expect(repeated.grid.publisher).toBe("marvel");
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
  expect(new URL(page.url()).pathname).toBe("/tier-list/");
  await expect(page.locator(".grid-cell")).toHaveCount(4);
  await expect(page.locator(".board-export-heading")).toHaveText("Team DC");
  await expect(page.locator(".board-export-heading img")).toHaveCount(0);
  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "background-color",
    "rgb(0, 133, 199)",
  );
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
    "uppercase",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "letter-spacing",
    "0.5px",
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
  await page.locator("#cell-title").fill("A larger heading");
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue(
    "A larger heading",
  );
  await expect(page.locator("#save-status")).toHaveText("Saved locally");
  await page.reload();
  await expect(page.locator(".cell-heading").nth(1)).toHaveValue(
    "A larger heading",
  );

  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(6);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await page.locator(".cell-image-button").nth(8).click();
  await page
    .locator("#replace-upload")
    .setInputFiles(path.join(projectRoot, "public/assets/DC - Kite Man.jpg"));
  await expect(page.locator(".cell-heading").nth(8)).toHaveValue(
    "DC   Kite Man",
  );

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await useComicExample(page);
  await page.locator("#resolution").selectOption("600");

  const exports = [];
  for (const [name, publisher] of [
    ["DC Characters", "dc"],
    ["Marvel Characters", "marvel"],
  ]) {
    await useComicExample(page, publisher);
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      await page.locator("#format").selectOption(mime);
      const download = await downloadBoard(page);
      const bytes = [...(await readFile(await download.path()))];
      const expectedExtension = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
      }[mime];
      expect(download.suggestedFilename()).toBe(
        `${publisher}-characters${expectedExtension}`,
      );
      if (mime === "image/png")
        expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      if (mime === "image/jpeg")
        expect(bytes.slice(0, 3)).toEqual([255, 216, 255]);
      if (mime === "image/webp")
        expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WEBP");
      const result = await page.evaluate(
        async ({ bytes, mime, publisher }) => {
          const blob = new Blob([new Uint8Array(bytes)], { type: mime });
          const image = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          const title = context.getImageData(12, 792, 600, 102).data;
          const heading = context.getImageData(12, 12, 1212, 168).data;
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
            ...context.getImageData(14, 14, 1, 1).data,
          ].slice(0, 3);
          const headerMargin = context.getImageData(36, 36, 120, 120).data;
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
        { bytes, mime, publisher },
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
    expect(result.width).toBe(1236);
    expect(result.height).toBe(1620);
    expect(result.brightTitlePixels).toBeGreaterThan(1000);
    expect(result.headingPixels).toBeGreaterThan(1000);
    expect(result.headerMarginPixels).toBe(0);
    const expectedColor =
      result.publisher === "dc" ? [0, 133, 199] : [237, 29, 36];
    result.headerColor.forEach((channel, index) =>
      expect(Math.abs(channel - expectedColor[index])).toBeLessThan(5),
    );
  }

  await page.locator("#resolution").selectOption("1200");
  await page.locator("#format").selectOption("image/png");
  for (const publisher of ["dc", "marvel"]) {
    await useComicExample(page, publisher);
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-board").click();
    const download = await downloadPromise;
    await download.saveAs(
      path.join(projectRoot, "exports", download.suggestedFilename()),
    );
  }

  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.locator("#cell-title").fill("My custom character");
  await page.reload();
  await expect(page.locator("#image-heading")).toHaveValue("Team DC");
  await expect(
    page.getByRole("switch", { name: "Show heading" }),
  ).toBeChecked();
  await expect(page.locator("#publisher")).toHaveValue("dc");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "My custom character",
  );
  await page.locator("#image-heading").fill("Team Superheroes");
  await page.locator("#heading-font").selectOption("Boogaloo");
  await page.locator("#cell-font").selectOption("Bangers");
  await page.locator("#publisher").selectOption("marvel");
  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "background-color",
    "rgb(237, 29, 36)",
  );
  await expect(page.locator(".board-export-heading img")).toHaveCount(0);
  await expect(page.locator(".board-export-heading")).toHaveText(
    "Team Superheroes",
  );
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "font-family",
    "Bangers, sans-serif",
  );
  await expect(page.locator("#save-status")).toHaveText("Saved locally");
  await page.reload();
  await expect(page.locator("#image-heading")).toHaveValue("Team Superheroes");
  await expect(page.locator("#heading-font")).toHaveValue("Boogaloo");
  await expect(page.locator("#cell-font")).toHaveValue("Bangers");
  await expect(page.locator("#publisher")).toHaveValue("marvel");
  await page.locator("#publisher").selectOption("none");
  await expect(page.locator(".board-export-heading")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await useComicExample(page, "marvel");
  await expect(page.locator("#image-heading")).toHaveValue("Team Marvel");
  await page.locator("#image-heading").fill("");
  await expect(page.locator(".board-export-heading")).toBeHidden();
  await page.locator("#resolution").selectOption("600");
  const download = await downloadBoard(page);
  const bytes = [...(await readFile(await download.path()))];
  const height = await page.evaluate(async (bytes) => {
    const image = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    const height = image.height;
    image.close();
    return height;
  }, bytes);
  expect(height).toBe(1440);
  await page.locator("#image-heading").fill("A".repeat(120));
  await page.setViewportSize({ width: 390, height: 844 });
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

test("animated editor controls preserve heading content and modal scroll/focus", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 760 });
  await page.goto("./");
  await useComicExample(page);
  const headingSwitch = page.getByRole("switch", { name: "Show heading" });
  await expect(headingSwitch).toHaveCSS("width", "44px");
  await expect(headingSwitch).toHaveCSS("height", "24px");
  await headingSwitch.focus();
  await headingSwitch.press("Space");
  await expect(headingSwitch).not.toBeChecked();
  await expect(page.locator(".board-export-heading")).toBeHidden();
  await expect(page.locator("#image-heading")).toHaveValue("Team DC");
  await page.reload();
  await expect(headingSwitch).not.toBeChecked();
  await expect(page.locator("#image-heading")).toHaveValue("Team DC");
  await page.locator("#resolution").selectOption("600");
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
  expect(exportSize).toEqual({ width: 1236, height: 1440 });
  await headingSwitch.click();
  await expect(page.locator(".board-export-heading")).toHaveText("Team DC");

  const settings = page.getByRole("button", {
    name: "Grid settings",
    exact: true,
  });
  await settings.click();
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#board-name")).toBeHidden();
  await settings.press("Enter");
  await expect(page.locator("#board-name")).toBeVisible();

  const actions = page.getByRole("button", {
    name: "Grid actions",
    exact: true,
  });
  await actions.focus();
  await actions.press("ArrowDown");
  const rename = page.getByRole("menuitem", { name: "Rename grid" });
  await expect(rename).toBeVisible();
  const before = await page.evaluate(() => ({
    scroll: window.scrollY,
    left: document.body.getBoundingClientRect().left,
    width: document.body.getBoundingClientRect().width,
  }));
  await rename.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename grid" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("#rename-board-name")).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCSS("color", "rgb(25, 32, 13)");
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("html")).toHaveCSS("scrollbar-gutter", "auto");
  const during = await page.evaluate(() => ({
    scroll: window.scrollY,
    left: document.body.getBoundingClientRect().left,
    width: document.body.getBoundingClientRect().width,
  }));
  expect(during).toEqual(before);
  await page.locator("#rename-board-name").fill("Discard this name");
  await page.evaluate(() => {
    const content = document.createElement("div");
    content.style.height = "1200px";
    document.querySelector('[role="dialog"] form').prepend(content);
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
  const closing = await page.evaluate(async () => {
    document.querySelector('[aria-label="Close dialog"]').click();
    await Promise.resolve();
    return {
      mounted: Boolean(document.querySelector('[role="dialog"]')),
      overflow: getComputedStyle(document.documentElement).overflow,
    };
  });
  expect(closing).toEqual({ mounted: true, overflow: "hidden" });
  await expect(dialog).toHaveCount(0);
  await expect(actions).toBeFocused();
  await expect(page.locator("html")).toHaveCSS("scrollbar-gutter", "stable");
  expect(await page.evaluate(() => window.scrollY)).toBe(before.scroll);
  await expect(page.locator("#canvas-title")).toHaveText("DC Characters");

  await actions.click();
  await rename.click();
  await page.locator("#rename-board-name").fill("My image board");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#canvas-title")).toHaveText("My image board");
  await page.reload();
  await expect(page.locator("#canvas-title")).toHaveText("My image board");
  await page.screenshot({
    path: testInfo.outputPath("controls-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await actions.click();
  await rename.click();
  await expect(dialog).toBeVisible();
  await page.locator("#rename-board-name").fill("Mobile cancel");
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
  await expect(page.locator("#canvas-title")).toHaveText("My image board");
  expect(errors).toEqual([]);
});

test("touch dialogs do not autofocus text inputs", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:5840/tier-list/");
    await page.getByRole("button", { name: "Grid actions", exact: true }).tap();
    await page.getByRole("menuitem", { name: "Rename grid" }).tap();
    await expect(
      page.getByRole("dialog", { name: "Rename grid" }),
    ).toBeVisible();
    await expect(page.locator("#rename-board-name")).not.toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"]')),
        ),
      )
      .toBe(true);
    await page.getByRole("button", { name: "Cancel", exact: true }).tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
      "INPUT",
    );
  } finally {
    await context.close();
  }
});

test("guest reset restores settings without deleting images or removed placements", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page.locator(".cell-image-button").nth(15).click();
  await page.locator("#replace-upload").setInputFiles({
    name: "local.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator("#cell-title").fill("Keep my custom caption");
  await page.locator("#image-heading").fill("Custom banner");
  await page.locator("#heading-font").selectOption("Bangers");
  await page.locator("#gap").fill("30");
  await page.locator("#format").selectOption("image/webp");
  await page.locator("#resolution").selectOption("300");
  await page.locator("#quality").fill("70");
  await page.reload();
  await expect(page.locator("#image-heading")).toHaveValue("Custom banner");
  await expect(page.locator("#format")).toHaveValue("image/webp");
  await expect(page.locator("#resolution")).toHaveValue("300");
  await expect(page.locator("#quality")).toHaveValue("70");
  const original = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-editor-v1")),
  );
  await page
    .getByRole("button", { name: "Reset to Defaults", exact: true })
    .click();
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(page.locator("#image-heading")).toHaveValue("");
  await expect(page.locator("#heading-font")).toHaveValue("Manrope");
  await expect(page.locator("#gap")).toHaveValue("12");
  await expect(page.locator("#format")).toHaveValue("image/png");
  await expect(page.locator("#resolution")).toHaveValue("1200");
  await expect(page.locator("#quality")).toHaveValue("95");
  await expect(page.locator(".asset")).toHaveCount(1);
  const reset = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-editor-v1")),
  );
  expect(reset.assets).toEqual(original.assets);
  expect(reset.grid).toMatchObject({
    name: "Grid",
    publisher: "none",
    heading: "",
    headingVisible: true,
    headingFont: "Manrope",
    cellFont: "Manrope",
    rows: 3,
    columns: 3,
    gap: 12,
    background: "#17191b",
  });
  expect(
    reset.grid.overflow.some(
      (entry) => entry.cell.title === "Keep my custom caption",
    ),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".cell-heading").nth(15)).toHaveValue(
    "Keep my custom caption",
  );
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
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

test("long imported filenames produce valid captions across reload", async ({
  page,
}) => {
  await page.goto("./");
  const title = "A".repeat(150);
  await page.locator("#replace-upload").setInputFiles({
    name: `${title}.svg`,
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    title.slice(0, 120),
  );
  await page.reload();
  await expect(page.locator(".asset")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    title.slice(0, 120),
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("grids-editor-v1")).assets[0].title,
    ),
  ).toBe(title);
});

test("failed guest saves report session-only mode without blocking export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "grids-editor-v1")
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("./");
  await expect(page.locator("#save-status")).toHaveText("Session only");
  await expect(page.locator("#toast")).toContainText("Local save failed");
  await page.locator("#resolution").selectOption("150");
  expect((await downloadBoard(page)).suggestedFilename()).toBe("grid.png");
  expect(
    await page.evaluate(() => localStorage.getItem("grids-editor-v1")),
  ).toBeNull();
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
  await expect(page.locator("#canvas-title")).toHaveText("Grid");
  for (const corruption of [
    "version",
    "cells",
    "references",
    "coordinates",
    "json",
  ]) {
    await page.evaluate((corruption) => {
      const saved = JSON.parse(localStorage.getItem("grids-editor-v1"));
      if (corruption === "version") saved.version = 99;
      if (corruption === "cells")
        saved.grid.cells[1].id = saved.grid.cells[0].id;
      if (corruption === "references")
        saved.grid.cells[0].assetId = crypto.randomUUID();
      if (corruption === "coordinates") saved.grid.rows = 13;
      localStorage.setItem(
        "grids-editor-v1",
        corruption === "json" ? "{broken" : JSON.stringify(saved),
      );
    }, corruption);
    await page.reload();
    await expect(page.locator(".grid-cell")).toHaveCount(9);
    await expect(page.locator("#canvas-title")).toHaveText("Grid");
  }
});

test("edge resizing preserves coordinates, selection, overflow and newer edits", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  const savedCells = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("grids-editor-v1")).grid.cells,
    );
  const original = await savedCells();
  await page.locator(".cell-image-button").nth(2).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(6);
  await expect(page.locator("#cell-number")).toHaveText("04");
  expect((await savedCells())[3].id).toBe(original[2].id);
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.locator("#cell-title").fill("Edit after resizing");
  await page.getByRole("button", { name: "Undo grid resize" }).click();
  await expect(page.locator("#rows")).toHaveText("2");
  await expect(page.locator("#cell-title")).toHaveValue("Edit after resizing");
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
  ).toBeVisible();
  await page.reload();
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
  await page.locator(".cell-image-button").first().click();
  await page
    .getByRole("button", {
      name: "Swap with selected cell: Edit after resizing",
      exact: true,
    })
    .click();
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Edit after resizing",
  );
  await expect(
    page.getByRole("button", {
      name: `Swap with selected cell: ${original[0].title}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("edge-controls-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("edge-controls-mobile.png"),
    fullPage: true,
  });
  const geometry = await page.evaluate(() => {
    const grid = document.querySelector("#board-grid").getBoundingClientRect();
    const columns = document
      .querySelector('[aria-label="Column controls"]')
      .getBoundingClientRect();
    const rows = document
      .querySelector('[aria-label="Row controls"]')
      .getBoundingClientRect();
    return {
      right: columns.left >= grid.right,
      bottom: rows.top >= grid.bottom,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(geometry).toEqual({ right: true, bottom: true, overflow: false });
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
      return this.src.startsWith("data:")
        ? decoded.then(
            () =>
              new Promise((resolve) =>
                window.pendingImageDecodes.push(resolve),
              ),
          )
        : decoded;
    };
  });
  await page.locator(".cell-image-button").nth(2).click();
  await page
    .locator("#replace-upload")
    .setInputFiles(path.join(projectRoot, "public/assets/DC - Kite Man.jpg"));
  await expect
    .poll(() => page.evaluate(() => window.pendingImageDecodes.length))
    .toBe(1);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page.evaluate(() =>
    window.pendingImageDecodes.splice(0).forEach((resolve) => resolve()),
  );
  await expect(page.locator(".cell-heading").nth(3)).toHaveValue(
    "DC   Kite Man",
  );
  await expect(page.locator(".cell-heading").nth(2)).toHaveValue("");
  await page.locator(".cell-image-button").nth(2).click();
  await page
    .locator("#replace-upload")
    .setInputFiles(
      path.join(projectRoot, "public/assets/Marvel - Eye-Boy.jpg"),
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
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("grids-editor-v1"));
    const board = saved.grid;
    board.rows = 12;
    board.columns = 12;
    board.heading = "";
    board.overflow = [];
    board.cells = Array.from({ length: 144 }, () => ({
      id: crypto.randomUUID(),
      assetId: null,
      title: "",
      fit: "contain",
    }));
    localStorage.setItem("grids-editor-v1", JSON.stringify(saved));
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add row", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Add column", exact: true }),
  ).toBeDisabled();
  await page.locator("#resolution").selectOption("600");
  await page.locator("#export-board").click();
  await expect(page.locator("#toast")).toContainText(
    "Export exceeds the 32 MP limit",
  );
  await page.locator("#resolution").selectOption("150");
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
  expect(size).toEqual({ width: 1839, height: 2151 });
});
