import { test, expect } from "@playwright/test";

for (const width of [1440, 390, 260]) {
  test(`local images remain usable at ${width}px with legacy account and provider state`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const apiRequests = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") ||
          /commons\.wikimedia\.org|collectionapi\.metmuseum\.org/.test(url.hostname)) {
        apiRequests.push(request.url());
      }
    });
    await page.addInitScript(() => {
      if (!localStorage.getItem("grids-ui-v1")) {
        localStorage.setItem("grids-ui-v1", JSON.stringify({
          selectedPanel: 0,
          sidebarOpen: true,
          librarySource: "commons",
          pickerSource: "met",
          browsing: {},
        }));
        history.replaceState({ gridsAccountView: "login" }, "");
      }
    });
    await page.goto("./?panel=images&source=commons&q=earth&info=privacy&auth=failed&other=keep#anchor");
    const sidebar = page.locator("[data-editor-sidebar]");
    await expect(page.locator("#board-grid")).toBeVisible();
    await expect(page.locator("#asset-library")).toBeVisible();
    await expect(sidebar.getByRole("heading", { name: "My images", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Menu|Log in|Account)$/ })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#sidebar-image-source")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Online", exact: true })).toHaveCount(0);

    await page.locator("#upload").setInputFiles({
      name: "My upload.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#40b4aa"/></svg>'),
    });
    await expect(sidebar.locator("[data-library-image]")).toHaveCount(1);
    await page.locator(".cell-image-button").first().click();
    const picker = page.getByRole("dialog", { name: "Choose image", exact: true });
    await expect(picker).toBeVisible();
    await expect(picker.locator("#picker-image-source")).toHaveCount(0);
    await expect(picker.getByRole("region", { name: "My images", exact: true })).toBeVisible();
    const image = picker.getByRole("button", { name: "Use My upload", exact: true });
    await image.scrollIntoViewIfNeeded();
    await expect(image).toBeInViewport();
    await image.click();
    await expect(picker).toHaveCount(0);
    await expect(page.locator(".grid-cell").first().locator("img")).toHaveAttribute("alt", "My upload");
    await page.locator(".cell-heading").first().fill("My caption");
    await expect(page.locator("#save-status")).toHaveAttribute("data-save-state", "saved");

    await page.reload();
    await expect(page.locator(".cell-heading").first()).toHaveValue("My caption");
    await expect(page.locator("#asset-library [data-library-image]")).toHaveCount(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toHaveCount(0);
    await expect(page.locator("#sidebar-image-source")).toHaveCount(0);
    const url = new URL(page.url());
    expect(url.searchParams.get("other")).toBe("keep");
    expect(url.hash).toBe("#anchor");
    expect(apiRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
