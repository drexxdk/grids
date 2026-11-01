import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
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

async function reloadWorkspace(page) {
  await expect(page.locator("#save-status")).toHaveText(
    "Saved in this browser",
  );
  await page.reload();
  await expect(page.locator("#board-grid")).toBeVisible();
}

async function downloadBoard(page) {
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  if (!(await dialog.isVisible()))
    await page.locator("#export-grid-header").click();
  const promise = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download image", exact: true })
    .click();
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
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.name)
    .toBe(publisher === "dc" ? "DC Characters" : "Marvel Characters");
}

async function selectTheme(page, name) {
  await page.locator("#theme-selector").click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function selectField(page, id, value) {
  await page.locator(`#${id}`).click();
  await page.getByRole("listbox").locator(`[data-value="${value}"]`).click();
}

test("theme selector remembers separate settings across switching and reload", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#theme-selector").click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
    "Clean",
    "Editorial",
    "Superhero",
    "Custom",
  ]);
  await page.getByRole("option", { name: "Superhero", exact: true }).click();
  await expect(page.locator("#heading-font")).toHaveCount(1);
  await expect(page.locator(".settings-panel")).not.toContainText("Aa");
  await page.locator(".cell-heading").first().fill("Keep caption");
  await page.getByRole("button", { name: "Marvel", exact: true }).click();
  await selectField(page, "heading-font", "Manrope");
  await page.locator("#gap").fill("19");
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.headingFont)
    .toBe("Manrope");
  expect((await savedWorkspace(page)).grid.template).toBe("Superhero");
  await selectTheme(page, "Editorial");
  await expect(page.locator("#heading-font")).toHaveText("Bebas Neue");
  await selectField(page, "heading-font", "Boogaloo");
  await page.locator("#background").fill("#334455");
  await selectTheme(page, "Superhero");
  await expect(page.locator("#heading-font")).toHaveText("Manrope");
  await expect(page.locator("#gap")).toHaveValue("19");
  await expect(
    page.getByRole("button", { name: "Marvel", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await selectTheme(page, "Editorial");
  await expect(page.locator("#heading-font")).toHaveText("Boogaloo");
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.background)
    .toBe("#334455");
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep caption",
  );
  await page.screenshot({
    path: testInfo.outputPath("theme-settings-desktop.png"),
  });
  await reloadWorkspace(page);
  await expect(page.locator("#theme-selector")).toHaveText("Editorial");
  await expect(page.locator("#background")).toHaveValue("#334455");
  await selectTheme(page, "Superhero");
  await expect(page.locator("#gap")).toHaveValue("19");
  await selectTheme(page, "Custom");
  await page.locator("#background").fill("#556677");
  await selectTheme(page, "Clean");
  await expect(page.locator("#gap")).toHaveValue("12");
  await selectTheme(page, "Custom");
  await expect(page.locator("#background")).toHaveValue("#556677");
  const settings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("grids-settings-v1")),
  );
  expect(JSON.stringify(settings.themeSettings)).not.toContain("Keep caption");
  await expect(
    page.getByRole("button", { name: "Export grid", exact: true }),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("theme-settings-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("header export combines settings and downloads on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await expect(
    page.getByRole("tab", { name: "Export", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Grid style", exact: true }),
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
    if (format === "image/png")
      await expect(dialog.locator("#quality")).toBeDisabled();
    else {
      await expect(dialog.locator("#quality")).toBeEnabled();
      await dialog.locator("#quality").fill("80");
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
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(dialog.locator("#format")).toHaveText("WebP");
  await expect(dialog.locator("#resolution")).toHaveText("150 px / image");
  await expect(dialog.locator("#quality")).toHaveValue("80");
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await selectField(page, "format", "image/png");
  await expect(dialog.locator("#quality")).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("export-dialog-mobile.png"),
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("fullscreen visual cropping preserves originals and matches preview and export", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.goto("./");
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
  await page.locator(".asset").dragTo(image);
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
    await image.hover({ position: { x: 5, y: 5 } });
    await page.getByRole("button", { name: "Crop image", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("opacity", "1");
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
  await page
    .locator(".asset")
    .dragTo(page.locator(".cell-image-button").nth(1));
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
  expect(
    await sample(await page.locator(".cell-image-button").nth(1).screenshot()),
  ).toEqual([0, 255, 0, 255]);
  await page
    .getByRole("button", { name: "Landscape images", exact: true })
    .click();
  await openCrop();
  await dialog.getByRole("button", { name: "Apply crop", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const landscapeCrop = (await savedWorkspace(page)).grid.cells[0].crop;
  expect(landscapeCrop.width).toBeCloseTo(applied.width, 6);
  expect(landscapeCrop.height).toBeCloseTo((applied.height * 3) / 4, 6);
  await page
    .getByRole("button", { name: "Square images", exact: true })
    .click();
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
    name: "My Mixed Case Hero.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const title = await page.locator(".asset-name").first().inputValue();
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
  expect(rendered).toContain(title);
  expect(rendered).not.toContain(title.toUpperCase());
  await page.setViewportSize({ width: 960, height: 1080 });
  await page
    .getByRole("button", { name: "Text above image", exact: true })
    .click();
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

test("precise image frames and thin caption feedback stay independent", async ({
  page,
}) => {
  await page.goto("./");
  const cell = page.locator(".grid-cell").first();
  const image = cell.locator(".cell-image-button");
  const caption = cell.locator(".cell-heading");
  const frames = cell.locator("[data-cell-image-frame]");
  await caption.fill("Caption");
  for (const [placement, alignment] of [
    ["Text above image"],
    ["Text below image"],
    ["Text on image", "Text at bottom"],
    ["Text on image", "Text at top"],
    ["Text on image", "Text at middle"],
  ]) {
    await page.getByRole("button", { name: placement, exact: true }).click();
    if (alignment)
      await page.getByRole("button", { name: alignment, exact: true }).click();
    await page.mouse.move(1, 1);
    const idleColor = await frames
      .first()
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--frame-color"),
      );
    const before = await cell.boundingBox();
    const imageBounds = await image.boundingBox();
    const captionBounds = await caption.boundingBox();
    await image.hover({
      position: {
        x: 8,
        y:
          captionBounds.y <= imageBounds.y
            ? captionBounds.y + captionBounds.height - imageBounds.y + 5
            : 5,
      },
    });
    for (const frame of await frames.all()) {
      await expect(frame).toHaveCSS("--frame-color", "#d8f36a");
      await expect(frame.locator("rect")).toHaveAttribute("stroke-width", "1");
      await expect(frame.locator("rect")).toHaveAttribute(
        "stroke-dasharray",
        "2 2",
      );
      await expect(frame.locator("rect")).toHaveAttribute("rx", "7.5");
      await expect(frame).toHaveCSS("pointer-events", "none");
      const bounds = await frame.boundingBox();
      expect(bounds.x).toBeCloseTo(before.x - 2, 1);
      expect(bounds.y).toBeCloseTo(before.y - 2, 1);
      expect(bounds.width).toBeCloseTo(before.width + 4, 1);
      expect(bounds.height).toBeCloseTo(before.height + 4, 1);
    }
    await expect(caption).toHaveCSS("outline-style", "none");
    const idleBackground = await caption.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await caption.hover();
    await expect(caption).toHaveCSS("outline-style", "none");
    await expect
      .poll(() =>
        caption.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      )
      .not.toBe(idleBackground);
    await expect(cell).toHaveCSS("border-top-color", "rgb(48, 51, 53)");
    const spacing = await caption.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: element.clientWidth,
        left: parseFloat(style.paddingLeft),
        right: parseFloat(style.paddingRight),
        top: parseFloat(style.paddingTop),
        bottom: parseFloat(style.paddingBottom),
      };
    });
    expect(spacing.left).toBeCloseTo(spacing.width * 0.06, 1);
    expect(spacing.right).toBeCloseTo(spacing.width * 0.06, 1);
    expect(spacing.top).toBeGreaterThanOrEqual(spacing.width * 0.05 - 1);
    expect(spacing.bottom).toBeGreaterThanOrEqual(spacing.width * 0.05 - 1);
    for (const frame of await frames.all())
      await expect(frame).toHaveCSS("--frame-color", idleColor);
    await image.focus();
    await image.press("Tab");
    await caption.press("Shift+Tab");
    await expect(image).toBeFocused();
    for (const frame of await frames.all()) {
      await expect(frame).toHaveCSS("--frame-color", "#d8f36a");
    }
    await image.press("Tab");
    await expect(caption).toBeFocused();
    await expect(caption).toHaveCSS("outline-style", "none");
    await expect
      .poll(() =>
        caption.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      )
      .not.toBe(idleBackground);
    for (const frame of await frames.all())
      await expect(frame).toHaveCSS("--frame-color", idleColor);
    expect(await cell.boundingBox()).toEqual(before);
    await caption.fill("Still editable");
    await expect(caption).toHaveValue("Still editable");
  }
});

test("sidebar and slide-up cards match canvas placement, editing and external dotted frames", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "frame.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  const asset = page.locator(".asset").first();
  const thumbnail = asset.locator("[data-library-thumbnail]");
  const libraryCaption = asset.locator(".library-heading");
  const externalFrame = asset.locator("[data-cell-image-frame]");
  const card = page.locator(".grid-cell").first();
  const canvasCaption = card.locator(".cell-heading");
  const upload = page.locator("[data-upload-tile]");
  await thumbnail.dragTo(card.locator(".cell-image-button"));
  await thumbnail.dragTo(
    page.locator(".grid-cell").nth(1).locator(".cell-image-button"),
  );
  for (const [width, expanded] of [
    [1440, false],
    [780, false],
    [780, true],
  ]) {
    await page.setViewportSize({ width, height: 1080 });
    if (expanded)
      await page
        .getByRole("button", { name: "Expand tools", exact: true })
        .click();
    await expect(thumbnail).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await thumbnail.boundingBox();
        return bounds.y + bounds.height;
      })
      .toBeLessThanOrEqual(1080);
    await page.mouse.move(1, 1);
    const thumbnailBounds = await thumbnail.boundingBox();
    const uploadBounds = await upload.boundingBox();
    for (const frame of [upload])
      expect(
        await frame.evaluate(
          (element) => getComputedStyle(element, "::after").backgroundSize,
        ),
      ).toBe("100% 1px, 100% 1px, 1px 100%, 1px 100%");
    for (const [placement, alignment] of [
      ["Text above image"],
      ["Text below image"],
      ["Text on image", "Text at top"],
      ["Text on image", "Text at middle"],
      ["Text on image", "Text at bottom"],
    ]) {
      await page.getByRole("button", { name: placement, exact: true }).click();
      if (alignment)
        await page
          .getByRole("button", { name: alignment, exact: true })
          .click();
      await expect(libraryCaption).toBeVisible();
      const layouts = [];
      for (const surface of [asset, card]) {
        layouts.push(
          await surface.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const image = element
              .querySelector("[data-card-image]")
              .getBoundingClientRect();
            const heading = element.querySelector("textarea");
            const title = heading.getBoundingClientRect();
            return {
              imageTop: (image.y - bounds.y) / bounds.height,
              captionTop: (title.y - bounds.y) / bounds.height,
              imageRatio: image.width / image.height,
              font: getComputedStyle(heading).fontFamily,
              color: getComputedStyle(heading).backgroundColor,
            };
          }),
        );
      }
      expect(layouts[0].imageTop).toBeCloseTo(layouts[1].imageTop, 1);
      expect(layouts[0].captionTop).toBeCloseTo(layouts[1].captionTop, 1);
      expect(layouts[0].imageRatio).toBeCloseTo(layouts[1].imageRatio, 1);
      expect(layouts[0].font).toBe(layouts[1].font);
      expect(layouts[0].color).toBe(layouts[1].color);
    }
    await page
      .getByRole("button", { name: "Text above image", exact: true })
      .click();
    await libraryCaption.click();
    await expect(libraryCaption).toBeFocused();
    await libraryCaption.fill(`Edited ${width} ${expanded}`);
    await expect(canvasCaption).toHaveValue(`Edited ${width} ${expanded}`);
    await expect(page.locator(".cell-heading").nth(1)).toHaveValue(
      `Edited ${width} ${expanded}`,
    );
    await canvasCaption.fill("Canvas edit");
    await expect(libraryCaption).toHaveValue("Canvas edit");
    await thumbnail.hover({ position: { x: 5, y: 30 } });
    await expect(externalFrame).toHaveCSS("--frame-color", "#d8f36a");
    await expect(asset).toHaveCSS("cursor", "grab");
    {
      await libraryCaption.click();
      await expect(asset.locator(".asset-category")).toHaveCount(0);
      await expect(asset.locator(".asset-name")).toHaveCSS(
        "padding-left",
        await asset
          .locator(".asset-name")
          .evaluate(
            (element) =>
              `${parseFloat(getComputedStyle(element).paddingRight)}px`,
          ),
      );
      for (const surface of [asset, card]) {
        await expect(surface).toHaveCSS("border-top-width", "1px");
        await expect(surface).toHaveCSS("border-top-style", "solid");
        await expect(surface).toHaveCSS("border-top-color", "rgb(48, 51, 53)");
        await expect(surface).toHaveCSS("border-radius", "6px");
        await expect(surface).toHaveCSS("overflow", "visible");
      }
      const imageBounds = await thumbnail.boundingBox();
      const titleBounds = await asset.locator(".asset-name").boundingBox();
      expect(titleBounds.y + titleBounds.height).toBeCloseTo(imageBounds.y, 0);
      await expect(externalFrame).toHaveCSS("--frame-color", "transparent");
      await expect(libraryCaption).toHaveCSS("outline-style", "none");
      await thumbnail.hover({ position: { x: 5, y: 30 } });
      await expect(externalFrame).toHaveCSS("--frame-color", "#d8f36a");
      const outer = await asset.boundingBox();
      const frameBounds = await externalFrame.boundingBox();
      expect(frameBounds.x).toBeCloseTo(outer.x - 2, 1);
      expect(frameBounds.y).toBeCloseTo(outer.y - 2, 1);
      expect(frameBounds.width).toBeCloseTo(outer.width + 4, 1);
      expect(frameBounds.height).toBeCloseTo(outer.height + 4, 1);
      const screenshot = await externalFrame.screenshot();
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
          const pixels = context.getImageData(12, 0, 8, 1).data;
          const corners = [
            [0, 0],
            [bitmap.width - 8, 0],
            [0, bitmap.height - 8],
            [bitmap.width - 8, bitmap.height - 8],
          ].map(([left, top]) => {
            const corner = context.getImageData(left, top, 8, 8).data;
            return Array.from(
              { length: 64 },
              (_, index) =>
                corner[index * 4 + 1] > 100 &&
                corner[index * 4 + 1] > corner[index * 4] + 12,
            ).filter(Boolean).length;
          });
          bitmap.close();
          return {
            corners,
            marks: Array.from(
              { length: 8 },
              (_, index) =>
                pixels[index * 4] > 160 && pixels[index * 4 + 1] > 220,
            ),
          };
        },
        [...screenshot],
      );
      for (const corner of pixels.corners) expect(corner).toBeGreaterThan(0);
      const marks = pixels.marks;
      const period = marks.slice(0, 4);
      expect(period.filter(Boolean)).toHaveLength(2);
      expect(marks.slice(4)).toEqual(period);
      expect(
        period.filter((mark, index) => mark !== period[(index + 1) % 4]),
      ).toHaveLength(2);
      await asset
        .locator("[data-library-thumbnail]")
        .dragTo(page.locator(".cell-image-button").first());
      await expect(
        page.locator(".grid-cell").first().locator("img"),
      ).toHaveCount(1);
    }
    await upload.hover({ position: { x: 5, y: 5 } });
    await expect(upload).toHaveCSS("--frame-color", "#d8f36a");
    await page.mouse.move(1, 1);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    for (const [control, frame] of [
      [thumbnail, externalFrame],
      [upload, upload],
    ]) {
      await control.focus();
      await control.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(control).toBeFocused();
      await expect(frame).toHaveCSS("--frame-color", "#d8f36a");
      await expect(control).toHaveCSS("outline-style", "none");
    }
    expect(await thumbnail.boundingBox()).toMatchObject({
      width: thumbnailBounds.width,
      height: thumbnailBounds.height,
    });
    expect(await upload.boundingBox()).toMatchObject({
      width: uploadBounds.width,
      height: uploadBounds.height,
    });
    await page.screenshot({
      path: testInfo.outputPath(
        `dotted-frames-${width}-${expanded ? "expanded" : "collapsed"}.png`,
      ),
    });
  }
  await reloadWorkspace(page);
  await expect(page.locator(".library-heading").first()).toHaveValue(
    "Canvas edit",
  );
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Canvas edit",
  );
});

for (const viewportWidth of [1440, 780]) {
  test(`canvas dragging moves into empty cells and swaps occupied cells with crops at ${viewportWidth}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewportWidth, height: 1080 });
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
    await page
      .getByRole("button", { name: "Portrait images", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Text on image", exact: true })
      .click();
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
    await images.nth(0).hover({ position: { x: 5, y: 5 } });
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
    await expect(images.nth(0)).toHaveCSS("overflow", "hidden");
    const picture = await images.nth(0).boundingBox();
    const frame = page
      .locator(".grid-cell")
      .first()
      .locator("[data-cell-image-frame]")
      .first();
    const frameBounds = await frame.boundingBox();
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
    await expect(frame).toHaveCSS("--frame-color", "#d8f36a");
    const cardBounds = await page.locator(".grid-cell").first().boundingBox();
    expect(frameBounds.x).toBeCloseTo(cardBounds.x - 2, 1);
    expect(frameBounds.width).toBeCloseTo(cardBounds.width + 4, 1);
    const screenshot = await page.screenshot({
      clip: {
        x: frameBounds.x - 1,
        y: frameBounds.y - 1,
        width: Math.ceil(frameBounds.width) + 2,
        height: Math.ceil(frameBounds.height) + 2,
      },
    });
    const rightBorderVisible = await page.evaluate(
      async ({ bytes, height }) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(
          canvas.width - 4,
          Math.floor(height / 2),
          3,
          8,
        ).data;
        bitmap.close();
        return Array.from(
          { length: pixels.length / 4 },
          (_, index) => pixels[index * 4] > 100 && pixels[index * 4 + 1] > 50,
        ).some(Boolean);
      },
      { bytes: [...screenshot], height: frameBounds.height },
    );
    expect(rightBorderVisible).toBe(true);
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
    const previews = await page.evaluate(() => window.canvasDragPreviews);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      tag: "CANVAS",
      width: Math.ceil(picture.width),
      height: Math.ceil(picture.height),
      color: [255, 0, 0, 255],
    });
    expect(previews[0].x).toBeCloseTo(8, 0);
    expect(Math.abs(previews[0].y - bottomY)).toBeLessThanOrEqual(1);
    await expect(page.locator("body > canvas")).toHaveCount(0);
    let current = await savedWorkspace(page);
    expect(current.grid.cells[2]).toEqual({
      ...before.grid.cells[0],
      id: before.grid.cells[2].id,
    });
    await images.nth(2).dragTo(images.nth(1));
    await expect(headings.nth(1)).toHaveValue("First item");
    await expect(headings.nth(2)).toHaveValue("Second item");
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
  await page.goto(testInfo.project.use.baseURL);
  await page.locator("#upload").setInputFiles({
    name: "touch crop.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="200" height="200" fill="#ff0000"/><rect x="200" width="200" height="200" fill="#00ff00"/><rect x="400" width="200" height="200" fill="#0000ff"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Portrait images", exact: true })
    .tap();
  const image = page.locator(".cell-image-button").first();
  await image.tap();
  await page
    .getByRole("dialog", { name: "Choose image" })
    .getByRole("button", { name: "Use touch crop", exact: true })
    .tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await image.tap();
  await page.getByRole("button", { name: "Crop image", exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "Crop image", exact: true });
  await expect(dialog).toHaveCSS("opacity", "1");
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

test("appearance toolbar preserves content and matches exported ratios and captions", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.goto("./");
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
  await page.locator(".asset").dragTo(image);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await image.hover();
  await caption.fill("");
  const identity = (await savedWorkspace(page)).grid.cells[0];
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const toolbar = page.getByRole("toolbar", { name: "Grid appearance" });
  async function pixels(imageHeight, placement, alignment = "bottom") {
    const captionHeight = 35;
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
      3 * (imageHeight + (placement === "overlay" ? 0 : captionHeight)) + 12,
    );
    expect(result.image).toEqual([64, 100, 200, 255]);
    return result.caption;
  }
  for (const [aspect, ratio, imageHeight] of [
    ["Portrait", 3 / 4, 200],
    ["Landscape", 4 / 3, 113],
    ["Square", 1, 150],
  ]) {
    await toolbar
      .getByRole("button", { name: `${aspect} images`, exact: true })
      .click();
    await expect(
      toolbar.getByRole("button", { name: `${aspect} images`, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const placement of ["above", "below", "overlay"]) {
      await toolbar
        .getByRole("button", {
          name:
            placement === "overlay"
              ? "Text on image"
              : `Text ${placement} image`,
          exact: true,
        })
        .click();
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
          toolbar.getByRole("group", { name: "Caption alignment" }),
        ).toHaveCount(0);
        expect(await pixels(imageHeight, placement)).toEqual([32, 35, 37, 255]);
        continue;
      }
      await toolbar
        .getByRole("button", { name: "Text overlay settings" })
        .click();
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
      await page.locator("#caption-opacity").press("Escape");
      for (const alignment of ["top", "middle", "bottom"]) {
        await toolbar
          .getByRole("button", { name: `Text at ${alignment}`, exact: true })
          .click();
        const imageBounds = await image.boundingBox();
        const captionBounds = await caption.boundingBox();
        const expected =
          alignment === "top"
            ? imageBounds.y
            : alignment === "middle"
              ? imageBounds.y + (imageBounds.height - captionBounds.height) / 2
              : imageBounds.y + imageBounds.height - captionBounds.height;
        expect(captionBounds.y).toBeCloseTo(expected, 0);
        await image.hover({
          position: {
            x: 5,
            y: alignment === "top" ? imageBounds.height * 0.6 : 5,
          },
        });
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
    await toolbar
      .getByRole("button", { name: "Text overlay settings" })
      .click();
    await page.locator("#caption-opacity").fill(String(opacity));
    await page.locator("#caption-opacity").press("Escape");
    expect(await pixels(150, "overlay")).toEqual(expected);
  }
  await caption.fill("A surprisingly long caption that remains editable");
  await expect
    .poll(() =>
      caption.evaluate((field) => field.scrollHeight <= field.clientHeight + 1),
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
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      toolbar.evaluate((element) =>
        [...element.querySelectorAll("button")].every((button) => {
          const rect = button.getBoundingClientRect();
          return (
            rect.x >= 0 &&
            rect.right <= innerWidth &&
            rect.width >= 44 &&
            rect.height >= 44
          );
        }),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await toolbar.getByRole("button", { name: "Text overlay settings" }).click();
  const color = page.getByRole("textbox", {
    name: "Overlay color hex value",
    exact: true,
  });
  await expect(color).toBeVisible();
  await expect(color).not.toBeFocused();
  const colorBounds = await color.boundingBox();
  expect(colorBounds.x).toBeGreaterThanOrEqual(0);
  expect(colorBounds.x + colorBounds.width).toBeLessThanOrEqual(390);
  await page.locator("#caption-opacity").press("Escape");
  await toolbar
    .getByRole("button", { name: "Landscape images", exact: true })
    .click();
  await toolbar
    .getByRole("button", { name: "Text at middle", exact: true })
    .click();
  await image.hover({ position: { x: 5, y: 5 } });
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
  await selectTheme(page, "Superhero");
  const subThemes = page.getByRole("group", {
    name: "Superhero sub-theme",
    exact: true,
  });
  for (const name of ["Marvel", "DC"]) {
    const button = subThemes.getByRole("button", { name, exact: true });
    await page.mouse.move(0, 0);
    const background = await button.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const selected = await button.getAttribute("aria-pressed");
    const before = await button.boundingBox();
    await button.hover();
    await expect
      .poll(() =>
        button.evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .not.toBe(background);
    await expect(button).toHaveAttribute("aria-pressed", selected);
    expect(await button.boundingBox()).toEqual(before);
  }
  const headingToggle = page.getByRole("switch", {
    name: "Show heading",
    exact: true,
  });
  for (const checked of ["true", "false"]) {
    await page.mouse.move(0, 0);
    await expect(headingToggle).toHaveCSS("filter", "none");
    const before = await headingToggle.boundingBox();
    await headingToggle.hover();
    await expect(headingToggle).toHaveCSS("filter", "brightness(1.1)");
    await expect(headingToggle).toHaveAttribute("aria-checked", checked);
    expect(await headingToggle.boundingBox()).toEqual(before);
    await headingToggle.click();
  }
  await expect(page.locator(".settings-panel select")).toHaveCount(0);
  const hex = page.getByRole("textbox", {
    name: "Background hex value",
    exact: true,
  });
  const picker = page.getByLabel("Background color picker", { exact: true });
  for (const id of ["theme-selector", "heading-font", "cell-font"]) {
    await page.locator(`label[for="${id}"]`).hover();
    await expect(page.locator(`#${id}`)).toHaveCSS(
      "border-top-color",
      "rgb(48, 51, 53)",
    );
    await page.locator(`#${id}`).hover();
    await expect(page.locator(`#${id}`)).toHaveCSS(
      "border-top-color",
      "rgb(216, 243, 106)",
    );
    await page.locator(`label[for="${id}"]`).click();
    await expect(page.locator(`#${id}`)).toBeFocused();
    await page.locator(`#${id}`).press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.getByRole("listbox").press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }
  await page.locator('label[for="background-value"]').hover();
  await expect(hex).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(picker).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(hex.locator("..")).toHaveCSS(
    "border-top-color",
    "rgb(48, 51, 53)",
  );
  await page.locator('label[for="background-value"]').click();
  await expect(hex).toBeFocused();
  await hex.blur();
  for (const field of [picker, hex]) {
    await page.mouse.move(0, 0);
    await expect(field).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const value = await field.inputValue();
    const before = await field.boundingBox();
    await field.hover();
    await expect(field).toHaveCSS("background-color", "rgb(48, 51, 53)");
    await expect(field.locator("..")).toHaveCSS(
      "border-top-color",
      "rgb(216, 243, 106)",
    );
    await expect(field).toHaveValue(value);
    expect(await field.boundingBox()).toEqual(before);
  }
  const pickerBox = await picker.boundingBox();
  expect(pickerBox.width).toBeGreaterThanOrEqual(64);
  expect(pickerBox.height).toBeGreaterThanOrEqual(44);
  expect((await hex.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(hex).toHaveCSS("border-top-width", "0px");
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
    await expect(option).toHaveCSS("align-items", "center");
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
  await page.getByRole("listbox").press("End");
  await page.getByRole("listbox").press("Enter");
  await expect(page.locator("#heading-font")).toHaveText("Bebas Neue");
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
  await expect(page.locator("#heading-font")).toHaveText("Bebas Neue");
  await expect(page.locator("#cell-font")).toHaveText("Boogaloo");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Expand tools", exact: true }).click();
  await page.locator("#heading-font").click();
  const menuBox = await page.getByRole("listbox").boundingBox();
  expect(menuBox.x).toBeGreaterThanOrEqual(12);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(378);
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

test("bottom drawer stays horizontally fixed through modal open and close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "stable.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const drawer = page.locator("[data-editor-drawer]");
  const before = await drawer.boundingBox();
  const assertStable = async () => {
    const current = await drawer.boundingBox();
    expect(Math.abs(current.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(current.width - before.width)).toBeLessThanOrEqual(1);
  };
  await page
    .getByRole("button", { name: "Add image to cell 1", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await assertStable();
  await picker.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await assertStable();
  await page.getByRole("button", { name: "Expand tools", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Local storage", exact: true }),
  ).toHaveCount(0);
  const settings = page.getByRole("complementary", {
    name: "Grid settings",
    exact: true,
  });
  await expect(
    settings
      .locator(":scope > :last-child")
      .getByRole("button", { name: "Reset grid settings", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset grid settings", exact: true })
    .click();
  const reset = page.getByRole("dialog", {
    name: "Reset grid settings",
    exact: true,
  });
  await expect(reset).toBeVisible();
  await assertStable();
  await reset.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reset).toHaveCount(0);
  await assertStable();
});

test("mobile image drawer expands tools and restores desktop sidebars", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://localhost:5840/tier-list/");
  const drawer = page.locator("[data-editor-drawer]");
  const expand = page.getByRole("button", {
    name: "Expand tools",
    exact: true,
  });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  const sources = drawer.getByRole("tablist", {
    name: "Image source",
    exact: true,
  });
  await expect(sources.getByRole("tab")).toHaveText(["Imported", "Online"]);
  await expect(sources).toHaveCSS("border-radius", "4px");
  await expect(sources).toHaveCSS("border-bottom-style", "solid");
  await expect(sources.getByRole("tab").first()).toHaveCSS(
    "border-right-style",
    "solid",
  );
  await expect(
    sources.getByRole("tab", { name: "Online", exact: true }),
  ).toBeDisabled();
  await expect(
    drawer.getByRole("button", { name: "Clear all images", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Load example", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add or drop images", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Clean up images", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Grid settings", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add images", exact: true }).tap();
  await (
    await chooser
  ).setFiles(
    ["gallery-1.svg", "gallery-2.svg", "gallery-3.svg"].map((name) => ({
      name,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await expect(drawer.locator(".asset")).toHaveCount(3);
  await expect(page.locator("#upload")).toHaveCount(1);
  await expect(drawer.locator("#asset-library")).toHaveCSS("display", "flex");
  const compactBox = await drawer.boundingBox();
  const assertUploadTileSize = async () => {
    const upload = page.locator("[data-upload-tile]");
    const uploadBox = await upload.boundingBox();
    const imageBox = await page
      .locator("#asset-library .asset")
      .first()
      .boundingBox();
    expect(uploadBox.width).toBeCloseTo(imageBox.width, 1);
    expect(uploadBox.height).toBeCloseTo(imageBox.width, 1);
    await page.mouse.move(0, 0);
    await expect(upload).toHaveCSS("--frame-color", "#303335");
  };
  await assertUploadTileSize();
  expect(compactBox.height).toBeLessThanOrEqual(152);
  const strip = drawer.locator("#asset-library");
  const clearance = await strip.evaluate((element) => {
    const strip = element.getBoundingClientRect();
    const image = element
      .querySelector("[data-library-thumbnail]")
      .getBoundingClientRect();
    return {
      top: image.top - strip.top,
      bottom: strip.top + element.clientHeight - image.bottom,
      stripBottom: strip.bottom,
      drawerBottom: element
        .closest("[data-editor-drawer]")
        .getBoundingClientRect().bottom,
    };
  });
  expect(clearance.top).toBeGreaterThanOrEqual(1.5);
  expect(clearance.bottom).toBeGreaterThanOrEqual(1.5);
  expect(
    Math.abs(clearance.stripBottom - clearance.drawerBottom),
  ).toBeLessThanOrEqual(1);
  const sourceBox = await sources.boundingBox();
  const toggleBox = await expand.boundingBox();
  expect(Math.abs(sourceBox.y - toggleBox.y)).toBeLessThanOrEqual(1);
  await expect(drawer.locator(".asset-name").first()).toBeHidden();
  await expect(drawer.locator(".asset-category").first()).toBeHidden();
  expect(compactBox.y).toBeGreaterThan(844 / 2);
  expect(compactBox.y + compactBox.height).toBeLessThanOrEqual(845);
  await page.screenshot({
    path: testInfo.outputPath("image-drawer-collapsed-mobile.png"),
  });
  await page
    .getByRole("button", { name: "Add image to cell 2", exact: true })
    .tap();
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await picker
    .getByRole("button", { name: "Use gallery 2", exact: true })
    .tap();
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".grid-cell").nth(1).locator("img")).toHaveCount(1);
  await expand.tap();
  const collapse = page.getByRole("button", {
    name: "Collapse tools",
    exact: true,
  });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await assertUploadTileSize();
  await expect(
    drawer.getByRole("button", { name: "Clear all images", exact: true }),
  ).toBeVisible();
  await expect(drawer.locator(".asset-name").first()).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Grid settings", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  await expect(
    drawer.getByRole("button", { name: "Load example", exact: true }),
  ).toBeVisible();
  await selectField(page, "heading-font", "Boogaloo");
  await expect(page.locator("#heading-font")).toHaveText("Boogaloo");
  await page.screenshot({
    path: testInfo.outputPath("image-drawer-expanded-mobile.png"),
  });
  await collapse.tap();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("complementary", { name: "Grid settings", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(drawer).toBeVisible();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({
    path: testInfo.outputPath("image-drawer-tablet.png"),
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await expect(drawer).toHaveCount(0);
  await expect(page.locator(".workspace-toolbar")).toHaveCount(0);
  const settings = page.getByRole("complementary", {
    name: "Grid settings",
    exact: true,
  });
  await expect(
    settings.getByRole("button", { name: "Reset grid settings", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Local storage", exact: true }),
  ).toHaveCount(0);
  await expect(
    settings
      .locator(":scope > :last-child")
      .getByRole("button", { name: "Reset grid settings", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#heading-font")).toHaveText("Boogaloo");
  await expect(page.locator("#upload")).toHaveCount(1);
  await expect(page.locator(".asset")).toHaveCount(3);
  await expect(page.locator(".grid-cell").nth(1).locator("img")).toHaveCount(1);
  await assertUploadTileSize();
  await page.screenshot({
    path: testInfo.outputPath("image-drawer-desktop-sidebars.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
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
  await expect(libraryDelete).toHaveCSS(
    "border-top-color",
    "rgb(216, 243, 106)",
  );
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
    for (const frame of await page
      .locator(".grid-cell")
      .first()
      .locator("[data-cell-image-frame]")
      .all()) {
      await expect(frame).toHaveCSS("--frame-color", "#d8f36a");
    }
    await expect(button).toHaveCSS("border-top-color", "rgb(216, 243, 106)");
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
  await expect(
    tools.getByRole("button", { name: "Clear cell", exact: true }),
  ).toHaveCSS(
    "background-color",
    /^(?:rgba\(0, 0, 0, 0\.6\)|oklab\(0 0 0 \/ 0\.6\))$/,
  );
  await expect(
    tools.getByRole("button", { name: "Clear cell", exact: true }),
  ).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(tools.locator("div").first()).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  const clear = await tools
    .getByRole("button", { name: "Clear cell", exact: true })
    .boundingBox();
  expect(clear.y - picture.y).toBeLessThanOrEqual(4);
  expect(picture.x + picture.width - clear.x - clear.width).toBeLessThanOrEqual(
    4,
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
  await page.goto("http://localhost:5840/tier-list/");
  await page.locator("#upload").setInputFiles({
    name: "touch.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const image = page.locator(".cell-image-button").nth(2);
  await image.tap();
  const tools = page.getByRole("group", { name: "Cell tools", exact: true });
  await expect(tools).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input, textarea"),
    ),
  ).toBe(false);
  const picker = page.getByRole("dialog", { name: "Choose image" });
  await picker.getByRole("button", { name: "Use touch", exact: true }).tap();
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
  await page.screenshot({
    path: testInfo.outputPath("cell-overlay-mobile.png"),
  });
  await context.close();
});

test("image source tabs fit narrow panels without category filters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 900 });
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
  const tabs = page.getByRole("tablist", { name: "Image source", exact: true });
  await expect(tabs.getByRole("tab")).toHaveText(["Imported", "Online"]);
  await expect(
    tabs.getByRole("tab", { name: "Imported", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    tabs.getByRole("tab", { name: "Online", exact: true }),
  ).toBeDisabled();
  const assertContained = async () => {
    await expect
      .poll(() =>
        tabs.evaluate((element) => {
          const panel = element.getBoundingClientRect();
          return [...element.querySelectorAll('[role="tab"]')].every((tab) => {
            const bounds = tab.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(tab);
            return (
              bounds.left >= panel.left - 1 &&
              bounds.right <= panel.right + 1 &&
              bounds.bottom <= panel.bottom + 1 &&
              range.getBoundingClientRect().right <= bounds.right + 1
            );
          });
        }),
      )
      .toBe(true);
  };
  await assertContained();
  await tabs.getByRole("tab", { name: "Imported", exact: true }).click();
  await expect(page.locator(".asset")).toHaveCount(9);
  const document = await savedWorkspace(page);
  document.assets.find((asset) => asset.category === "Imported").category =
    "ExtraordinarilyLongImportedCategory";
  await localDatabase(page, "write", document);
  await page.reload();
  await expect(tabs).toBeVisible();
  await assertContained();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertContained();
  const thumbnail = page
    .locator("#asset-library [data-library-thumbnail]")
    .first();
  await thumbnail.hover({ position: { x: 5, y: 50 } });
  const imageButton = page.locator("#asset-library .asset").first();
  await expect(imageButton).toHaveCSS("--frame-color", "#d8f36a");
  await imageButton.click({ position: { x: 5, y: 50 } });
  await expect(imageButton).toBeFocused();
  await expect(imageButton).toHaveCSS("outline-style", "none");
  await expect(thumbnail).toHaveCSS("box-shadow", "none");
  await page.keyboard.press("Tab");
  const keyboardFocus = page.locator("#asset-library .asset").nth(1);
  await expect(keyboardFocus).toBeFocused();
  await expect(keyboardFocus).toHaveCSS("outline-style", "none");
  await expect(keyboardFocus).toHaveCSS("--frame-color", "#d8f36a");
  const focusStyle = (element) => {
    const style = getComputedStyle(element, "::after");
    return {
      pattern: style.backgroundImage,
      size: style.backgroundSize,
      radius: style.borderRadius,
    };
  };
  const imageFocusStyle = await keyboardFocus.evaluate(focusStyle);
  const uploadFocus = page.locator("[data-upload-tile]");
  await page.mouse.move(1, 1);
  await imageButton.press("Escape");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await imageButton.press("Shift+Tab");
  await expect(uploadFocus).toBeFocused();
  await expect(uploadFocus).toHaveCSS("--frame-color", "#d8f36a");
  await expect
    .poll(() => uploadFocus.evaluate(focusStyle))
    .toEqual(imageFocusStyle);
  for (const width of [390, 714, 820]) {
    await page.setViewportSize({ width, height: 844 });
    const drawer = page.locator("[data-editor-drawer]");
    await expect(drawer).toHaveCSS("overflow-x", "hidden");
    await expect
      .poll(() =>
        drawer.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  const desktopImage = page.locator("#asset-library .asset").first();
  await expect(desktopImage.locator(".asset-name")).toBeVisible();
  await desktopImage.locator(".asset-name").hover();
  await expect(desktopImage).toHaveCSS("outline-style", "none");
  await expect(desktopImage).toHaveCSS("--frame-color", "#d8f36a");
  await page.mouse.move(1, 1);
  await desktopImage.press("Escape");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await desktopImage.press("Tab");
  const desktopFocus = page.locator("#asset-library .asset").nth(1);
  await expect(desktopFocus).toBeFocused();
  await expect(desktopFocus).toHaveCSS("outline-style", "none");
  expect(await desktopFocus.evaluate(focusStyle)).toEqual(imageFocusStyle);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("example loading is available only on localhost", async ({ page }) => {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Load example", exact: true }),
  ).toBeVisible();
  const exampleRequests = [];
  await page.route("https://grids.example/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("comics")) exampleRequests.push(url.pathname);
    const response = await route.fetch({
      url: `http://localhost:5840${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await page.goto("https://grids.example/tier-list/");
  await expect(page.locator("#board-grid")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load example", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Load example", exact: true }),
  ).toHaveCount(0);
  expect(exampleRequests).toEqual([]);
});

test("image imports show progress and keep the editor responsive through failed files", async ({
  page,
}, testInfo) => {
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
  ]);
  const add = page.getByRole("button", { name: "Add images", exact: true });
  const progress = add.getByRole("status");
  const library = page.getByRole("complementary", {
    name: "Image library drop zone",
    exact: true,
  });
  await expect(progress).toContainText("0 / 3");
  await expect(add).toBeDisabled();
  await expect(add).toHaveCSS("opacity", "1");
  await expect(library).toHaveAttribute("aria-busy", "true");
  await page.locator("#gap").fill("21");
  await expect(page.locator("#gap")).toHaveValue("21");
  await page.screenshot({
    path: testInfo.outputPath("import-progress-desktop.png"),
  });
  for (const completed of [0, 1, 2]) {
    await expect(progress).toContainText(`${completed} / 3`);
    await expect
      .poll(() => page.evaluate(() => window.pendingImageDecodes.length))
      .toBe(1);
    if (completed === 1) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(progress).toBeVisible();
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
  await expect(library).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(page.locator("#toast")).toContainText(
    "Could not load broken.svg",
  );
  await expect
    .poll(async () => (await localDatabase(page)).document?.assets.length)
    .toBe(2);
  expect((await localDatabase(page)).images).toHaveLength(2);
  expect((await savedWorkspace(page)).grid.gap).toBe(21);
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
  await expect(library).toHaveCSS("outline-width", "2px");
  await library.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  const cell = page.locator(".grid-cell").nth(1);
  await cell.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(cell).toHaveClass(/drag-over/);
  await cell.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(cell.locator("img")).toHaveCount(1);
  await expect(cell).not.toHaveClass(/drag-over/);
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
  expect((await addImages.boundingBox()).height).toBeGreaterThanOrEqual(140);
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
  await page
    .locator(".asset")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await page.locator(".cell-heading").first().fill("Keep this caption");
  await page.locator("#gap").fill("22");
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
  await expect(page.locator("#gap")).toHaveValue("22");
  await page
    .getByRole("button", { name: "Reset grid settings", exact: true })
    .click();
  await reset
    .getByRole("button", { name: "Reset settings", exact: true })
    .click();
  await expect(reset).toHaveCount(0);
  await expect(page.locator("#gap")).toHaveValue("12");
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await expect(page.locator(".cell-heading").first()).toHaveValue(
    "Keep this caption",
  );
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.cells[0].title)
    .toBe("Keep this caption");
  await savedWorkspace(page);
  const tileBox = await addImages.boundingBox();
  expect(Math.abs(tileBox.width - tileBox.height)).toBeLessThanOrEqual(1);
  await page
    .getByRole("button", { name: "Image options: used", exact: true })
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
  expect((await addImages.boundingBox()).height).toBeGreaterThanOrEqual(140);
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("clear-reset-library-cleanup-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("mobile library taps reveal delete and upload remains the first tile", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://localhost:5840/tier-list/");
  const add = page.getByRole("button", { name: "Add images", exact: true });
  expect((await add.boundingBox()).height).toBeGreaterThanOrEqual(140);
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
  expect(Math.abs(addBox.width - addBox.height)).toBeLessThanOrEqual(1);
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
  await page.locator(".asset").click();
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
  await expect(page.locator("#save-status")).toHaveText("Saved locally");
  await expect(other.locator("#save-status")).toHaveText("Saved locally");
  await page.evaluate(() => {
    const channel = new BroadcastChannel("grids-workspace-v1");
    channel.postMessage({ id: "guest", revision: crypto.randomUUID() });
    channel.postMessage({ id: "guest", revision: "invalid" });
    channel.close();
  });
  await other.clock.runFor(400);
  await expect(other.getByRole("alert")).toHaveCount(0);
  await other.locator("#cell-title").fill("Unsaved second tab");
  await expect(other.locator(".cell-heading").first()).toHaveValue(
    "Unsaved second tab",
  );
  await page.locator("#cell-title").fill("Saved elsewhere");
  await page.locator("#board-name").fill("First tab saved");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => (await localDatabase(page)).document.grid.name)
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
  await expect(other.locator("#cell-title")).toHaveValue("Unsaved second tab");
  await other.locator("#resolution").selectOption("150");
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
  await expect(other.locator("#board-name")).toHaveValue("First tab saved");
  await expect(other.locator("#cell-title")).toHaveValue("Saved elsewhere");
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
    await page.locator("#board-name").fill(`Saved before ${event}`);
    await expect
      .poll(async () => (await localDatabase(page)).document.grid.name)
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
    expect((await localDatabase(page)).document.grid.name).toBe(
      `Saved before ${event}`,
    );
    await other.close();
  }
});

test("unused-image trash survives reload, protects removed cells, and purges only after confirmation", async ({
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
  await page.locator(".asset").nth(0).click();
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await page.locator(".cell-image-button").nth(15).click();
  await page.locator(".asset").nth(1).click();
  await page.getByRole("button", { name: "Remove row", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove column", exact: true })
    .click();
  const original = await savedWorkspace(page);
  const unusedId = original.assets[2].id;
  const trigger = page.getByRole("button", {
    name: "Local storage",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Local storage" });
  await trigger.click();
  await dialog
    .getByRole("button", { name: "Move unused images to trash", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Trash (1)", exact: true }),
  ).toBeVisible();
  const trashed = await savedWorkspace(page);
  expect(
    trashed.assets
      .filter((asset) => asset.trashedAt !== undefined)
      .map((asset) => asset.id),
  ).toEqual([unusedId]);
  expect(trashed.grid).toEqual(original.grid);
  expect((await localDatabase(page)).images).toHaveLength(3);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await reloadWorkspace(page);
  await expect(page.locator(".asset")).toHaveCount(2);
  await trigger.click();
  const source = await dialog.locator("li img").getAttribute("src");
  await dialog
    .getByRole("button", { name: "Restore unused", exact: true })
    .click();
  await expect(page.locator(".asset")).toHaveCount(3);
  const restored = await savedWorkspace(page);
  expect(restored.assets[2].id).toBe(unusedId);
  await expect
    .poll(async () => (await localDatabase(page)).document.assets[2].trashedAt)
    .toBeUndefined();
  expect(
    await page.locator(".asset").nth(2).locator("img").getAttribute("src"),
  ).toBe(source);
  await dialog
    .getByRole("button", { name: "Move unused images to trash", exact: true })
    .click();
  await savedWorkspace(page);
  await expect(
    dialog.getByRole("button", { name: "Empty trash", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("trash-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("trash-mobile.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Empty trash", exact: true })
    .click();
  await expect(
    dialog.getByText("This cannot be undone.", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await localDatabase(page)).images).toHaveLength(3);
  await dialog
    .getByRole("button", { name: "Empty trash", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect
    .poll(async () => (await localDatabase(page)).document.assets.length)
    .toBe(2);
  const purged = await savedWorkspace(page);
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
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await reloadWorkspace(page);
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".cell-heading").nth(15)).toHaveValue("archived");
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
});

test("failed trash purge preserves stored metadata and blobs until the retry commits", async ({
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
  await savedWorkspace(page);
  await page
    .getByRole("button", { name: "Local storage", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Local storage" });
  await dialog
    .getByRole("button", { name: "Move unused images to trash", exact: true })
    .click();
  const source = await dialog.locator("li img").getAttribute("src");
  await expect
    .poll(async () => (await localDatabase(page)).document.assets[0].trashedAt)
    .toEqual(expect.any(Number));
  const original = await savedWorkspace(page);
  await page.evaluate(() => {
    window.failPurgeSave = true;
  });
  await dialog
    .getByRole("button", { name: "Empty trash", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Delete permanently", exact: true })
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
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator("#image-heading").fill("Retry purge");
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
  await expect(page.locator("#save-status")).toBeVisible();
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
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.locator("#gap").fill("23");
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.gap)
    .toBe(23);
  await reloadWorkspace(page);
  await expect(page.locator("#gap")).toHaveValue("23");
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
  await page.locator("#board-name").fill("Private collection");
  await page.locator("#image-heading").fill("Private banner");
  await page.locator("#cell-title").fill("Private caption");
  await page.locator("#resolution").selectOption("150");
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
  await expect(page.locator("#board-name")).toHaveValue("Private collection");
  await expect(page.locator("#image-heading")).toHaveValue("Private banner");
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
  await page.locator("#cell-title").fill("First edit");
  await page.locator("#cell-title").fill("Second edit");
  await page.locator("#cell-title").fill("Latest edit");
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
  await page.locator("#board-name").fill("Keep stored grid");
  const original = await savedWorkspace(page);
  await localDatabase(page, "delete-image", { id: original.assets[0].id });
  await reloadWorkspace(page);
  await expect(page.locator("#save-status")).toHaveText("Session only");
  await expect(page.locator("#toast")).toContainText(
    "stored grid has not been replaced",
  );
  await page.locator("#cell-title").fill("Session edit");
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
  const snapshot = await savedWorkspace(page);
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Load example" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await savedWorkspace(page)).toEqual(snapshot);
  await useComicExample(page);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".asset")).toHaveCount(9);
  await expect(page.locator("#image-heading")).toHaveValue("Team DC");
  await expect(page.locator(".grid-cell")).toHaveCount(4);
  const loaded = await savedWorkspace(page);
  expect(loaded.assets[0]).toEqual(snapshot.assets[0]);
  expect(new Set(loaded.assets.map((asset) => asset.id)).size).toBe(9);
  expect(loaded).not.toHaveProperty("boards");
  expect(loaded).not.toHaveProperty("active");
  expect(loaded.version).toBe(1);
  await reloadWorkspace(page);
  await expect(page.locator("#canvas-title")).toHaveText("DC Characters");
  await useComicExample(page, "marvel");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator(".asset")).toHaveCount(9);
  const repeated = await savedWorkspace(page);
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
    "none",
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
  await reloadWorkspace(page);
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

  await savedWorkspace(page);
  await localDatabase(page, "clear");
  await page.evaluate(() => localStorage.clear());
  await reloadWorkspace(page);
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
  await reloadWorkspace(page);
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
  await reloadWorkspace(page);
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
  await reloadWorkspace(page);
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
  await reloadWorkspace(page);
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
  await reloadWorkspace(page);
  await expect(page.locator("#image-heading")).toHaveValue("Custom banner");
  await expect(page.locator("#format")).toHaveValue("image/webp");
  await expect(page.locator("#resolution")).toHaveValue("300");
  await expect(page.locator("#quality")).toHaveValue("70");
  const original = await savedWorkspace(page);
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
  const reset = await savedWorkspace(page);
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
  await reloadWorkspace(page);
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
  await expect(page.locator("#toast")).toContainText("Local save failed");
  await page.locator("#replace-upload").setInputFiles({
    name: "retry.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator("#resolution").selectOption("150");
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
  await page.locator("#cell-title").fill("Recovered save");
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
  await page.locator("#replace-upload").setInputFiles({
    name: "session.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.locator("#resolution").selectOption("150");
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
  await expect(page.locator("#canvas-title")).toHaveText("Grid");
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
    await expect(page.locator("#canvas-title")).toHaveText("Grid");
  }
});

test("edge resizing preserves coordinates, selection, overflow and newer edits", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  const savedCells = async () => (await savedWorkspace(page)).grid.cells;
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
  const saved = await savedWorkspace(page);
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
  await localDatabase(page, "write", saved);
  await reloadWorkspace(page);
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
