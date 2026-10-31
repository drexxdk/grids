import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
async function downloadBoard(page) {
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export board", exact: true }).click();
  return promise;
}

test("image placement, title editing, grid sizing, and image exports", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
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

  await page.locator("#rows").fill("3");
  await page.locator("#rows").press("Tab");
  await expect(page.locator(".grid-cell")).toHaveCount(6);
  await page.locator("#columns").fill("3");
  await page.locator("#columns").press("Tab");
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
  await page.locator("#resolution").selectOption("600");

  const exports = [];
  for (const [name, publisher] of [
    ["DC Characters", "dc"],
    ["Marvel Characters", "marvel"],
  ]) {
    await page.getByRole("tab", { name: new RegExp(name) }).click();
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
  for (const name of ["DC Characters", "Marvel Characters"]) {
    await page.getByRole("tab", { name: new RegExp(name) }).click();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export board", exact: true })
      .click();
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

test("board headings and font choices persist and old boards migrate without losing edits", async ({
  page,
}) => {
  await page.goto("./");
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("gridroom-v1"));
    saved.boards.forEach((item) => {
      delete item.heading;
      delete item.headingFont;
      delete item.cellFont;
      delete item.publisher;
    });
    saved.boards[0].cells[0].title = "My custom character";
    localStorage.setItem("gridroom-v1", JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator("#image-heading")).toHaveValue("Team DC");
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
  await page.getByRole("tab", { name: /Marvel Characters/ }).click();
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
