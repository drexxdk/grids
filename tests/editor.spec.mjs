import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
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
}

async function selectField(page, id, value) {
  await page.locator(`#${id}`).click();
  await page.getByRole("listbox").locator(`[data-value="${value}"]`).click();
}

async function editHeading(page, value) {
  await page
    .getByRole("button", { name: "Edit grid heading", exact: true })
    .click();
  const heading = page.getByRole("textbox", {
    name: "Grid heading",
    exact: true,
  });
  await heading.fill(value);
  await heading.press("Enter");
}

async function chooseImage(page, name, index = 0) {
  await page
    .locator(".cell-image-button")
    .nth(index)
    .click({ position: { x: 5, y: 5 } });
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
  if (await page.locator(".grid-cell").nth(index).locator("img").count()) {
    await image.click({ position: { x: 5, y: 5 } });
    await page
      .getByRole("button", { name: "Replace image", exact: true })
      .click();
  } else await image.click({ position: { x: 5, y: 5 } });
  const dialog = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  if (await dialog.isVisible()) {
    return dialog.locator("#picker-cell-upload");
  }
  return page.locator("#replace-upload");
}

test("card content and actions scale with the card without resize undo", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  for (const dimension of ["row", "column"])
    for (let count = 0; count < 2; count++)
      await page
        .getByRole("button", { name: `Remove ${dimension}`, exact: true })
        .click();
  await expect(page.getByRole("button", { name: /Undo/ })).toHaveCount(0);
  const card = page.locator(".grid-cell").first();
  const emptyMetrics = [];
  for (const size of [
    { width: 390, height: 600 },
    { width: 1440, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        card.evaluate((element) => {
          const width = element
            .querySelector("[data-card-image]")
            .getBoundingClientRect().width;
          return Math.abs(
            parseFloat(
              getComputedStyle(element.querySelector(".empty-cell")).fontSize,
            ) /
              width -
              0.085,
          );
        }),
      )
      .toBeLessThan(0.001);
    const metrics = await card.evaluate((element) => {
      const placeholder = element.querySelector(".empty-cell");
      const width = element
        .querySelector("[data-card-image]")
        .getBoundingClientRect().width;
      return {
        width,
        icon: placeholder.querySelector("svg").getBoundingClientRect().width,
        gap: parseFloat(getComputedStyle(placeholder).gap),
        font: parseFloat(getComputedStyle(placeholder).fontSize),
        hint: parseFloat(
          getComputedStyle(placeholder.lastElementChild).fontSize,
        ),
      };
    });
    expect(metrics.icon / metrics.width).toBeCloseTo(0.18, 2);
    expect(metrics.gap / metrics.width).toBeCloseTo(0.03, 2);
    expect(metrics.hint / metrics.width).toBeCloseTo(0.07, 2);
    emptyMetrics.push(metrics);
    await card.screenshot({
      path: testInfo.outputPath(`empty-card-${size.width}.png`),
    });
  }
  expect(emptyMetrics[1].width).toBeGreaterThan(emptyMetrics[0].width * 1.5);
  await page.locator("#upload").setInputFiles({
    name: "Scale.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await chooseImage(page, "Scale");
  for (const size of [
    { width: 390, height: 600 },
    { width: 1440, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await card
      .locator(".cell-image-button")
      .hover({ position: { x: 15, y: 15 } });
    const tools = card.getByRole("group", { name: "Cell tools", exact: true });
    await expect(tools).toBeVisible();
    for (const button of await tools.getByRole("button").all()) {
      const metrics = await button.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const image = element
          .closest("[data-card-image]")
          .getBoundingClientRect();
        return {
          width: bounds.width,
          imageWidth: image.width,
          icon: element.querySelector("svg").getBoundingClientRect().width,
        };
      });
      expect(metrics.width / metrics.imageWidth).toBeCloseTo(0.25, 2);
      expect(metrics.icon / (metrics.width - 2)).toBeCloseTo(0.4, 1);
    }
    await card.screenshot({
      path: testInfo.outputPath(`filled-card-${size.width}.png`),
    });
    await expect(
      page.getByRole("button", { name: "Add row", exact: true }),
    ).toHaveCSS("width", "44px");
  }
  await card.getByRole("button", { name: "Crop image", exact: true }).click();
  const crop = page.getByRole("dialog", { name: "Crop image", exact: true });
  await expect(crop).toBeVisible();
  await crop.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(crop).toHaveCount(0);
});

test("canvas padding keeps overflow inside its viewport on short and narrow screens", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  for (const id of ["canvas-padding", "gap"]) {
    await expect(page.locator(`#${id}`)).toHaveValue("10");
    await expect(page.locator(`#${id}`)).toHaveAttribute("max", "20");
    await page.locator(`#${id}`).fill("20");
  }
  for (const size of [
    { width: 1440, height: 360 },
    { width: 960, height: 360 },
    { width: 390, height: 560 },
    { width: 260, height: 560 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const workspace = document.querySelector(".workspace");
          const canvas = document.querySelector(".canvas-area");
          const frame = document
            .querySelector("[data-resize-frame]")
            .getBoundingClientRect();
          const bounds = canvas.getBoundingClientRect();
          return (
            workspace.scrollHeight <= workspace.clientHeight + 1 &&
            workspace.scrollWidth <= workspace.clientWidth + 1 &&
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight + 1 &&
            frame.bottom <=
              bounds.bottom -
                parseFloat(getComputedStyle(canvas).paddingBottom) +
                1
          );
        }),
      )
      .toBe(true);
    const workspace = page.getByRole("region", {
      name: "Grid editor",
      exact: true,
    });
    await expect(workspace).toHaveCSS("overflow-y", "hidden");
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
  await expect(page.locator("#canvas-padding")).toHaveValue("20");
  await expect(page.locator("#gap")).toHaveValue("20");
});

test("canvas resizing commits fitted dimensions before the next paint", async ({
  page,
}) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  await savedWorkspace(page);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    window.resizeFrames = [];
    window.addEventListener("resize", () => {
      requestAnimationFrame(() => {
        const viewport = document.querySelector("[data-canvas-viewport]");
        window.resizeFrames.push({
          width: innerWidth,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
          horizontalOverflow: viewport.scrollWidth > viewport.clientWidth,
        });
      });
    });
  });
  for (const width of [1380, 1280, 1400, 1170, 1440, 1260, 1350, 1200, 1440]) {
    const count = await page.evaluate(() => window.resizeFrames.length);
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => window.resizeFrames.length))
      .toBeGreaterThan(count);
  }
  const frames = await page.evaluate(() => window.resizeFrames);
  expect(frames.length).toBeGreaterThanOrEqual(9);
  expect(
    frames.filter(
      (frame) =>
        frame.scrollHeight > frame.clientHeight || frame.horizontalOverflow,
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("canvas preview fits both row and column changes without resizing controls", async ({
  page,
}, testInfo) => {
  async function checkBounds(locator, expected) {
    await expect
      .poll(async () => {
        const actual = await locator.boundingBox();
        return Math.max(
          ...Object.keys(expected).map((key) =>
            Math.abs(actual[key] - expected[key]),
          ),
        );
      })
      .toBeLessThan(0.001);
  }
  async function checkCenters() {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const viewport = document.querySelector("[data-canvas-viewport]");
          const grid = viewport.getBoundingClientRect();
          const rows = document
            .querySelector('[aria-label="Row controls"]')
            .getBoundingClientRect();
          const columns = document
            .querySelector('[aria-label="Column controls"]')
            .getBoundingClientRect();
          const toolbar = document
            .querySelector('[aria-label="Grid appearance"] > div:last-child')
            .getBoundingClientRect();
          return Math.max(
            Math.abs(columns.left - grid.right - 8),
            Math.abs(rows.top - grid.bottom - 8),
            Math.abs(
              rows.x + rows.width / 2 - grid.x - viewport.clientWidth / 2,
            ),
            Math.abs(
              columns.y +
                columns.height / 2 -
                grid.y -
                viewport.clientHeight / 2,
            ),
            Math.abs(
              toolbar.x + toolbar.width / 2 - grid.x - viewport.clientWidth / 2,
            ),
          );
        }),
      )
      .toBeLessThan(1);
  }
  await page.goto("./");
  await page.locator(".cell-heading").first().fill("Keep caption");
  const original = await savedWorkspace(page);
  for (const viewport of [
    { width: 1900, height: 1000 },
    { width: 1440, height: 1000 },
    { width: 390, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page
          .locator("[data-resize-frame]")
          .evaluate(
            (frame) =>
              frame.getBoundingClientRect().bottom <=
              innerHeight -
                12 -
                (innerWidth <= 900
                  ? parseFloat(
                      getComputedStyle(
                        document.documentElement,
                      ).getPropertyValue("--editor-drawer-height"),
                    ) || 160
                  : 0) +
                2,
          ),
      )
      .toBe(true);
    const canvas = page.locator(".canvas-area");
    const workspace = page.getByRole("region", {
      name: "Grid editor",
      exact: true,
    });
    await expect(workspace).toHaveCSS("scrollbar-gutter", "auto");
    await expect
      .poll(() =>
        page.locator("[data-resize-frame]").evaluate((frame) => {
          const columns =
            getComputedStyle(frame).gridTemplateColumns.split(" ");
          return [columns[0], columns[2]];
        }),
      )
      .toEqual(["44px", "44px"]);
    await checkCenters();
    await expect
      .poll(async () => {
        const bounds = await canvas.boundingBox();
        const available = await workspace.evaluate((element) => ({
          width: element.clientWidth,
          height: element.clientHeight,
        }));
        return Math.max(
          Math.abs(bounds.width - available.width),
          Math.abs(bounds.height - available.height),
        );
      })
      .toBeLessThan(1);
    const before = await page.locator(".grid-cell").first().boundingBox();
    const columnControls = page.getByRole("group", {
      name: "Column controls",
      exact: true,
    });
    const rowControls = page.getByRole("group", {
      name: "Row controls",
      exact: true,
    });
    const controlPositions = {
      columns: await columnControls.boundingBox(),
      rows: await rowControls.boundingBox(),
      frame: await page.locator("[data-resize-frame]").boundingBox(),
    };
    const canvasBounds = await canvas.boundingBox();
    expect(
      Math.abs(
        controlPositions.frame.x +
          controlPositions.frame.width / 2 -
          canvasBounds.x -
          canvasBounds.width / 2,
      ),
    ).toBeLessThanOrEqual(8);
    if (viewport.width <= 900) {
      const drawer = page.locator("[data-editor-drawer]");
      await expect(drawer).toHaveCSS("border-top-left-radius", "0px");
      await expect(drawer).toHaveCSS("border-top-right-radius", "0px");
      await expect
        .poll(async () => {
          const sheet = await drawer.boundingBox();
          const bounds = await canvas.boundingBox();
          return Math.abs(bounds.y + bounds.height - sheet.y);
        })
        .toBeLessThanOrEqual(1.01);
      expect(Math.abs(canvasBounds.width - viewport.width)).toBeLessThan(1);
    }
    for (const dimension of ["row", "column"]) {
      await page
        .getByRole("button", { name: `Add ${dimension}`, exact: true })
        .click();
      await expect(page.locator(".grid-cell")).toHaveCount(12);
      if (before.width > 129) {
        await expect
          .poll(() =>
            page
              .locator(".grid-cell")
              .first()
              .evaluate((cell) => cell.getBoundingClientRect().width),
          )
          .toBeLessThanOrEqual(before.width + 0.1);
      } else {
        await expect
          .poll(() =>
            page
              .locator(".grid-cell")
              .first()
              .evaluate((cell) => cell.getBoundingClientRect().width),
          )
          .toBeGreaterThanOrEqual(127.9);
      }
      await expect
        .poll(() =>
          page
            .locator("[data-resize-frame]")
            .evaluate(
              (frame) =>
                frame.getBoundingClientRect().bottom <=
                innerHeight -
                  12 -
                  (innerWidth <= 900
                    ? parseFloat(
                        getComputedStyle(
                          document.documentElement,
                        ).getPropertyValue("--editor-drawer-height"),
                      ) || 160
                    : 0) +
                  2,
            ),
        )
        .toBe(true);
      await expect(page.locator(".cell-heading").first()).toHaveValue(
        "Keep caption",
      );
      const columns = await columnControls.boundingBox();
      expect(columns.width).toBeCloseTo(controlPositions.columns.width, 3);
      expect(columns.height).toBeCloseTo(controlPositions.columns.height, 3);
      await checkCenters();
      const rows = await rowControls.boundingBox();
      expect(rows.width).toBeCloseTo(controlPositions.rows.width, 3);
      expect(rows.height).toBeCloseTo(controlPositions.rows.height, 3);
      for (const [label, direction] of [
        ["Add row", "down"],
        ["Remove row", "up"],
        ["Add column", "right"],
        ["Remove column", "left"],
      ]) {
        const button = page.getByRole("button", { name: label, exact: true });
        const bounds = await button.boundingBox();
        expect(bounds.width).toBeCloseTo(44, 3);
        expect(bounds.height).toBeCloseTo(44, 3);
        await expect(button.locator(`.lucide-arrow-${direction}`)).toHaveCount(
          1,
        );
        await expect(button.locator("svg")).toHaveCount(1);
        for (const icon of await button.locator("svg").all()) {
          const iconBounds = await icon.boundingBox();
          expect(iconBounds.x).toBeGreaterThanOrEqual(bounds.x);
          expect(iconBounds.y).toBeGreaterThanOrEqual(bounds.y);
          expect(iconBounds.x + iconBounds.width).toBeLessThanOrEqual(
            bounds.x + bounds.width,
          );
          expect(iconBounds.y + iconBounds.height).toBeLessThanOrEqual(
            bounds.y + bounds.height,
          );
        }
      }
      await page.locator("[data-resize-frame]").screenshot({
        path: testInfo.outputPath(`fit-${dimension}-${viewport.width}.png`),
      });
      await expect(page.getByRole("button", { name: /Undo/ })).toHaveCount(0);
      await page
        .getByRole("button", { name: `Remove ${dimension}`, exact: true })
        .click();
      await expect(page.locator(".grid-cell")).toHaveCount(9);
      await checkBounds(columnControls, controlPositions.columns);
      await checkBounds(rowControls, controlPositions.rows);
      await expect
        .poll(() =>
          page
            .locator(".grid-cell")
            .first()
            .evaluate(
              (cell, width) =>
                Math.abs(cell.getBoundingClientRect().width - width),
              before.width,
            ),
        )
        .toBeLessThan(1);
      expect((await savedWorkspace(page)).grid.cells).toEqual(
        original.grid.cells,
      );
    }
    for (const [id, value] of [
      ["image-shape", "portrait"],
      ["image-shape", "landscape"],
      ["image-shape", "square"],
      ["caption-position", "above"],
      ["caption-position", "overlay-bottom"],
      ["caption-position", "below"],
    ]) {
      await selectField(page, id, value);
      await checkCenters();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const scroller = page.locator("[data-canvas-viewport]");
  await expect(
    page.locator("[data-canvas-viewport] .board-export-heading"),
  ).toHaveCount(0);
  const headingBounds = await page
    .locator(".board-export-heading")
    .boundingBox();
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
  expect(await page.locator(".board-export-heading").boundingBox()).toEqual(
    headingBounds,
  );
  await expect
    .poll(() =>
      page
        .locator(".cell-heading")
        .first()
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    )
    .toBeGreaterThanOrEqual(13.8);
});

test("desktop asides use 250px columns with stable edge scrollbars and modal alignment", async ({
  page,
}, testInfo) => {
  await page.goto("./");
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
    await page.setViewportSize({ width, height: 2000 });
    expect(
      await page
        .locator(".asset-library")
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(2);
    for (const selector of [".asset-panel", ".settings-panel"]) {
      const aside = page.locator(selector);
      await expect(aside).toHaveCSS("width", "250px");
      await expect(aside).toHaveCSS("height", "2000px");
      await expect(aside).toHaveCSS("overflow-y", "hidden");
      const body = aside.locator("[data-sidebar-content]");
      await expect(body).toHaveCSS("overflow-y", "auto");
      await expect(body).toHaveCSS("scrollbar-gutter", "stable");
      await expect(aside).toHaveCSS("direction", "ltr");
      await expect(aside.locator(":scope > div").first()).toHaveCSS(
        "direction",
        "ltr",
      );
      const header = aside.locator(":scope > div").first();
      const headerBounds = await header.boundingBox();
      const before = await body.evaluate((element) => {
        element.scrollTop = 0;
        const child = element.firstElementChild.getBoundingClientRect();
        return {
          x: child.x,
          width: child.width,
          height: element.getBoundingClientRect().height,
          overflowing: element.scrollHeight > element.clientHeight,
        };
      });
      expect(before.height).toBeGreaterThan(0);
      expect(before.height).toBeLessThan(2000);
      expect(before.overflowing).toBe(false);
      await body.evaluate((element) => {
        const spacer = document.createElement("div");
        spacer.dataset.scrollProbe = "";
        spacer.style.height = "3000px";
        element.append(spacer);
      });
      await expect
        .poll(() =>
          body.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        )
        .toBe(true);
      const after = await body.evaluate((element) => {
        const child = element.firstElementChild.getBoundingClientRect();
        return { x: child.x, width: child.width };
      });
      expect(after).toEqual({ x: before.x, width: before.width });
      const pageScroll = await page.evaluate(() => scrollY);
      await body.hover();
      await page.mouse.wheel(0, 160);
      await expect
        .poll(() => body.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
      expect(await header.boundingBox()).toEqual(headerBounds);
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
  const settingsBounds = await settings.boundingBox();
  expect(settingsBounds.x + settingsBounds.width).toBe(
    await page.evaluate(() => innerWidth),
  );
  const frameBounds = await page.locator("[data-resize-frame]").boundingBox();
  await page.locator("#export-grid-header").click();
  const dialog = page.getByRole("dialog", { name: "Export grid", exact: true });
  await expect(dialog).toBeVisible();
  expect(await settings.boundingBox()).toEqual(settingsBounds);
  expect(await page.locator("[data-resize-frame]").boundingBox()).toEqual(
    frameBounds,
  );
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(await settings.boundingBox()).toEqual(settingsBounds);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Expand tools", exact: true }).click();
  await expect(page.locator(".settings-panel")).toHaveCSS("direction", "ltr");
  await expect(page.locator(".settings-panel")).toHaveCSS(
    "scrollbar-gutter",
    "auto",
  );
});

test("font previews and independent weights persist and match exports without themes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    window.fontWeightDraws = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.fontWeightDraws.push({ text, font: this.font });
      return fillText.call(this, text, ...args);
    };
  });
  await page.goto("./");
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
    for (const font of ["Manrope", "Bangers", "Boogaloo", "Bebas Neue"]) {
      const option = page
        .getByRole("listbox")
        .locator(`[data-value="${font}"]`);
      await expect(option).toHaveCSS("font-size", "20px");
      await expect(option).toHaveCSS("padding-top", "0px");
      await expect(option).toHaveCSS("padding-bottom", "0px");
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
      await expect(page.locator(`#${id} span`)).toHaveCSS("font-size", "20px");
      await expect(page.locator(`#${id}`)).toHaveCSS("padding-top", "0px");
      await expect(page.locator(`#${id}`)).toHaveCSS("padding-bottom", "0px");
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
      await expect(weight).toHaveAttribute(
        "min",
        font === "Manrope" ? "100" : "400",
      );
      await expect(weight).toHaveAttribute(
        "max",
        font === "Manrope" ? "900" : "700",
      );
      await expect(weight).toHaveAttribute(
        "step",
        font === "Manrope" ? "100" : "300",
      );
      await expect(weight).toHaveValue("400");
      await weight.press("ArrowRight");
      await expect(weight).toHaveValue(font === "Manrope" ? "500" : "700");
      await weight.press("ArrowLeft");
      await expect(weight).toHaveValue("400");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    }
  }
  await page.locator("#heading-font-weight").press("End");
  await page.locator("#heading-font-weight").press("ArrowLeft");
  await selectField(page, "heading-font", "Bangers");
  await expect(page.locator("#heading-font-weight")).toHaveValue("700");
  await expect(page.locator("#heading-font-weight")).toHaveAttribute(
    "aria-valuetext",
    "Bold",
  );
  await selectField(page, "heading-font", "Manrope");
  await expect(page.locator("#heading-font-weight")).toHaveAttribute(
    "max",
    "900",
  );
  await page.locator("#heading-font-weight").press("End");
  await page.locator("#heading-font-weight").press("ArrowLeft");
  await expect(page.locator("#heading-font-weight")).toHaveValue("800");
  await page.locator("#cell-font-weight").fill("700");
  await page
    .getByRole("button", { name: "Edit grid heading", exact: true })
    .click();
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
  await expect(page.locator("#heading-font-weight")).toHaveValue("800");
  await expect(page.locator("#heading-font-weight")).toHaveAttribute(
    "aria-valuetext",
    "Extra bold",
  );
  await expect(page.locator("#cell-font-weight")).toHaveValue("700");
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Expand tools", exact: true }).click();
  await page.locator("#cell-font-weight").fill("600");
  await expect(page.locator("#board-grid .cell-heading").first()).toHaveCSS(
    "font-weight",
    "600",
  );
  await page.locator("#cell-font-weight").fill("700");
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
  await page
    .getByRole("button", { name: "Edit grid heading", exact: true })
    .click();
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
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await expect(
    page.getByRole("group", { name: "Heading style", exact: true }),
  ).toContainText("Font");
  await expect(
    page.getByRole("group", { name: "Card style", exact: true }),
  ).toContainText("Font");
  await selectField(page, "heading-font", "Bebas Neue");
  await page.locator("#heading-font-size").fill("30");
  const headingHex = page
    .getByRole("group", { name: "Heading style", exact: true })
    .getByRole("textbox", { name: "Text color hex value", exact: true });
  await headingHex.fill("#cc4488");
  await headingHex.press("Tab");
  await expect(page.locator(".cell-heading").first()).toHaveCSS(
    "color",
    "rgb(244, 244, 239)",
  );
  await selectField(page, "cell-font", "Boogaloo");
  await page.locator("#cell-font-size").fill("24");
  const cardHex = page
    .getByRole("group", { name: "Card style", exact: true })
    .getByRole("textbox", { name: "Text color hex value", exact: true });
  await cardHex.fill("#39a36f");
  await cardHex.press("Tab");
  const verify = async () => {
    await expect(
      page.getByRole("button", { name: "Edit grid heading", exact: true }),
    ).toHaveCSS("color", "rgb(204, 68, 136)");
    await expect(
      page.getByRole("button", { name: "Edit grid heading", exact: true }),
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
    await page.setViewportSize({ width, height: 1000 });
    await verify();
    if (width <= 900)
      await page
        .getByRole("button", { name: "Expand tools", exact: true })
        .click();
    const sectionColors = [];
    for (const name of ["Canvas style", "Heading style", "Card style"]) {
      const section = page.getByRole("group", { name, exact: true });
      await expect(section).toHaveCSS("border-top-width", "1px");
      await expect(section).toHaveCSS("border-radius", "6px");
      sectionColors.push(
        await section.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      );
    }
    expect(new Set(sectionColors).size).toBe(3);
    for (const name of ["Heading style", "Card style"]) {
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
  await expect(page.locator("#cell-font-size")).toHaveValue("24");
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

test("empty headings use faded inline placeholders and reserve no export bands", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#gap").fill("2");
  await page.locator("#canvas-padding").fill("2");
  await selectField(page, "image-shape", "square");
  await page.locator("#upload").setInputFiles({
    name: "Original.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
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
    await page.setViewportSize({ width, height: 1000 });
    await page.locator("#export-grid-header").focus();
    await page.mouse.move(1, 1);
    const trigger = page.getByRole("button", {
      name: "Edit grid heading",
      exact: true,
    });
    const placeholder = trigger.locator("[data-heading-placeholder]");
    await expect(placeholder).toHaveText("Add heading");
    await expect(placeholder).toHaveCSS("opacity", "0.35");
    await trigger.hover();
    await expect(placeholder).toHaveCSS("opacity", "0.8");
    for (const selector of width > 900
      ? [".cell-heading", ".asset-name"]
      : [".cell-heading"]) {
      const field = page.locator(selector).first();
      await expect(field).toHaveAttribute("placeholder", "Add heading");
      await page.mouse.move(1, 1);
      await expect
        .poll(() =>
          field.evaluate(
            (element) => getComputedStyle(element, "::placeholder").color,
          ),
        )
        .toMatch(/(?:, |\/ )0\.35\)$/);
      await field.hover();
      await expect
        .poll(() =>
          field.evaluate(
            (element) => getComputedStyle(element, "::placeholder").color,
          ),
        )
        .toMatch(/(?:, |\/ )0\.8\)$/);
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
  expect(await exportSize()).toEqual({ width: 462, height: 497 });
  await page.locator(".cell-heading").first().fill("");
  await page
    .getByRole("button", { name: "Edit grid heading", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Team");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  expect(await exportSize()).toEqual({ width: 462, height: 507 });
  await page.locator(".cell-heading").first().fill("Filled");
  expect(await exportSize()).toEqual({ width: 462, height: 542 });
});

test("grid heading uses text-field hover and inline editing on desktop and mobile", async ({
  page,
}, testInfo) => {
  async function checkHeadingSurface(trigger) {
    const heading = page.locator(".board-export-heading");
    const headingBounds = await heading.boundingBox();
    const fieldBounds = await trigger.boundingBox();
    const viewport = page.locator("[data-canvas-viewport]");
    const firstCellBounds = await page
      .locator(".grid-cell")
      .first()
      .boundingBox();
    const canvasInset = await page
      .locator("#board-grid")
      .evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft));
    expect(Math.abs(headingBounds.x - firstCellBounds.x)).toBeLessThan(1);
    expect(
      Math.abs(
        headingBounds.width -
          (await viewport.evaluate((element) => element.clientWidth)) +
          2 * canvasInset,
      ),
    ).toBeLessThan(1);
    if (
      await viewport.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      )
    ) {
      const lastCellBounds = await page
        .locator(".grid-cell")
        .nth(2)
        .boundingBox();
      expect(
        Math.abs(
          headingBounds.x +
            headingBounds.width -
            lastCellBounds.x -
            lastCellBounds.width,
        ),
      ).toBeLessThan(1);
    }
    expect(fieldBounds).toEqual(headingBounds);
    for (const offset of [1, headingBounds.width - 1]) {
      await page.mouse.move(1, 1);
      await page.mouse.move(
        headingBounds.x + offset,
        headingBounds.y + headingBounds.height / 2,
      );
      await expect(trigger).toHaveCSS("background-color", /(?:, |\/ )0\.08\)$/);
    }
  }
  await page.goto("./");
  await page
    .getByRole("button", { name: "Edit grid heading", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .fill("Team DC");
  await page
    .getByRole("textbox", { name: "Grid heading", exact: true })
    .press("Enter");
  for (const { width, height } of [
    { width: 1440, height: 844 },
    { width: 960, height: 844 },
    { width: 390, height: 844 },
    { width: 1440, height: 360 },
  ]) {
    await page.setViewportSize({ width, height });
    if (height === 360) {
      await expect
        .poll(() =>
          page
            .locator("[data-canvas-viewport]")
            .evaluate((element) => element.scrollHeight > element.clientHeight),
        )
        .toBe(true);
    }
    const trigger = page.getByRole("button", {
      name: "Edit grid heading",
      exact: true,
    });
    await page.mouse.move(1, 1);
    const bounds = await trigger.boundingBox();
    await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await checkHeadingSurface(trigger);
    await trigger.hover();
    await expect(trigger).toHaveCSS("cursor", "text");
    await expect(trigger).toHaveCSS("background-color", /(?:, |\/ )0\.08\)$/);
    await expect(trigger).toHaveCSS("border-top-width", "0px");
    await expect(trigger).toHaveCSS("border-radius", "0px");
    await expect(trigger).toHaveCSS("outline-style", "none");
    expect(await trigger.boundingBox()).toEqual(bounds);
    await page.locator(".board-export-heading").screenshot({
      path: testInfo.outputPath(`heading-text-hover-${width}.png`),
    });
    await trigger.click();
    const field = page.getByRole("textbox", {
      name: "Grid heading",
      exact: true,
    });
    await expect(field).toBeFocused();
    await expect(field).toHaveCSS("cursor", "text");
    await expect(field).toHaveCSS("background-color", /(?:, |\/ )0\.12\)$/);
    await expect(field).toHaveCSS("border-top-width", "0px");
    await expect(field).toHaveCSS("outline-style", "none");
    const editingBounds = await field.boundingBox();
    expect(editingBounds.width).toBeCloseTo(bounds.width, 1);
    expect(editingBounds.height).toBeCloseTo(bounds.height, 1);
    await field.fill("Team DC edited");
    await field.press("Escape");
    await expect(trigger).toHaveText("Team DC edited");
    await trigger.focus();
    await expect(trigger).toHaveCSS("background-color", /(?:, |\/ )0\.12\)$/);
    await trigger.press("Enter");
    await expect(field).toBeFocused();
    await field.fill("Team DC");
    await field.press("Enter");
    await trigger.click();
    await field.fill("");
    await field.press("Enter");
    await expect(trigger).toHaveText("Add heading");
    await checkHeadingSurface(trigger);
    await page.locator(".board-export-heading").screenshot({
      path: testInfo.outputPath(`empty-heading-edge-hover-${width}.png`),
    });
    await trigger.click();
    expect(await field.boundingBox()).toEqual(
      await page.locator(".board-export-heading").boundingBox(),
    );
    await field.fill("Team DC");
    await field.press("Enter");
  }
});

test("button groups join edges with single dividers and outer-only corners", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await savedWorkspace(page);
  const activeBackground = await page
    .getByRole("tab", { name: "Imported", exact: true })
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await selectField(page, "caption-position", "overlay-bottom");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".grid-cell").first()).toHaveCSS(
      "background-color",
      "rgb(17, 19, 21)",
    );
    const background = "rgb(17, 19, 21)";
    for (const label of ["Column controls", "Row controls"]) {
      const group = page.getByRole("group", { name: label, exact: true });
      await expect(group).toHaveCSS("gap", "0px");
      const vertical = label === "Column controls";
      const buttons = await group.locator("button").evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            x: rect.x,
            y: rect.y,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            background: style.backgroundColor,
            active: element.getAttribute("aria-pressed") === "true",
            corners: [
              style.borderTopLeftRadius,
              style.borderTopRightRadius,
              style.borderBottomRightRadius,
              style.borderBottomLeftRadius,
            ],
            left: parseFloat(style.borderLeftWidth),
            rightBorder: parseFloat(style.borderRightWidth),
            top: parseFloat(style.borderTopWidth),
            bottomBorder: parseFloat(style.borderBottomWidth),
          };
        }),
      );
      for (const [index, button] of buttons.entries()) {
        expect(button.width).toBe(44);
        expect(button.height).toBe(44);
        expect(button.background).toBe(
          button.active ? activeBackground : background,
        );
        const first = index === 0;
        const last = index === buttons.length - 1;
        expect(button.corners).toEqual(
          vertical
            ? [
                first ? "6px" : "0px",
                first ? "6px" : "0px",
                last ? "6px" : "0px",
                last ? "6px" : "0px",
              ]
            : [
                first ? "6px" : "0px",
                last ? "6px" : "0px",
                last ? "6px" : "0px",
                first ? "6px" : "0px",
              ],
        );
        if (index > 0) {
          const previous = buttons[index - 1];
          expect(
            vertical ? button.y - previous.bottom : button.x - previous.right,
          ).toBeCloseTo(-1, 1);
          expect(
            vertical
              ? previous.bottomBorder + button.top
              : previous.rightBorder + button.left,
          ).toBe(2);
        }
        const control = group.locator("button").nth(index);
        await control.hover();
        for (const edge of ["top", "right", "bottom", "left"]) {
          await expect(control).toHaveCSS(`border-${edge}-width`, "1px");
          await expect(control).toHaveCSS(
            `border-${edge}-color`,
            button.active ? "rgb(48, 51, 53)" : "rgb(216, 243, 106)",
          );
        }
        const screenshot = await control.screenshot();
        const borders = await page.evaluate(
          async (bytes) => {
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(bytes)], { type: "image/png" }),
            );
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            const bands = [
              [6, 0, canvas.width - 12, 2],
              [canvas.width - 2, 6, 2, canvas.height - 12],
              [6, canvas.height - 2, canvas.width - 12, 2],
              [0, 6, 2, canvas.height - 12],
            ];
            const result = bands.map((band) => {
              const pixels = context.getImageData(...band).data;
              return Array.from(
                { length: pixels.length / 4 },
                (_, pixel) =>
                  pixels[pixel * 4] > 70 &&
                  pixels[pixel * 4 + 1] > 100 &&
                  pixels[pixel * 4 + 1] > pixels[pixel * 4] + 12,
              ).some(Boolean);
            });
            bitmap.close();
            return result;
          },
          [...screenshot],
        );
        expect(borders).toEqual(
          button.active
            ? [false, false, false, false]
            : [true, true, true, true],
        );
        await expect(control).toHaveCSS(
          "cursor",
          button.active ? "default" : "pointer",
        );
        await expect(control).toHaveCSS(
          "background-color",
          button.active ? activeBackground : background,
        );
        if (index === 1)
          await group.screenshot({
            path: testInfo.outputPath(
              `hover-group-${width}-${label.replaceAll(" ", "-")}.png`,
            ),
          });
      }
    }
    await selectField(page, "image-shape", "landscape");
    await expect(page.locator("#image-shape")).toHaveText("Landscape");
    await page.getByRole("button", { name: "Add column", exact: true }).click();
    await page
      .getByRole("button", { name: "Remove column", exact: true })
      .click();
    await expect(page.locator(".grid-cell")).toHaveCount(9);
    await page.screenshot({
      path: testInfo.outputPath(`joined-button-groups-${width}.png`),
    });
  }
});

test("canvas controls align with the grid and sidebar headers stay fixed", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await useComicExample(page);
  for (const width of [1440, 960, 780, 390, 320]) {
    await page.setViewportSize({ width, height: 600 });
    const toolbar = page.getByRole("toolbar", { name: "Grid appearance" });
    const frame = page.locator("[data-resize-frame]");
    const trigger = page.getByRole("button", {
      name: "Export grid",
      exact: true,
    });
    await expect(page.locator(".app-header")).toHaveCount(0);
    await expect(trigger).toHaveCount(1);
    await expect
      .poll(async () => {
        const controls = await toolbar.boundingBox();
        const grid = await frame.boundingBox();
        if (!controls || !grid) return Infinity;
        return Math.max(
          Math.abs(controls.x - grid.x),
          Math.abs(controls.width - grid.width),
        );
      })
      .toBeLessThan(1);
    if (width > 900) {
      for (const selector of [".asset-panel", ".settings-panel"]) {
        const aside = page.locator(selector);
        const header = aside.locator("[data-sidebar-header]");
        const before = await header.boundingBox();
        expect((await aside.boundingBox()).y).toBe(0);
        expect((await aside.boundingBox()).height).toBe(600);
        const scroller = aside.locator("[data-sidebar-content]");
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
      const controls = await toolbar.boundingBox();
      const button = await trigger.boundingBox();
      expect(button.width).toBe(44);
      expect(button.height).toBe(44);
      expect(Math.abs(button.y - controls.y)).toBeLessThan(1);
      expect(
        Math.abs(button.x + button.width - controls.x - controls.width),
      ).toBeLessThan(1);
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
  await chooseImage(page, "Keep this caption", 1);
  await expect(page.locator(".grid-cell img")).toHaveCount(2);
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
  await page.setViewportSize({ width: 960, height: 1080 });
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

test("caption hover and focus are distinct without changing field geometry", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await selectField(page, "caption-position", "above");
  await page.locator("#upload").setInputFiles({
    name: "Feedback.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  for (const position of ["above", "below", "overlay-top", "overlay-bottom"]) {
    await selectField(page, "caption-position", position);
    for (const selector of [".grid-cell", ".asset"]) {
      const card = page.locator(selector).first();
      const field = card.locator("textarea");
      const feedback = card.locator("[data-caption-feedback]");
      await page.mouse.move(0, 0);
      const idleColor = await field.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      const before = await field.boundingBox();
      await field.hover();
      await expect(feedback).toHaveCSS("border-top-width", "1px");
      await expect(feedback).toHaveCSS(
        "border-top-color",
        /^(?:rgba\(255, 255, 255, 0\.6\)|oklab\(0\.999994 .* \/ 0\.6\))$/,
      );
      await expect(feedback).toHaveCSS("pointer-events", "none");
      const frame = await feedback.boundingBox();
      const inset = frame.x - before.x;
      expect(inset).toBeGreaterThanOrEqual(3);
      expect(frame.y - before.y).toBeCloseTo(inset, 1);
      expect(before.width - frame.width).toBeCloseTo(2 * inset, 1);
      expect(before.height - frame.height).toBeCloseTo(2 * inset, 1);
      const cardRadius = await card.evaluate((element) =>
        parseFloat(getComputedStyle(element).borderTopLeftRadius),
      );
      const outerCorner =
        position.endsWith("top") || position === "above"
          ? "borderTopLeftRadius"
          : "borderBottomLeftRadius";
      const innerCorner =
        outerCorner === "borderTopLeftRadius"
          ? "borderBottomLeftRadius"
          : "borderTopLeftRadius";
      expect(
        await feedback.evaluate(
          (element, corner) => parseFloat(getComputedStyle(element)[corner]),
          outerCorner,
        ),
      ).toBeCloseTo(Math.max(0, cardRadius - 1 - inset), 1);
      await expect(feedback).toHaveCSS(
        innerCorner.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        "0px",
      );
      const hoverColor = await field.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(hoverColor).toBe(idleColor);
      await field.click();
      await expect(field).toBeFocused();
      await expect(feedback).toHaveCSS("border-top-width", "2px");
      await expect(feedback).toHaveCSS(
        "border-top-color",
        "rgb(216, 243, 106)",
      );
      const focusColor = await field.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      expect(focusColor).toBe(idleColor);
      await expect(card.locator("[data-cell-image-frame]")).toHaveCSS(
        "--frame-color",
        "transparent",
      );
      const after = await field.boundingBox();
      for (const dimension of ["x", "y", "width", "height"])
        expect(after[dimension]).toBeCloseTo(before[dimension], 2);
      if (position === "overlay-bottom")
        await card.screenshot({
          path: testInfo.outputPath(`caption-focus-${selector.slice(1)}.png`),
        });
      await field.press("Tab");
    }
  }
});

test("hovering another header clears the previous card outline without moving focus", async ({
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
    await page.setViewportSize({ width, height: 1080 });
    if (expanded)
      await page
        .getByRole("button", { name: "Expand tools", exact: true })
        .click();
    await selectField(page, "caption-position", "above");
    for (const selector of width > 900
      ? [".grid-cell", ".asset"]
      : [".grid-cell"]) {
      const cards = page.locator(selector);
      const image = cards.nth(0).locator("[data-card-image] > button");
      const header = cards.nth(1).locator("textarea");
      const firstFrame = cards.nth(0).locator("[data-cell-image-frame]");
      const secondFrame = cards.nth(1).locator("[data-cell-image-frame]");
      await header.click();
      await image.hover({ position: { x: 5, y: 5 } });
      await expect(firstFrame).toHaveCSS("--frame-color", "#d8f36a");
      await expect(header).toBeFocused();
      await expect(image).not.toBeFocused();
      await header.hover();
      await expect(firstFrame).toHaveCSS("--frame-color", "transparent");
      await expect(secondFrame).toHaveCSS("--frame-color", "transparent");
      await expect(header).toBeFocused();
      await image.focus();
      await image.press("Enter");
      await expect(
        cards.nth(0).getByRole("group", { name: "Cell tools", exact: true }),
      ).toBeVisible();
      await expect(firstFrame).toHaveCSS("--frame-color", "#d8f36a");
      await image.press("Escape");
      await header.click();
      await expect(firstFrame).toHaveCSS("--frame-color", "transparent");
    }
  }
});

test("movable cards show a move cursor without changing editing and action cursors", async ({
  page,
}) => {
  await page.goto("./");
  await selectField(page, "caption-position", "below");
  await page.locator("#upload").setInputFiles(
    ["One", "Two"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
      ),
    })),
  );
  await chooseImage(page, "One", 0);
  await chooseImage(page, "Two", 1);
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
    const movable = page.locator('[draggable="true"]');
    await expect(movable).toHaveCount(width > 900 ? 4 : 2);
    for (const image of await movable.all())
      await expect(image).toHaveCSS("cursor", "move");
    await expect(
      page.locator(".grid-cell").nth(2).locator(".cell-image-button"),
    ).toHaveCSS("cursor", "pointer");
    for (const caption of await page.locator(".image-card textarea").all())
      await expect(caption).not.toHaveCSS("cursor", "move");
    const visibleImages = movable;
    for (const image of await visibleImages.all()) {
      await image.hover({ position: { x: 5, y: 5 } });
      await expect(image).toHaveCSS("cursor", "move");
      const tools = image
        .locator('xpath=ancestor::*[contains(@class,"image-card")]')
        .getByRole("group", { name: "Cell tools", exact: true });
      await expect(tools).toBeVisible();
      for (const action of await tools.locator("button").all())
        await expect(action).toHaveCSS("cursor", "pointer");
    }
  }
});

test("drag feedback keeps stationary contents and suppresses source hover while the lifted copy stays opaque", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles(
    ["Red", "Blue"].map((name) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${name === "Red" ? "#ff0000" : "#0000ff"}"/></svg>`,
      ),
    })),
  );
  await chooseImage(page, "Red", 0);
  await chooseImage(page, "Blue", 1);
  for (const width of [1440, 780]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const placement of [
      "above",
      "below",
      "overlay-top",
      "overlay-bottom",
    ]) {
      await selectField(page, "caption-position", placement);
      await expect
        .poll(
          async () =>
            (await localDatabase(page)).document?.grid.captionPlacement,
        )
        .toBe(placement.startsWith("overlay") ? "overlay" : placement);
      const original = await savedWorkspace(page);
      const cells = page.locator(".grid-cell");
      const source = cells.nth(0).locator(".cell-image-button");
      const contents = () =>
        cells.evaluateAll((elements) =>
          elements.map((element) => ({
            title: element.querySelector("textarea").value,
            image: element.querySelector("img")?.getAttribute("src") ?? null,
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
          })),
        );
      const before = await contents();
      const sourceBounds = await source.boundingBox();
      await source.hover({ position: { x: 8, y: sourceBounds.height / 2 } });
      const sourceFrame = cells
        .nth(0)
        .locator(":scope > [data-cell-image-frame]");
      await expect(sourceFrame).toHaveCSS("--frame-color", "#d8f36a");
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await source.dispatchEvent("dragstart", {
        dataTransfer: transfer,
        clientX: 10,
        clientY: 10,
      });
      const floating = page.locator("[data-drag-floating]");
      await expect(floating).toHaveCSS("opacity", "1");
      await expect(floating.locator(".drag-preview-heading")).toHaveValue(
        "Red",
      );
      await expect(floating.locator(".drag-preview-heading")).toHaveCSS(
        "resize",
        "none",
      );
      await expect(
        cells.nth(0).locator(":scope > [data-card-content]"),
      ).toHaveCSS("opacity", "0.35");
      await expect(
        cells.nth(0).locator(":scope > [data-card-content]"),
      ).toHaveCSS("clip-path", "none");
      await expect(sourceFrame).toHaveCSS("--frame-color", "transparent");
      await expect(cells.nth(0)).toHaveCSS(
        "border-top-color",
        "rgb(48, 51, 53)",
      );
      await expect(cells.nth(0).locator(".empty-cell")).toHaveCount(0);
      await expect(page.locator("[data-drag-preview]")).toHaveCount(0);
      expect(await contents()).toEqual(before);
      await cells.nth(2).dispatchEvent("dragover", {
        dataTransfer: transfer,
        clientX: 10,
        clientY: 10,
      });
      await expect(
        cells.nth(2).locator(":scope > [data-card-content]"),
      ).toHaveCSS("opacity", "0.35");
      await expect(cells.nth(2)).toHaveCSS("opacity", "1");
      await expect(cells.nth(2)).toHaveCSS("outline-style", "none");
      await expect(
        cells.nth(2).locator(":scope > [data-card-content]"),
      ).toHaveCSS("mask-image", /linear-gradient/);
      await expect(cells.nth(2)).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      expect(
        await cells.nth(2).evaluate((element) => {
          const border = getComputedStyle(element, "::after");
          return [
            Math.abs(
              parseFloat(border.borderTopWidth) -
                (element.getBoundingClientRect().width - 2) * 0.01,
            ) < 1,
            border.borderTopStyle,
            border.borderTopColor,
            border.zIndex,
          ];
        }),
      ).toEqual([true, "solid", "rgb(128, 202, 177)", "60"]);
      await expect(cells.nth(2).locator(".empty-cell")).toHaveCount(1);
      expect(await contents()).toEqual(before);
      await cells.nth(2).dispatchEvent("dragleave", { dataTransfer: transfer });
      await expect(cells.nth(2)).not.toHaveClass(/drag-over/);
      await cells.nth(1).dispatchEvent("dragover", {
        dataTransfer: transfer,
        clientX: 10,
        clientY: 10,
      });
      await expect(
        cells.nth(0).locator(":scope > [data-card-content]"),
      ).toHaveCSS("opacity", "0.35");
      await expect(
        cells.nth(1).locator(":scope > [data-card-content]"),
      ).toHaveCSS("opacity", "0.35");
      await expect(cells.nth(1)).toHaveCSS("opacity", "1");
      await expect(cells.nth(1)).toHaveClass(/drag-over/);
      await expect(
        cells.nth(2).locator(":scope > [data-card-content]"),
      ).toHaveCSS("opacity", "1");
      await expect(page.locator("[data-drag-affected]")).toHaveCount(2);
      expect(await contents()).toEqual(before);
      await expect(sourceFrame).toHaveCSS("--frame-color", "transparent");
      expect((await localDatabase(page)).document).toEqual(original);
      await page.screenshot({
        path: testInfo.outputPath(`faded-cards-${width}-${placement}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(
        page.locator(
          "[data-drag-affected], [data-drag-floating], .image-card.drag-over",
        ),
      ).toHaveCount(0);
      for (const card of await cells.all())
        await expect(card.locator("[data-card-content]")).toHaveCSS(
          "opacity",
          "1",
        );
      expect(await contents()).toEqual(before);
      expect((await localDatabase(page)).document).toEqual(original);
      await transfer.dispose();
    }
  }
  const cells = page.locator(".grid-cell");
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await cells.nth(0).locator(".cell-image-button").dispatchEvent("dragstart", {
    dataTransfer: transfer,
    clientX: 10,
    clientY: 10,
  });
  await cells.nth(1).dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientX: 10,
    clientY: 10,
  });
  await expect(cells.nth(0).locator(".cell-heading")).toHaveValue("Red");
  await expect(cells.nth(1).locator(".cell-heading")).toHaveValue("Blue");
  await cells.nth(1).dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.locator(
      "[data-drag-affected], [data-drag-floating], .image-card.drag-over",
    ),
  ).toHaveCount(0);
  await expect(cells.nth(0).locator(".cell-heading")).toHaveValue("Blue");
  await expect(cells.nth(1).locator(".cell-heading")).toHaveValue("Red");
  await expect
    .poll(async () => (await localDatabase(page)).document.grid.cells[1].title)
    .toBe("Red");
  await transfer.dispose();
  const copied = await savedWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 1080 });
  const library = page.locator(".asset").first();
  const copyTransfer = await page.evaluateHandle(() => new DataTransfer());
  await library.locator("[data-library-thumbnail]").dispatchEvent("dragstart", {
    dataTransfer: copyTransfer,
    clientX: 10,
    clientY: 10,
  });
  await cells.nth(2).dispatchEvent("dragover", {
    dataTransfer: copyTransfer,
    clientX: 10,
    clientY: 10,
  });
  await expect(library.locator("[data-card-content]")).toHaveCSS(
    "opacity",
    "0.35",
  );
  await expect(cells.nth(2).locator(":scope > [data-card-content]")).toHaveCSS(
    "opacity",
    "0.35",
  );
  await expect(cells.nth(2)).toHaveCSS("opacity", "1");
  await expect(cells.nth(2)).toHaveClass(/drag-over/);
  await expect(page.locator("[data-drag-floating]")).toHaveCSS("opacity", "1");
  await expect(library.locator(".library-heading")).toHaveValue("Red");
  await expect(library.locator(":scope > [data-cell-image-frame]")).toHaveCSS(
    "--frame-color",
    "transparent",
  );
  await expect(cells.nth(2).locator(".empty-cell")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(
    page.locator(
      "[data-drag-affected], [data-drag-floating], .image-card.drag-over",
    ),
  ).toHaveCount(0);
  expect((await localDatabase(page)).document).toEqual(copied);
  await copyTransfer.dispose();
  for (const [sourceIndex, targetIndex] of [
    [0, 2],
    [2, 1],
  ]) {
    const recoveredTransfer = await page.evaluateHandle(
      () => new DataTransfer(),
    );
    await cells
      .nth(sourceIndex)
      .locator(".cell-image-button")
      .dispatchEvent("dragstart", {
        dataTransfer: recoveredTransfer,
        clientX: 10,
        clientY: 10,
      });
    await cells
      .nth(targetIndex)
      .dispatchEvent("dragover", { dataTransfer: recoveredTransfer });
    await recoveredTransfer.evaluate((transfer) => transfer.clearData());
    await cells
      .nth(targetIndex)
      .dispatchEvent("drop", { dataTransfer: recoveredTransfer });
    await expect(cells.nth(targetIndex).locator(".cell-heading")).toHaveValue(
      "Blue",
    );
    await expect(cells.nth(sourceIndex).locator(".cell-heading")).toHaveValue(
      targetIndex === 2 ? "" : "Red",
    );
    await recoveredTransfer.dispose();
  }
  const recoveredCopy = await page.evaluateHandle(() => new DataTransfer());
  await library.locator("[data-library-thumbnail]").dispatchEvent("dragstart", {
    dataTransfer: recoveredCopy,
    clientX: 10,
    clientY: 10,
  });
  await cells.nth(0).dispatchEvent("dragover", { dataTransfer: recoveredCopy });
  await recoveredCopy.evaluate((transfer) => transfer.clearData());
  await cells.nth(0).dispatchEvent("drop", { dataTransfer: recoveredCopy });
  await expect(cells.nth(0).locator(".cell-heading")).toHaveValue("Red");
  await expect(
    page.locator(
      "[data-drag-floating], [data-drag-source], [data-drag-affected], .image-card.drag-over",
    ),
  ).toHaveCount(0);
  await recoveredCopy.dispose();
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
  for (const placement of ["above", "below", "overlay-bottom", "overlay-top"]) {
    await selectField(page, "caption-position", placement);
    await page.mouse.move(1, 1);
    const idleColor = await frames
      .first()
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--frame-color"),
      );
    const before = await cell.boundingBox();
    const imageBounds = await image.boundingBox();
    const captionBounds = await caption.boundingBox();
    const surface = cell.locator("[data-card-content]");
    const surfaceBounds = await surface.boundingBox();
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
      await expect(frame.locator("rect")).toHaveAttribute(
        "stroke-width",
        "var(--card-frame-stroke)",
      );
      await expect(frame.locator("rect")).toHaveAttribute(
        "stroke-dasharray",
        "var(--card-frame-dash) var(--card-frame-dash-gap)",
      );
      const rounding = await frame.locator("rect").evaluate((element) => ({
        rx: getComputedStyle(element).rx,
        ry: getComputedStyle(element).ry,
      }));
      expect(rounding.rx).toBe(rounding.ry);
      await expect(frame).toHaveCSS("pointer-events", "none");
      const bounds = await frame.boundingBox();
      const edge = (before.width - 2) * 0.0025;
      expect(bounds.x).toBeCloseTo(before.x + 1 + edge, 1);
      expect(bounds.y).toBeCloseTo(before.y + 1 + edge, 1);
      expect(bounds.width).toBeCloseTo(before.width - 2 - edge * 2, 1);
      expect(bounds.height).toBeCloseTo(before.height - 2 - edge * 2, 1);
    }
    await expect(surface).toHaveCSS("mask-image", /linear-gradient/);
    const proportional = await cell.evaluate((element) => ({
      stroke: parseFloat(
        getComputedStyle(element.querySelector("rect")).strokeWidth,
      ),
      maskSize: getComputedStyle(element.querySelector("[data-card-content]"))
        .maskSize,
      maskPosition: getComputedStyle(
        element.querySelector("[data-card-content]"),
      ).maskPosition,
      width: element.getBoundingClientRect().width - 2,
    }));
    expect(proportional.stroke).toBeCloseTo(proportional.width * 0.005, 3);
    const maskedInset = parseFloat(proportional.maskPosition);
    expect(maskedInset).toBeCloseTo(
      proportional.width * 0.0075 +
        Math.min(12, Math.max(6, proportional.width * 0.03)),
      3,
    );
    await expect(cell).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(await surface.boundingBox()).toEqual(surfaceBounds);
    expect(await image.boundingBox()).toEqual(imageBounds);
    expect(await caption.boundingBox()).toEqual(captionBounds);
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
      .toBe(idleBackground);
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
      .toBe(idleBackground);
    for (const frame of await frames.all())
      await expect(frame).toHaveCSS("--frame-color", idleColor);
    expect(await cell.boundingBox()).toEqual(before);
    await caption.fill("Still editable");
    await expect(caption).toHaveValue("Still editable");
  }
});

test("captions wrap at a fixed size and share height across canvas, library and export", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#gap").fill("2");
  await page.locator("#canvas-padding").fill("2");
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
      .dragTo(page.locator(".cell-image-button").nth(index), {
        sourcePosition: { x: 5, y: 5 },
        targetPosition: { x: 5, y: 5 },
      });
  for (const width of [960, 780]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const placement of ["above", "below", "overlay-bottom"]) {
      await selectField(page, "caption-position", placement);
      const metrics = await page
        .locator(".image-card:has(textarea)")
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
        if (library && width <= 900) {
          expect(group).toHaveLength(0);
          continue;
        }
        expect(
          Math.max(...group.map((item) => item.height)) -
            Math.min(...group.map((item) => item.height)),
        ).toBeLessThan(0.1);
        expect(
          Math.max(...group.map((item) => item.captionHeight)) -
            Math.min(...group.map((item) => item.captionHeight)),
        ).toBeLessThan(0.1);
        for (const item of group) {
          expect(item.fontSize).toBeCloseTo(item.width * 0.11, 1);
          expect(item.captionHeight).toBeGreaterThan(item.fontSize * 6 * 1.05);
          expect(item.scrollHeight).toBeLessThanOrEqual(item.clientHeight + 1);
        }
      }
      await expect(page.locator(".cell-heading").nth(1)).toHaveValue(multiline);
    }
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
  expect(dimensions).toEqual({ width: 462, height: 583 });
  const drawing = await page.evaluate(() => window.captionDrawing);
  for (const line of multiline.split("\n"))
    expect(
      drawing.some(
        (entry) => entry.text === line && parseFloat(entry.font) === 16.5,
      ),
    ).toBe(true);
  expect(
    drawing.some(
      (entry) => entry.text === "Short" && parseFloat(entry.font) === 16.5,
    ),
  ).toBe(true);
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
  for (const [width, expanded] of [
    [960, false],
    [780, false],
    [780, true],
  ]) {
    await page.setViewportSize({ width, height: 1080 });
    if (expanded)
      await page
        .getByRole("button", { name: "Expand tools", exact: true })
        .click();
    await selectField(page, "image-shape", "landscape");
    for (const placement of [
      "above",
      "below",
      "overlay-top",
      "overlay-bottom",
    ]) {
      await selectField(page, "caption-position", placement);
      if (width <= 900) {
        const collapse = page.getByRole("button", {
          name: "Collapse tools",
          exact: true,
        });
        if (await collapse.count()) await collapse.click();
        await page.locator(".cell-image-button").first().click();
      }
      await page.locator(".library-heading").nth(0).fill("One");
      await page.locator(".library-heading").nth(1).fill("Two");
      for (const index of [0, 1, 0, 1]) {
        const asset = page.locator(".asset").nth(index);
        const image = asset.locator("[data-library-thumbnail]");
        const caption = asset.locator(".library-heading");
        await expect(image).toBeInViewport({ ratio: 1 });
        await expect(caption).toBeInViewport({ ratio: 1 });
        const imageBounds = await image.boundingBox();
        const captionBounds = await caption.boundingBox();
        await image.hover({
          position: {
            x: 5,
            y: placement === "overlay-top" ? imageBounds.height * 0.4 : 3,
          },
        });
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
      if (width <= 900) {
        await page
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        if (expanded)
          await page
            .getByRole("button", { name: "Expand tools", exact: true })
            .click();
      }
    }
  }
});

test("sidebar cards match canvas placement, editing and proportional dotted frames", async ({
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
    [960, false],
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
        return bounds ? bounds.y + bounds.height : Infinity;
      })
      .toBeLessThanOrEqual(1080);
    await page.mouse.move(1, 1);
    const thumbnailBounds = await thumbnail.boundingBox();
    const uploadBounds = await upload.boundingBox();
    const uploadFrame = upload.locator("[data-cell-image-frame]");
    const uploadFrameBounds = await uploadFrame.boundingBox();
    expect(uploadFrameBounds.width).toBeGreaterThan(uploadBounds.width * 0.9);
    expect(uploadFrameBounds.height).toBeGreaterThan(uploadBounds.height * 0.9);
    await expect(uploadFrame.locator("rect")).toHaveAttribute(
      "stroke-dasharray",
      "var(--card-frame-dash) var(--card-frame-dash-gap)",
    );
    for (const placement of [
      "above",
      "below",
      "overlay-top",
      "overlay-bottom",
    ]) {
      await selectField(page, "caption-position", placement);
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
    await selectField(page, "caption-position", "above");
    await libraryCaption.click();
    await expect(libraryCaption).toBeFocused();
    await libraryCaption.fill(`Edited ${width} ${expanded}`);
    await expect(canvasCaption).toHaveValue(`Edited ${width} ${expanded}`);
    await expect(page.locator(".cell-heading").nth(1)).toHaveValue(
      `Edited ${width} ${expanded}`,
    );
    await canvasCaption.fill("Canvas edit");
    await expect(libraryCaption).toHaveValue("Canvas edit");
    const idleUpload = await upload.boundingBox();
    await thumbnail.hover({ position: { x: 5, y: 30 } });
    await expect(externalFrame).toHaveCSS("--frame-color", "#d8f36a");
    await expect(asset).toHaveCSS("cursor", "move");
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
      await page.mouse.move(0, 0);
      for (const surface of [asset, card]) {
        await expect(surface).toHaveCSS("border-top-width", "1px");
        await expect(surface).toHaveCSS("border-top-style", "solid");
        await expect(surface).toHaveCSS("border-top-color", "rgb(48, 51, 53)");
        await expect(surface).toHaveCSS("border-radius", "12px");
        await expect(surface).toHaveCSS("overflow", "visible");
      }
      const imageBounds = await thumbnail.boundingBox();
      const titleBounds = await asset.locator(".asset-name").boundingBox();
      expect(titleBounds.y + titleBounds.height).toBeCloseTo(imageBounds.y, 0);
      await expect(externalFrame).toHaveCSS("--frame-color", "transparent");
      await expect(libraryCaption).toHaveCSS("outline-style", "none");
      await thumbnail.hover({ position: { x: 5, y: 30 } });
      await expect(externalFrame).toHaveCSS("--frame-color", "#d8f36a");
      const deleteBounds = await asset
        .getByRole("button", { name: /^Delete / })
        .boundingBox();
      const cardBounds = await asset.boundingBox();
      const deleteInset = await asset
        .getByRole("button", { name: /^Delete / })
        .evaluate((element) => parseFloat(getComputedStyle(element).right));
      expect(deleteInset).toBeGreaterThan(0);
      expect(
        cardBounds.x + cardBounds.width - deleteBounds.x - deleteBounds.width,
      ).toBeCloseTo(deleteInset + 1, 1);
      expect(deleteBounds.y - imageBounds.y).toBeCloseTo(deleteInset, 1);
      const corner = {
        x: cardBounds.x + cardBounds.width - 12,
        y: cardBounds.y + 12,
      };
      if (
        deleteBounds.x + deleteBounds.width > corner.x &&
        deleteBounds.y < corner.y
      ) {
        expect(
          (deleteBounds.x + deleteBounds.width - corner.x) ** 2 +
            (deleteBounds.y - corner.y) ** 2,
        ).toBeLessThanOrEqual(12 ** 2);
      }
      const outer = await asset.boundingBox();
      const frameBounds = await externalFrame.boundingBox();
      const edge = (outer.width - 2) * 0.0025;
      expect(frameBounds.x).toBeCloseTo(outer.x + 1 + edge, 1);
      expect(frameBounds.y).toBeCloseTo(outer.y + 1 + edge, 1);
      expect(frameBounds.width).toBeCloseTo(outer.width - 2 - edge * 2, 1);
      expect(frameBounds.height).toBeCloseTo(outer.height - 2 - edge * 2, 1);
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
          const topRows = Array.from({ length: 3 }, (_, row) => {
            const pixels = context.getImageData(12, row, 40, 1).data;
            return Array.from(
              { length: 40 },
              (_, index) =>
                pixels[index * 4 + 1] > 50 &&
                pixels[index * 4 + 1] > pixels[index * 4] + 4,
            );
          });
          const marks = topRows.sort(
            (left, right) =>
              right.filter(Boolean).length - left.filter(Boolean).length,
          )[0];
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
                corner[index * 4 + 1] > 50 &&
                corner[index * 4 + 1] > corner[index * 4] + 4,
            ).filter(Boolean).length;
          });
          bitmap.close();
          return {
            corners,
            marks,
          };
        },
        [...screenshot],
      );
      for (const corner of pixels.corners) expect(corner).toBeGreaterThan(0);
      const marks = pixels.marks;
      expect(marks.some(Boolean)).toBe(true);
      expect(marks.some((mark) => !mark)).toBe(true);
      if (expanded)
        await page
          .getByRole("button", { name: "Collapse tools", exact: true })
          .click();
      await expect
        .poll(
          () =>
            thumbnail.evaluate(async (element) => {
              const before = element.getBoundingClientRect();
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
              const after = element.getBoundingClientRect();
              return (
                Math.abs(before.y - after.y) < 0.01 &&
                document
                  .elementFromPoint(after.x + 12, after.y + 30)
                  ?.closest("button") === element
              );
            }),
          {
            message: `Draggable thumbnail ready at ${width}px, expanded=${expanded}`,
          },
        )
        .toBe(true);
      await thumbnail.evaluate((element) => {
        element.removeAttribute("data-test-drag-started");
        element.addEventListener(
          "dragstart",
          () => element.setAttribute("data-test-drag-started", ""),
          { once: true },
        );
      });
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      const sourceBounds = await thumbnail.boundingBox();
      await thumbnail.dispatchEvent("dragstart", {
        dataTransfer: transfer,
        clientX: sourceBounds.x + 12,
        clientY: sourceBounds.y + 30,
      });
      await transfer.dispose();
      await expect(thumbnail).toHaveAttribute("data-test-drag-started", "");
      await expect(
        page.locator(".grid-cell").first().locator("img"),
      ).toHaveCount(1);
      await page.locator("#export-grid-header").focus();
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-drag-floating]")).toHaveCount(0);
      if (expanded) {
        await page
          .getByRole("button", { name: "Expand tools", exact: true })
          .click();
        await expect(thumbnail).toBeInViewport({ ratio: 1 });
      }
    }
    await expect(async () => {
      await page.mouse.move(1, 1, { steps: 5 });
      await upload.hover({ position: { x: 12, y: 12 } });
      const bounds = await upload.boundingBox();
      await page.mouse.move(bounds.x + 13, bounds.y + 13, { steps: 5 });
      expect(
        await upload.evaluate((element) => {
          return {
            hovered: element.matches(":hover"),
            color:
              getComputedStyle(element).getPropertyValue("--card-frame-color"),
          };
        }),
      ).toMatchObject({ hovered: true, color: "#d8f36a" });
    }).toPass({ timeout: 5000 });
    await page.mouse.move(1, 1);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    for (const [control, frame] of [
      [thumbnail, externalFrame],
      [upload, uploadFrame],
    ]) {
      await control.focus();
      await control.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(control).toBeFocused();
      await expect(frame).toHaveCSS("--frame-color", "#d8f36a");
      await expect(control).toHaveCSS("outline-style", "none");
    }
    const finalThumbnail = await thumbnail.boundingBox();
    expect(finalThumbnail.width).toBeCloseTo(thumbnailBounds.width, 0);
    expect(finalThumbnail.height).toBeCloseTo(thumbnailBounds.height, 0);
    const finalUpload = await upload.boundingBox();
    expect(finalUpload.width).toBeCloseTo(idleUpload.width, 3);
    expect(finalUpload.height).toBeCloseTo(idleUpload.height, 3);
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

test("dropping a card clears stale source hover until the pointer returns", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "hover.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#55aa66"/></svg>',
    ),
  });
  const source = page.locator(".grid-cell").nth(0);
  const target = page.locator(".grid-cell").nth(1);
  await page.locator(".asset").dragTo(source.locator(".cell-image-button"));
  await source.locator(".cell-image-button").hover();
  const frame = source.locator("[data-cell-image-frame]");
  await expect(frame).toHaveCSS("--frame-color", "#d8f36a");
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const bounds = await target.locator(".cell-image-button").boundingBox();
  await source.locator(".cell-image-button").dispatchEvent("dragstart", {
    dataTransfer: transfer,
  });
  await target.dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: bounds.x + bounds.width / 2,
    clientY: bounds.y + bounds.height / 2,
  });
  await source.dispatchEvent("dragend", { dataTransfer: transfer });
  await transfer.dispose();
  await expect(source.locator("img")).toHaveCount(0);
  await expect(target.locator("img")).toHaveCount(1);
  expect(
    await source
      .locator("[data-card-image]")
      .evaluate((image) => image.matches(":hover")),
  ).toBe(true);
  await expect(frame).toHaveCSS("--frame-color", "transparent");
  await expect(source.locator(".cell-image-button")).not.toHaveAttribute(
    "title",
  );
  await page.getByRole("button", { name: "Export grid" }).hover();
  await source.locator(".cell-image-button").hover();
  await expect(frame).toHaveCSS("--frame-color", "#d8f36a");
  await expect(source.locator(".cell-image-button")).toHaveAttribute(
    "title",
    "Add or drop an image",
  );
  await page.getByRole("button", { name: "Export grid" }).hover();
  await source.locator(".cell-heading").focus();
  await source.locator(".cell-heading").press("Shift+Tab");
  await expect(source.locator(".cell-image-button")).toBeFocused();
  await expect(frame).toHaveCSS("--frame-color", "#d8f36a");
});

for (const viewportWidth of [1440, 780]) {
  test(`canvas dragging moves into empty cells and swaps occupied cells with crops at ${viewportWidth}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
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
    await page.setViewportSize({ width: viewportWidth, height: 1080 });
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
    const frameEdge = (cardBounds.width - 2) * 0.0025;
    expect(frameBounds.x).toBeCloseTo(cardBounds.x + 1 + frameEdge, 1);
    expect(frameBounds.width).toBeCloseTo(
      cardBounds.width - 2 - frameEdge * 2,
      1,
    );
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
    await expect(frame).toHaveCSS("--frame-color", "transparent");
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
      page.locator(".grid-cell").nth(2).locator("[data-cell-image-frame]"),
    ).toHaveCSS("--frame-color", "transparent");
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

test("single-item previews stay capped with grid-connected controls on large monitors", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto("./");
  for (const dimension of ["row", "column"]) {
    for (let count = 0; count < 2; count++)
      await page
        .getByRole("button", { name: `Remove ${dimension}`, exact: true })
        .click();
  }
  await expect(page.locator(".grid-cell")).toHaveCount(1);
  for (const shape of ["portrait", "landscape", "square"]) {
    await selectField(page, "image-shape", shape);
    await expect
      .poll(() =>
        page
          .locator(".grid-cell")
          .evaluate((cell) => cell.getBoundingClientRect().width),
      )
      .toBeCloseTo(320, 1);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const frame = document
            .querySelector("[data-resize-frame]")
            .getBoundingClientRect();
          const canvas = document.querySelector(".canvas-area");
          const canvasBounds = canvas.getBoundingClientRect();
          const canvasStyle = getComputedStyle(canvas);
          const center =
            canvasBounds.left +
            (canvas.clientWidth +
              parseFloat(canvasStyle.paddingLeft) -
              parseFloat(canvasStyle.paddingRight)) /
              2;
          const viewport = document
            .querySelector("[data-canvas-viewport]")
            .getBoundingClientRect();
          const columns = document
            .querySelector('[aria-label="Column controls"]')
            .getBoundingClientRect();
          const rows = document
            .querySelector('[aria-label="Row controls"]')
            .getBoundingClientRect();
          return Math.max(
            Math.abs(frame.left + frame.width / 2 - center),
            Math.abs(columns.left - viewport.right - 8),
            Math.abs(rows.top - viewport.bottom - 8),
            Math.abs(frame.width - viewport.width - 104),
          );
        }),
      )
      .toBeLessThan(1);
  }
  await page
    .locator(".canvas-area")
    .screenshot({ path: testInfo.outputPath("single-item-large-monitor.png") });
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.locator(".grid-cell")).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator(".grid-cell")
        .first()
        .evaluate((cell) => cell.getBoundingClientRect().width),
    )
    .toBeCloseTo(320, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".grid-cell")
        .first()
        .evaluate((cell) => cell.getBoundingClientRect().width),
    )
    .toBeCloseTo(128, 1);
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

test("only failures show separated top-right Sonner notifications", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
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
  await downloadBoard(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(notices).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
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
    await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute(
      "data-y-position",
      "top",
    );
    await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute(
      "data-x-position",
      "right",
    );
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
              rect.bottom < innerHeight / 2 &&
              (index === 0 || rect.top >= bounds[index - 1].bottom + 8),
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
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
  await expect(page.locator(".workspace")).toHaveCSS(
    "background-color",
    "rgb(18, 20, 21)",
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
  await selectField(page, "image-shape", "square");
  await selectField(page, "caption-position", "below");
  await page.locator(".cell-heading").first().fill("Blue");
  await page
    .getByRole("button", { name: "Edit grid heading", exact: true })
    .click();
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
          Math.round(((viewport.top - heading.bottom) / cell.width) * 1000) /
          10,
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
            Math.abs(canvas.width - viewport.clientWidth),
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
    await page.locator(`#${id}`).fill(String(value));
    expected[key] = value;
    if (id === "gap") expected.heading = value;
    await expect.poll(ratios).toEqual(expected);
    await expect(page.locator(`#${id}-value`)).toHaveText(`${value}%`);
    await checkCanvasPadding();
  }
  await canvasStyle.locator("#background-value").fill("#d9e7f0");
  await page.locator("#canvas-padding").fill("4");
  expected.padding = 4;
  await expect(page.locator("#canvas-padding-value")).toHaveText("4%");
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
  await expect(page.locator(".workspace")).toHaveCSS(
    "background-color",
    "rgb(18, 20, 21)",
  );
  await expect(page.locator("[data-image-canvas-background]")).toHaveCSS(
    "background-color",
    "rgb(217, 231, 240)",
  );
  await expect(page.locator("#board-grid")).toHaveCSS(
    "background-color",
    "rgb(217, 231, 240)",
  );
  await expect(page.locator(".canvas-area")).toHaveCSS("padding-left", "12px");
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
  await page.locator("#canvas-padding").fill("8");
  expected.padding = 8;
  await expect(page.locator("#canvas-padding-value")).toHaveText("8%");
  await checkCanvasPadding();
  await expect(page.locator(".canvas-area")).toHaveCSS("padding-left", "12px");
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
  await expect(page.locator(".workspace")).toHaveCSS(
    "background-color",
    "rgb(18, 20, 21)",
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
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(ratios).toEqual(expected);
  await expect(page.locator("#canvas-padding")).toHaveValue("8");
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
  await page.getByRole("button", { name: "Expand tools", exact: true }).click();
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

test("appearance toolbar preserves content and matches exported ratios and captions", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.goto("./");
  await page.locator("#gap").fill("2");
  await page.locator("#canvas-padding").fill("2");
  const toolbar = page.getByRole("toolbar", { name: "Grid appearance" });
  await expect(page.locator("#image-shape")).toHaveText("Portrait");
  await expect(page.locator("#caption-position")).toHaveText("Overlay bottom");
  await expect(toolbar.getByRole("button")).toHaveCount(2);
  await page.locator("#caption-position").click();
  await expect(page.getByRole("option")).toHaveCount(4);
  await expect(
    page.getByRole("option", { name: /middle|center/i }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.locator("#image-shape").focus();
  await page.locator("#image-shape").press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#image-shape")).toHaveText("Landscape");
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
  await page.locator(".asset").dragTo(image);
  await expect(page.locator(".grid-cell img")).toHaveCount(1);
  await image.hover();
  await caption.fill("Blue");
  const identity = (await savedWorkspace(page)).grid.cells[0];
  await page.locator("#export-grid-header").click();
  await selectField(page, "resolution", "150");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
    await expect(page.locator("#image-shape")).toHaveText(aspect);
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
          toolbar.getByRole("button", { name: "Text overlay settings" }),
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
        await expect(
          page.locator(`#caption-position .lucide-panel-${alignment}-dashed`),
        ).toHaveCount(1);
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
    await page.locator("#caption-opacity").fill(String(opacity));
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
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator("#image-shape")).toHaveAccessibleName(
      "Image shape Square",
    );
    await expect(page.locator("#caption-position")).toHaveAccessibleName(
      "Caption position Overlay bottom",
    );
    await expect
      .poll(() =>
        toolbar.evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBeLessThanOrEqual(45);
    await page.locator("#caption-position").click();
    await expect(page.getByRole("option")).toHaveCount(4);
    const menu = await page.getByRole("listbox").boundingBox();
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }
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
  await page.getByRole("button", { name: "Expand tools", exact: true }).click();
  const color = page.getByRole("textbox", {
    name: "Overlay color hex value",
    exact: true,
  });
  await expect(color).toBeVisible();
  await expect(color).not.toBeFocused();
  const colorBounds = await color.boundingBox();
  expect(colorBounds.x).toBeGreaterThanOrEqual(0);
  expect(colorBounds.x + colorBounds.width).toBeLessThanOrEqual(390);
  await page
    .getByRole("button", { name: "Collapse tools", exact: true })
    .click();
  await selectField(page, "image-shape", "landscape");
  await selectField(page, "caption-position", "overlay-bottom");
  await caption.fill("Blue");
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
  await expect(
    page.getByRole("switch", { name: "Show heading", exact: true }),
  ).toHaveCount(0);
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Expand tools", exact: true }).click();
  await page.locator("#heading-font").click();
  await expect(async () => {
    const menuBox = await page.getByRole("listbox").boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(12);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(378);
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

test("bottom drawer stays horizontally fixed through modal open and close", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "stable.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const drawer = page.locator("[data-editor-drawer]");
  const before = await drawer.boundingBox();
  await expect(drawer.locator(".section-heading")).toBeHidden();
  expect(before.x).toBe(0);
  expect(before.width).toBe(390);
  await expect(drawer).toHaveCSS("scrollbar-gutter", "auto");
  const assertStable = async () => {
    const current = await drawer.boundingBox();
    expect(Math.abs(current.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(current.width - before.width)).toBeLessThanOrEqual(1);
  };
  const gutter = () =>
    drawer.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        element.offsetWidth -
        element.clientWidth -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth)
      );
    });
  const collapsedGutter = await gutter();
  await page
    .getByRole("button", { name: "Add image to cell 1", exact: true })
    .click({ position: { x: 5, y: 5 } });
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await assertStable();
  await picker
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  await assertStable();
  await page.getByRole("button", { name: "Expand tools", exact: true }).click();
  await expect(drawer.locator(".section-heading")).toBeHidden();
  await expect.poll(gutter).toBeCloseTo(collapsedGutter, 0);
  await assertStable();
  await drawer.screenshot({
    path: testInfo.outputPath("full-width-drawer-native-scrollbar.png"),
  });
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
  const resetTrigger = page.getByRole("button", {
    name: "Reset grid settings",
    exact: true,
  });
  await expect(
    drawer.locator('[id^="headlessui-disclosure-panel-"]'),
  ).toHaveAttribute("style", /height: auto/);
  await expect(
    drawer.locator('[id^="headlessui-disclosure-panel-"]'),
  ).toHaveCSS("scrollbar-gutter", "stable");
  await resetTrigger.scrollIntoViewIfNeeded();
  const sheetState = () =>
    drawer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const panel = element.querySelector(
        '[id^="headlessui-disclosure-panel-"]',
      );
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        scrollTop: panel.scrollTop,
        scrollHeight: panel.scrollHeight,
      };
    });
  const beforeReset = await sheetState();
  await expect(page.locator("html")).toHaveCSS("scrollbar-gutter", "auto");
  expect(
    await drawer.evaluate((element) => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:0;right:0;top:0;height:0";
      document.body.append(probe);
      const edge = probe.getBoundingClientRect().right;
      probe.remove();
      return element.getBoundingClientRect().right <= edge + 1;
    }),
  ).toBe(true);
  await resetTrigger.click();
  const reset = page.getByRole("dialog", {
    name: "Reset grid settings",
    exact: true,
  });
  await expect(reset).toBeVisible();
  await assertStable();
  expect(await sheetState()).toEqual(beforeReset);
  await reset.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reset).toHaveCount(0);
  await assertStable();
  expect(await sheetState()).toEqual(beforeReset);
  await page.addStyleTag({
    content: "::-webkit-scrollbar { width: 0; height: 0; }",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect.poll(gutter).toBe(0);
  await expect(page.locator("html")).toHaveCSS("padding-right", "0px");
  await assertStable();
  await page.locator("#export-grid-header").click();
  const exported = page.getByRole("dialog", {
    name: "Export grid",
    exact: true,
  });
  await expect(exported).toBeVisible();
  await assertStable();
  await exported.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(exported).toHaveCount(0);
  await assertStable();
  await drawer.screenshot({
    path: testInfo.outputPath("full-width-drawer-zero-scrollbar.png"),
  });
});

test("mobile settings shelf and image picker restore desktop sidebars", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(testInfo.project.use.baseURL);
  const drawer = page.locator("[data-editor-drawer]");
  const expand = page.getByRole("button", {
    name: "Expand tools",
    exact: true,
  });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(drawer.getByRole("tablist")).toHaveCount(0);
  await expect(drawer.locator(".asset, [data-upload-tile]")).toHaveCount(0);
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
  await expect
    .poll(async () => {
      const bounds = await drawer.boundingBox();
      return bounds.y + bounds.height;
    })
    .toBeLessThanOrEqual(845);
  const compactBox = await drawer.boundingBox();
  expect(compactBox.height).toBeLessThanOrEqual(60);
  expect(compactBox.y).toBeGreaterThan(844 / 2);
  expect(compactBox.y + compactBox.height).toBeLessThanOrEqual(845);
  await page
    .getByRole("button", { name: "Add image to cell 2", exact: true })
    .tap();
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  const sources = picker.getByRole("tablist", {
    name: "Image source",
    exact: true,
  });
  await expect(sources.getByRole("tab")).toHaveText(["Imported", "Online"]);
  await expect(sources).toHaveCSS("border-radius", "4px");
  await expect(
    sources.getByRole("tab", { name: "Online", exact: true }),
  ).toBeDisabled();
  await expect(picker.locator("[data-upload-tile]")).toBeVisible();
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
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".grid-cell").nth(1).locator("img")).toHaveCount(1);
  await expect(page.locator("#upload")).toHaveCount(0);
  await expect(drawer.locator(".asset, [data-upload-tile]")).toHaveCount(0);
  await expect
    .poll(async () => (await localDatabase(page)).document?.assets.length)
    .toBe(3);
  const assertUploadTileSize = async () => {
    const upload = page.locator("[data-upload-tile]");
    const uploadBox = await upload.boundingBox();
    const imageBox = await page.locator(".asset").first().boundingBox();
    expect(uploadBox.width).toBeCloseTo(imageBox.width, 1);
    expect(uploadBox.height).toBeCloseTo(imageBox.height, 1);
    await page.mouse.move(0, 0);
    await expect(upload).toHaveCSS("--card-frame-color", "transparent");
  };
  await page.screenshot({
    path: testInfo.outputPath("image-drawer-collapsed-mobile.png"),
  });
  await chooseImage(page, "gallery 2", 1);
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".grid-cell").nth(1).locator("img")).toHaveCount(1);
  await expand.tap();
  const collapse = page.getByRole("button", {
    name: "Collapse tools",
    exact: true,
  });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(
    drawer.getByRole("button", { name: "Clear all images", exact: true }),
  ).toHaveCount(0);
  await expect(drawer.locator(".asset, [data-upload-tile]")).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Grid settings", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input,textarea"),
    ),
  ).toBe(false);
  await expect(
    page.getByRole("button", { name: "Load example", exact: true }),
  ).toHaveCount(0);
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
  await expect(
    page.getByRole("button", { name: "Load example", exact: true }),
  ).toHaveCount(0);
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
  const inset = await tools
    .getByRole("button", { name: "Clear cell", exact: true })
    .evaluate((element) => parseFloat(getComputedStyle(element).right));
  expect(inset).toBeGreaterThan(0);
  expect(clear.y - picture.y).toBeCloseTo(inset, 0);
  expect(picture.x + picture.width - clear.x - clear.width).toBeCloseTo(
    inset,
    0,
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
  await beginCellUpload(page, 0);
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  await assertContained();
  const thumbnail = page.locator(".asset [data-library-thumbnail]").first();
  await thumbnail.hover({ position: { x: 5, y: 50 } });
  const imageButton = page.locator(".asset").first();
  const imageFrame = imageButton.locator("[data-cell-image-frame]");
  await expect(imageFrame).toHaveCSS("--frame-color", "#d8f36a");
  await page.mouse.move(1, 1);
  await thumbnail.focus();
  await thumbnail.press("Tab");
  await imageButton.locator("textarea").press("Shift+Tab");
  await expect(thumbnail).toBeFocused();
  await expect(imageButton).toHaveCSS("outline-style", "none");
  await expect(thumbnail).toHaveCSS("box-shadow", "none");
  await thumbnail.press("Tab");
  await imageButton.locator("textarea").press("Tab");
  const keyboardFocus = page.locator(".asset").nth(1);
  await expect(keyboardFocus.locator("[data-library-thumbnail]")).toBeFocused();
  await expect(keyboardFocus).toHaveCSS("outline-style", "none");
  await expect(keyboardFocus.locator("[data-cell-image-frame]")).toHaveCSS(
    "--frame-color",
    "#d8f36a",
  );
  await expect(keyboardFocus.locator("rect")).toHaveAttribute(
    "stroke-dasharray",
    "var(--card-frame-dash) var(--card-frame-dash-gap)",
  );
  const uploadFocus = page.locator("[data-upload-tile]");
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
  await expect(uploadFocus).toHaveCSS("--card-frame-color", "#d8f36a");
  await expect(uploadFocus.locator("rect")).toHaveAttribute(
    "stroke-dasharray",
    "var(--card-frame-dash) var(--card-frame-dash-gap)",
  );
  for (const width of [390, 714, 820]) {
    await page.setViewportSize({ width, height: 844 });
    const drawer = page.locator("[data-editor-drawer]");
    await expect(
      drawer.locator(".asset, [data-upload-tile], [role=tablist]"),
    ).toHaveCount(0);
    await assertContained();
    await expect
      .poll(() =>
        drawer.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true);
  }
  await picker
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  const desktopImage = page.locator("#asset-library .asset").first();
  await expect(desktopImage.locator(".asset-name")).toBeVisible();
  await desktopImage.locator(".asset-name").hover();
  await expect(desktopImage).toHaveCSS("outline-style", "none");
  await expect(desktopImage.locator("[data-cell-image-frame]")).toHaveCSS(
    "--frame-color",
    "transparent",
  );
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
  await expect(desktopFocus).toHaveCSS("outline-style", "none");
  await expect(desktopFocus.locator("[data-cell-image-frame]")).toHaveCSS(
    "--frame-color",
    "#d8f36a",
  );
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

test("image imports show progress and keep the editor responsive through failed files", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
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
  await page.locator("#gap").fill("3.5");
  await expect(page.locator("#gap")).toHaveValue("3.5");
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
      await page
        .locator(".cell-image-button")
        .first()
        .tap({ position: { x: 5, y: 5 } });
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
  await page
    .getByRole("dialog", { name: "Choose image", exact: true })
    .getByRole("button", { name: "Close dialog", exact: true })
    .tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await expect(library).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".asset")).toHaveCount(2);
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Could not load broken.svg",
  );
  await expect
    .poll(async () => (await localDatabase(page)).document?.assets.length)
    .toBe(2);
  expect((await localDatabase(page)).images).toHaveLength(2);
  expect((await savedWorkspace(page)).grid.gap).toBe(21);
  await context.close();
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
  await page.locator("#gap").fill("4");
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
  await expect(page.locator("#gap")).toHaveValue("4");
  await page
    .getByRole("button", { name: "Reset grid settings", exact: true })
    .click();
  await reset
    .getByRole("button", { name: "Reset settings", exact: true })
    .click();
  await expect(reset).toHaveCount(0);
  await expect(page.locator("#gap")).toHaveValue("10");
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
  const cardBox = await page.locator(".asset").first().boundingBox();
  expect(tileBox.width).toBeCloseTo(cardBox.width, 1);
  expect(tileBox.height).toBeCloseTo(cardBox.height, 1);
  await page
    .getByRole("button", {
      name: "Image options: Keep this caption",
      exact: true,
    })
    .hover();
  await page.screenshot({
    path: testInfo.outputPath("library-delete-hover-desktop.png"),
  });
  await page
    .getByRole("button", { name: "Delete Keep this caption", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await localDatabase(page)).document?.assets.find(
          (asset) => asset.title === "Keep this caption",
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
    picker.getByRole("button", { name: "Use Keep this caption", exact: true }),
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
    retained.assets.find((asset) => asset.title === "Keep this caption").id,
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
    other.getByRole("button", { name: "Edit grid heading", exact: true }),
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
  await page.locator("#gap").fill("4.5");
  await expect
    .poll(async () => (await localDatabase(page)).document?.grid.gap)
    .toBe(27);
  await reloadWorkspace(page);
  await expect(page.locator("#gap")).toHaveValue("4.5");
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
    page.getByRole("button", { name: "Edit grid heading", exact: true }),
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
  await page.locator(".cell-heading").first().fill("Session edit");
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
  await expect(page).toHaveTitle("Grids - Image Boards");
  await expect(
    page.getByRole("link", { name: "Grids", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Imported", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("#add-board, #board-tabs, #export-all"),
  ).toHaveCount(0);
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(page.locator(".asset")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit grid heading", exact: true }),
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
    "normal",
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
            ...context.getImageData(84, 84, 1, 1).data,
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
    expect(result.height).toBe(2008);
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
    .getByRole("group", { name: "Heading style", exact: true })
    .getByRole("textbox", { name: "Background hex value", exact: true })
    .fill("#ed1d24");
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
    page.getByRole("button", { name: "Edit grid heading", exact: true }),
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
  const heading = page.getByRole("button", {
    name: "Edit grid heading",
    exact: true,
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
    left: document.body.getBoundingClientRect().left,
    width: document.body.getBoundingClientRect().width,
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
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  await expect(page.locator("html")).toHaveCSS("scrollbar-gutter", "auto");
  const during = await page.evaluate(() => ({
    scroll: window.scrollY,
    left: document.body.getBoundingClientRect().left,
    width: document.body.getBoundingClientRect().width,
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
  expect(await page.evaluate(() => window.scrollY)).toBe(before.scroll);
  await expect(heading).toHaveText("Team DC");
  await editHeading(page, "My image board");
  await reloadWorkspace(page);
  await expect(heading).toHaveText("My image board");
  await page.screenshot({
    path: testInfo.outputPath("controls-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
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

test("touch dialogs do not autofocus text inputs", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(testInfo.project.use.baseURL);
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
    await page.getByRole("button", { name: "Expand tools", exact: true }).tap();
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
  await page.locator("#gap").fill("5");
  await selectExportField(page, "format", "image/webp");
  await selectField(page, "resolution", "300");
  await page.locator("#quality").fill("70");
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
    page.getByRole("button", { name: "Edit grid heading", exact: true }),
  ).toHaveText("Add heading");
  await expect(page.locator("#heading-font")).toHaveText("Manrope");
  await expect(page.locator("#gap")).toHaveValue("10");
  await expect(page.locator(".asset")).toHaveCount(1);
  const reset = await savedWorkspace(page);
  expect(reset.exportSettings).toEqual({
    format: "image/png",
    resolution: 1200,
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
  await chooseImage(page, title);
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
    .dragTo(page.locator(".cell-image-button").first(), {
      sourcePosition: { x: 5, y: 5 },
      targetPosition: { x: 5, y: 5 },
    });
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("edge-controls-mobile.png"),
    fullPage: true,
  });
  const geometry = await page.evaluate(() => {
    const grid = document
      .querySelector("[data-canvas-viewport]")
      .getBoundingClientRect();
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

test("page metadata assets resolve and desktop library keeps mouse dragging", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
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
  await expect(page.locator("#asset-library")).toHaveCSS("display", "grid");
  await expect(
    page.getByRole("button", { name: "Move Image 0", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("[data-library-thumbnail]").first(),
  ).toHaveAttribute("draggable", "true");
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await expect(
    page.locator(".grid-cell").first().locator("img"),
  ).toHaveAttribute("alt", "Image 0");
  await expect(page).toHaveTitle("Grids - Image Boards");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Create image grids/,
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://drexxdk.github.io/grids/",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://drexxdk.github.io/grids/assets/grids-icon.png",
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

test("unified image picker matches aside cards and keeps responsive grids", async ({
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
  await page
    .locator(".cell-image-button")
    .first()
    .click({ position: { x: 5, y: 5 } });
  const picker = page.getByRole("dialog", {
    name: "Choose image",
    exact: true,
  });
  const panel = picker.locator('[id^="headlessui-dialog-panel"]');
  await expect(
    picker.getByRole("tab", { name: "Imported", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    picker.getByRole("tab", { name: "Online", exact: true }),
  ).toBeDisabled();
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
    await expect(thumbnail).toHaveCSS("cursor", "pointer");
  }
  for (const width of [320, 390, 780, 832, 1440]) {
    await page.setViewportSize({ width, height: 1080 });
    const availableWidth = await picker
      .locator("[data-modal-scroll]")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight)
        );
      });
    await expect
      .poll(async () => (await panel.boundingBox()).width)
      .toBe(Math.min(800, availableWidth));
    const grid = picker.getByRole("tabpanel").locator('[class~="tw:grid"]');
    await expect(
      grid.locator(":scope > [data-upload-tile]").first(),
    ).toBeVisible();
    await expect(grid.locator(":scope > [data-library-image]")).toHaveCount(8);
    const layout = await picker
      .getByRole("tabpanel")
      .locator('[class~="tw:grid"]')
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          columns: style.gridTemplateColumns.split(" ").length,
          gap: style.columnGap,
          width: element.getBoundingClientRect().width,
          cardWidths: Array.from(
            element.children,
            (child) => child.getBoundingClientRect().width,
          ),
        };
      });
    const expectedColumns = Math.max(
      1,
      Math.floor(
        (layout.width + parseFloat(layout.gap)) /
          (128 + parseFloat(layout.gap)),
      ),
    );
    expect(layout.columns).toBe(expectedColumns);
    for (const cardWidth of layout.cardWidths) {
      expect(cardWidth).toBeGreaterThanOrEqual(Math.min(128, layout.width));
      expect(cardWidth).toBeLessThanOrEqual(320);
    }
    if (width !== 780)
      await page.screenshot({
        path: testInfo.outputPath(`picker-width-${width}.png`),
      });
  }
  const cardStyles = (element) => {
    const card = element.querySelector(".image-card");
    const caption = element.querySelector("textarea");
    const cardStyle = getComputedStyle(card);
    const captionStyle = getComputedStyle(caption);
    return {
      border: cardStyle.border,
      radius: cardStyle.borderRadius,
      background: cardStyle.backgroundColor,
      font: captionStyle.fontFamily,
      weight: captionStyle.fontWeight,
      case: captionStyle.textTransform,
    };
  };
  expect(
    await picker.locator("[data-library-image]").first().evaluate(cardStyles),
  ).toEqual(
    await page
      .locator("#asset-library [data-library-image]")
      .first()
      .evaluate(cardStyles),
  );
  await picker
    .getByRole("button", { name: "Use Grid 7", exact: true })
    .hover({ position: { x: 5, y: 5 } });
  await picker
    .getByRole("button", { name: "Delete Grid 7", exact: true })
    .click();
  await expect(picker.locator("[data-library-image]")).toHaveCount(7);
  await expect(page.locator(".grid-cell").first().locator("img")).toHaveCount(
    0,
  );
  await picker
    .getByRole("button", { name: "Use Grid 0", exact: true })
    .click({ position: { x: 5, y: 5 } });
  await expect(picker).toHaveCount(0);
  await expect(
    page.locator(".grid-cell").first().locator("img"),
  ).toHaveAttribute("alt", "Grid 0");
});

test("mobile picker has clear all images without deletion mode and preserves canvas images", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  const drawer = page.locator("[data-editor-drawer]");
  await expect(drawer.getByRole("button")).toHaveCount(1);
  await expect(
    drawer.getByRole("button", { name: "Expand tools", exact: true }),
  ).toBeVisible();
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
  await expect(picker).toHaveCount(0);
  await expect(
    page.locator(".grid-cell").first().locator("img"),
  ).toHaveAttribute("alt", "Picker 0");
  await openPicker();
  await expect(picker.getByRole("img")).toHaveCount(3);
  await expect(
    picker.getByRole("tab", { name: "Library", exact: true }),
  ).toHaveCount(0);
  for (const thumbnail of await picker
    .locator("[data-library-thumbnail]")
    .all()) {
    await expect(thumbnail).toHaveAttribute("draggable", "false");
    await expect(thumbnail).toHaveCSS("touch-action", "auto");
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
  await expect(picker.getByText("No images yet.")).toBeVisible();
  await expect(
    page.locator(".grid-cell").first().locator("img"),
  ).toHaveAttribute("alt", "Picker 2");
  await picker.getByRole("button", { name: "Close dialog", exact: true }).tap();
  await expect(picker).toHaveCount(0);
  await reloadWorkspace(page);
  await expect(
    page.locator(".grid-cell").first().locator("img"),
  ).toHaveAttribute("alt", "Picker 2");
  await context.close();
});

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
  const source = await images.nth(1).boundingBox();
  const start = { x: source.x + 10, y: source.y + 10 };
  const touchCopy = async (targetIndex, cancel = false) => {
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
    await expect(cells.nth(targetIndex)).toHaveClass(/drag-over/);
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

test("upload tiles match image card geometry and hover frames in aside and picker", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "Frame.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#40b4aa"/></svg>',
    ),
  });
  await expect(page.locator(".asset")).toHaveCount(1);
  const metrics = (element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const frame = getComputedStyle(
      element.querySelector("[data-cell-image-frame] rect"),
    );
    const frameBounds = element
      .querySelector("[data-cell-image-frame]")
      .getBoundingClientRect();
    const svgBounds = element
      .querySelector("[data-cell-image-frame] svg")
      .getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      radius: style.borderRadius,
      border: style.border,
      stroke: frame.strokeWidth,
      dash: frame.strokeDasharray,
      frameRadius: frame.rx,
      frameWidth: frameBounds.width,
      frameHeight: frameBounds.height,
      svgWidth: svgBounds.width,
      svgHeight: svgBounds.height,
      mask: getComputedStyle(element.querySelector("[data-card-content]"))
        .maskImage,
    };
  };
  for (const shape of ["portrait", "square", "landscape"]) {
    await selectField(page, "image-shape", shape);
    for (const position of ["above", "overlay-bottom"]) {
      await selectField(page, "caption-position", position);
      await page
        .locator(".cell-image-button")
        .first()
        .click({ position: { x: 5, y: 5 } });
      const picker = page.getByRole("dialog", {
        name: "Choose image",
        exact: true,
      });
      const compare = async (upload, image) => {
        await page.mouse.move(0, 0);
        const uploaded = await upload.evaluate(metrics);
        const pictured = await image.evaluate(metrics);
        expect(uploaded.width).toBeCloseTo(pictured.width, 1);
        expect(uploaded.height).toBeCloseTo(pictured.height, 1);
        expect(uploaded.radius).toBe(pictured.radius);
        expect(uploaded.border).toBe(pictured.border);
        for (const measured of [uploaded, pictured]) {
          expect(measured.svgWidth).toBeCloseTo(measured.frameWidth, 1);
          expect(measured.svgHeight).toBeCloseTo(measured.frameHeight, 1);
          expect(measured.svgWidth).toBeGreaterThan(measured.width * 0.9);
          expect(measured.svgHeight).toBeGreaterThan(measured.height * 0.9);
        }
        await upload.hover({ position: { x: 5, y: 5 } });
        const uploadHover = await upload.evaluate(metrics);
        await image
          .locator("[data-card-image] > button")
          .hover({ position: { x: 5, y: 5 } });
        const imageHover = await image.evaluate(metrics);
        expect(uploadHover.width).toBeCloseTo(imageHover.width, 1);
        expect(uploadHover.height).toBeCloseTo(imageHover.height, 1);
        expect(parseFloat(uploadHover.stroke)).toBeCloseTo(
          parseFloat(imageHover.stroke),
          3,
        );
        expect(parseFloat(uploadHover.frameRadius)).toBeCloseTo(
          parseFloat(imageHover.frameRadius),
          3,
        );
        for (const key of ["border", "radius", "dash", "mask"])
          expect(uploadHover[key]).toBe(imageHover[key]);
        expect(uploadHover.mask).toMatch(/radial-gradient/);
      };
      await compare(
        picker.locator("[data-upload-tile]"),
        picker.locator(".asset").first(),
      );
      if (shape === "portrait" && position === "above")
        await page.screenshot({
          path: testInfo.outputPath("upload-card-picker.png"),
        });
      await picker
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await expect(picker).toHaveCount(0);
      await compare(
        page.locator("#asset-library [data-upload-tile]"),
        page.locator("#asset-library .asset").first(),
      );
    }
  }
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
  await imageButton(0).tap({ position: { x: 5, y: 5 } });
  await picker.locator("#picker-cell-upload").setInputFiles(
    ["Touch A", "Touch B"].map((name, index) => ({
      name: `${name}.svg`,
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${index ? "#f26365" : "#40b4aa"}"/></svg>`,
      ),
    })),
  );
  await expect(picker).toHaveCount(0);
  await expect(cells.nth(0).locator("img")).toHaveAttribute("alt", "Touch A");
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch B");
  const tools = cells
    .nth(0)
    .getByRole("group", { name: "Cell tools", exact: true });
  await imageButton(0).tap({ position: { x: 5, y: 5 } });
  await expect(tools).toBeVisible();
  await expect(picker).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.activeElement?.matches("input, textarea"),
    ),
  ).toBe(false);
  await imageButton(0).tap({ position: { x: 5, y: 5 } });
  await expect(tools).toHaveCount(0);
  await imageButton(0).tap({ position: { x: 5, y: 5 } });
  await tools.getByRole("button", { name: "Replace image", exact: true }).tap();
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button", { name: "Use Touch A", exact: true })
    .tap({ position: { x: 5, y: 5 } });
  await expect(picker).toHaveCount(0);
  const session = await context.newCDPSession(page);
  const drag = async (sourceIndex, targetIndex, cancel = false) => {
    const source = await imageButton(sourceIndex).boundingBox();
    const target = await imageButton(targetIndex).boundingBox();
    const start = { x: source.x + 10, y: source.y + 10 };
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
    await expect(cells.nth(targetIndex)).toHaveClass(/drag-over/);
    await expect(
      cells.nth(sourceIndex).locator("[data-card-content]"),
    ).toHaveCSS("opacity", "0.35");
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
  await imageButton(0).tap({ position: { x: 5, y: 5 } });
  await drag(0, 2);
  await expect(cells.nth(0).locator("img")).toHaveCount(0);
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Touch A");
  await drag(2, 1);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch A");
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Touch B");
  await drag(1, 0, true);
  await expect(cells.nth(0).locator("img")).toHaveCount(0);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch A");
  await imageButton(1).tap({ position: { x: 5, y: 5 } });
  await expect(
    cells.nth(1).getByRole("group", { name: "Cell tools", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("touch-card-tools.png") });
  await session.detach();
  await reloadWorkspace(page);
  await expect(cells.nth(1).locator("img")).toHaveAttribute("alt", "Touch A");
  await expect(cells.nth(2).locator("img")).toHaveAttribute("alt", "Touch B");
  await context.close();
});

test("mobile shelf remains toggle-only with fixed settings controls", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("./");
  const drawer = page.locator("[data-editor-drawer]");
  for (const width of [320, 390, 780]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(drawer.getByRole("button")).toHaveCount(1);
    await expect
      .poll(async () => (await drawer.boundingBox()).height)
      .toBeLessThanOrEqual(72);
    const expand = drawer.getByRole("button", {
      name: "Expand tools",
      exact: true,
    });
    await expect(expand).toHaveCSS("border-bottom-left-radius", "0px");
    await expect(expand).toHaveCSS("border-top-left-radius", "6px");
    await expect(expand).toHaveCSS("border-bottom-width", "0px");
    const beforeToggle = await expand.boundingBox();
    expect(beforeToggle.width).toBe(160);
    const shelfBorder = await drawer
      .locator("[data-shelf-body]")
      .evaluate((element) => getComputedStyle(element).borderTopColor);
    await expand.hover();
    await expect(expand).toHaveCSS("border-top-color", shelfBorder);
    await expect(expand).toHaveCSS("border-left-color", shelfBorder);
    await expect(expand).toHaveCSS("border-right-color", shelfBorder);
    const hoverColor = await page.evaluate(() =>
      matchMedia("(hover: hover)").matches
        ? "rgb(216, 243, 106)"
        : getComputedStyle(document.documentElement).color,
    );
    await expect(expand).toHaveCSS("color", hoverColor);
    await expect
      .poll(async () => {
        const bounds = await expand.boundingBox();
        return Math.abs(bounds.y + bounds.height - 844);
      })
      .toBeLessThan(1);
    await expect
      .poll(async () => {
        const area = await page.locator(".canvas-area").boundingBox();
        const toolbar = await page
          .getByRole("toolbar", { name: "Grid appearance" })
          .boundingBox();
        const frame = await page.locator("[data-resize-frame]").boundingBox();
        return Math.abs(
          (toolbar.y + frame.y + frame.height) / 2 - area.y - area.height / 2,
        );
      })
      .toBeLessThan(1);
    await drawer
      .getByRole("button", { name: "Expand tools", exact: true })
      .tap();
    await expect(
      drawer.locator(".asset-panel, .asset-library, img"),
    ).toHaveCount(0);
    await expect(
      drawer.getByRole("group", { name: "Card style", exact: true }),
    ).toBeVisible();
    const collapse = drawer.getByRole("button", {
      name: "Collapse tools",
      exact: true,
    });
    await expect(collapse).toHaveCSS("border-bottom-width", "0px");
    await expect(collapse).toHaveCSS("border-top-left-radius", "6px");
    await collapse.hover();
    await expect(collapse).toHaveCSS("border-top-color", shelfBorder);
    await expect(collapse).toHaveCSS("border-left-color", shelfBorder);
    await expect(collapse).toHaveCSS("border-right-color", shelfBorder);
    await expect
      .poll(async () => {
        const toggle = await collapse.boundingBox();
        const body = await drawer.locator("[data-shelf-body]").boundingBox();
        return Math.abs(toggle.y + toggle.height - body.y - 1);
      })
      .toBeLessThan(1);
    const openToggle = await collapse.boundingBox();
    expect(openToggle.x).toBeCloseTo(beforeToggle.x, 1);
    expect(openToggle.width).toBe(beforeToggle.width);
    expect(openToggle.height).toBe(beforeToggle.height);
    const panel = drawer.locator("[data-shelf-body] > div");
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => panel.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const scrolledToggle = await collapse.boundingBox();
    expect(scrolledToggle.y).toBeCloseTo(openToggle.y, 1);
    if (width === 390)
      await page.screenshot({
        path: testInfo.outputPath("shelf-expanded-mobile.png"),
      });
    await collapse.tap();
    await expect(drawer.getByRole("button")).toHaveCount(1);
  }
  await page.screenshot({
    path: testInfo.outputPath("shelf-collapsed-mobile.png"),
  });
  await context.close();
});

test("inset hover and focus surfaces keep visibly rounded corners", async ({
  page,
}, testInfo) => {
  await page.goto("./");
  await page.locator("#upload").setInputFiles({
    name: "Rounded.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>',
    ),
  });
  await page
    .locator("[data-library-thumbnail]")
    .first()
    .dragTo(page.locator(".cell-image-button").first());
  await page
    .getByRole("group", { name: "Card style", exact: true })
    .getByRole("textbox", { name: "Background hex value", exact: true })
    .fill("#ffffff");
  for (const width of [1440, 1900]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const selector of [".grid-cell", ".asset"]) {
      const card = page.locator(selector).first();
      const image = card.locator("[data-card-image] > button");
      await image.hover({ position: { x: 5, y: 5 } });
      for (const state of ["hover", "focus"]) {
        if (state === "focus") {
          await page.mouse.move(0, 0);
          await image.focus();
          await image.press("Tab");
          await page.keyboard.press("Shift+Tab");
        }
        await expect(card.locator("[data-card-content]")).toHaveCSS(
          "mask-image",
          /radial-gradient/,
        );
        const metrics = await card.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const surface = element.querySelector("[data-card-content]");
          const content = surface.getBoundingClientRect();
          const style = getComputedStyle(surface);
          const radius = parseFloat(style.maskSize) / 2;
          const inset = parseFloat(style.maskPosition);
          return {
            radius,
            expectedRadius:
              parseFloat(getComputedStyle(element).borderTopLeftRadius) - 1,
            x: content.x - bounds.x + inset,
            y: content.y - bounds.y + inset,
            right: content.right - bounds.x - inset,
            bottom: content.bottom - bounds.y - inset,
          };
        });
        expect(metrics.radius).toBeCloseTo(metrics.expectedRadius, 1);
        expect(metrics.radius).toBeGreaterThanOrEqual(10);
        const bytes = await card.screenshot();
        const pixels = await page.evaluate(
          async ({ base64, metrics }) => {
            const response = await fetch(`data:image/png;base64,${base64}`);
            const bitmap = await createImageBitmap(await response.blob());
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const pixel = (x, y) => [
              ...context.getImageData(Math.round(x), Math.round(y), 1, 1).data,
            ];
            return {
              corners: [
                pixel(metrics.x + 2, metrics.y + 2),
                pixel(metrics.right - 3, metrics.y + 2),
                pixel(metrics.x + 2, metrics.bottom - 3),
                pixel(metrics.right - 3, metrics.bottom - 3),
              ],
              top: pixel((metrics.x + metrics.right) / 2, metrics.y + 2),
            };
          },
          { base64: bytes.toString("base64"), metrics },
        );
        for (const pixel of pixels.corners)
          expect(Math.max(...pixel.slice(0, 3))).toBeLessThan(100);
        expect(Math.min(...pixels.top.slice(0, 3))).toBeGreaterThan(240);
      }
      if (width === 1440)
        await card.screenshot({
          path: testInfo.outputPath(`rounded-${selector.slice(1)}.png`),
        });
    }
  }
});
