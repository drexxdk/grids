import { test, expect } from "@playwright/test";

const policies = [
  { path: "terms", heading: "Terms of Service" },
  { path: "privacy", heading: "Privacy Policy" },
  { path: "support", heading: "Support and data deletion" },
];

for (const width of [320, 1280]) {
  for (const [index, { path, heading }] of policies.entries()) {
    test(`${path} modal URL selects its tab and survives reload at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("**/api/**", (route) => route.abort());
      await page.goto(`./?info=${path}&extra=keep#anchor`);
      const dialog = page.getByRole("dialog", { name: "Information", exact: true });
      await expect(dialog.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      const next = policies[(index + 1) % policies.length];
      await dialog.getByRole("tab", { name: next.path[0].toUpperCase() + next.path.slice(1), exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get("info")).toBe(next.path);
      await page.reload();
      await expect(dialog.getByRole("heading", { name: next.heading, exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      const url = new URL(page.url());
      expect(url.searchParams.get("info")).toBeNull();
      expect(url.searchParams.get("extra")).toBe("keep");
      expect(url.hash).toBe("#anchor");
      await page.reload();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }
  for (const { path, heading } of policies) {
    test(`${path} is public and readable without JavaScript at ${width}px`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } });
      const page = await context.newPage();
      const response = await page.goto(new URL(`${path}.html`, baseURL).href);
      expect(response.status()).toBe(200);
      await expect(page).toHaveTitle(`${heading === "Support and data deletion" ? "Support and Data Deletion" : heading} - Gridz`);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(page.locator("main").getByRole("link", { name: "incrementish@gmail.com" }).first())
        .toHaveAttribute("href", "mailto:incrementish@gmail.com");
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://gritz.pages.dev/${path}`);
      for (const name of ["Terms", "Privacy", "Support"]) {
        await expect(page.getByRole("navigation").getByRole("link", { name, exact: true })).toBeVisible();
      }
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
        background: getComputedStyle(document.documentElement).backgroundColor,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
      expect(dimensions.background).toBe("rgb(23, 26, 28)");
      await page.getByRole("link", { name: "Back to the editor" }).click();
      expect(new URL(page.url()).pathname).toBe(new URL(baseURL).pathname);
      await context.close();
    });
  }
}

test("unknown information tabs do not open a modal or block editing", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("./?info=unknown");
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeEnabled();
});

test("policy navigation preserves the editor and is available when the account API is offline", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("./?source=imported");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Account unavailable", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Log in", exact: true });
  await expect(dialog.getByRole("navigation", { name: "Policies and support" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const editorUrl = page.url();
  await page.context().setOffline(true);
  await page.getByRole("menuitem", { name: "Information", exact: true }).click();
  const information = page.getByRole("dialog", { name: "Information", exact: true });
  await expect(information.getByRole("heading", { name: "Information", exact: true })).toBeVisible();
  await expect(information.getByRole("heading", { name: "Terms of Service", exact: true })).toBeVisible();
  await information.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await expect(information.getByRole("tab", { name: "Privacy", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(information.getByRole("heading", { name: "Privacy Policy", exact: true })).toBeVisible();
  await expect(information.getByRole("link", { name: "Cloudflare", exact: true })).toHaveAttribute("target", "_blank");
  await information.getByRole("link", { name: "data-deletion instructions", exact: true }).click();
  await expect(information.getByRole("tab", { name: "Support", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(information.getByRole("heading", { name: "Delete your account and cloud data", exact: true })).toBeInViewport();
  expect(page.context().pages()).toHaveLength(1);
  await information.getByRole("link", { name: "Gridz", exact: true }).click();
  await expect(information).toHaveCount(0);
  await expect(page.locator(".grid-cell")).toHaveCount(9);
  await expect(page).toHaveURL(editorUrl);
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
});

for (const width of [260, 320, 390, 1280]) {
  for (const signedIn of [false, true]) {
    test(`hamburger menu holds policies without taking editor space at ${width}px when ${signedIn ? "signed in" : "a guest"}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("**/api/session", (route) => route.fulfill({ json: {
        user: signedIn ? { id: "00000000-0000-4000-8000-000000000001", name: "Test user", provider: "google" } : null,
        providers: ["google", "facebook", "discord"],
        connections: signedIn ? [{ provider: "google", name: "Test user" }] : [],
        pendingMerge: null,
      } }));
      await page.goto("./?source=imported");
      await expect(page.getByRole("contentinfo")).toHaveCount(0);
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      const menu = page.getByRole("menu");
      await expect(menu.locator("a")).toHaveCount(0);
      await expect(menu.getByRole("menuitem", { name: "Information", exact: true })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: signedIn ? "Account" : "Log in", exact: true })).toBeVisible();
      const library = menu.getByRole("menuitem", { name: "Library", exact: true });
      await expect(library).toBeVisible();
      expect(Math.round((await library.boundingBox()).height)).toBe(44);
      for (const item of await menu.getByRole("menuitem").all()) {
        await expect(item).toHaveCSS("min-height", "44px");
        const bounds = await item.boundingBox();
        expect(Math.round(bounds.height)).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await menu.getByRole("menuitem", { name: "Information", exact: true }).click();
      await expect(menu).toHaveCount(0);
      const information = page.getByRole("dialog", { name: "Information", exact: true });
      const panel = page.locator("[data-modal-panel]");
      await expect(information).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const before = await panel.boundingBox();
      for (const { path, heading } of policies) {
        const label = path[0].toUpperCase() + path.slice(1);
        const tab = information.getByRole("tab", { name: label, exact: true });
        if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(information.getByRole("heading", { name: heading, exact: true })).toBeVisible();
        const bounds = await panel.boundingBox();
        expect(Math.abs(bounds.height - before.height)).toBeLessThan(1);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
        expect(await information.getByRole("tabpanel").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(information).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
      const workspace = await page.getByRole("region", { name: "Grid editor", exact: true }).boundingBox();
      expect(Math.abs(workspace.y + workspace.height - 900)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width <= 900) {
        await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
      }
      const sidebar = page.locator("[data-editor-sidebar]");
      await expect(sidebar).toBeVisible();
      const sidebarBounds = await sidebar.boundingBox();
      expect(Math.abs(sidebarBounds.y + sidebarBounds.height - 900)).toBeLessThanOrEqual(1);
      await expect(sidebar.getByRole("navigation", { name: "Policies and support" })).toHaveCount(0);
    });
  }
}

test("service worker keeps clean policy URLs out of the editor fallback", async ({ page }) => {
  await page.goto("./?source=imported");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  for (const { path, heading } of policies) {
    const response = await page.goto(`./${path}`);
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});
