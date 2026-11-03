import { test, expect } from "@playwright/test";

const policies = [
  { path: "terms", heading: "Terms of Service" },
  { path: "privacy", heading: "Privacy Policy" },
  { path: "support", heading: "Support and data deletion" },
];

for (const width of [320, 1280]) {
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

test("policy navigation preserves the editor and is available when the account API is offline", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("./?source=imported");
  const sidebar = page.locator("[data-editor-sidebar]");
  for (const { path } of policies) {
    const link = sidebar.locator(`a[href="./${path}.html"]`);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  }
  await page.getByRole("button", { name: "Account and saved grids", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Account and saved grids" });
  await expect(dialog.getByRole("navigation", { name: "Policies and support" })).toBeVisible();
  const editorUrl = page.url();
  const [policy] = await Promise.all([
    page.waitForEvent("popup"),
    dialog.getByRole("link", { name: "Privacy (opens in a new tab)", exact: true }).click(),
  ]);
  await expect(policy.getByRole("heading", { name: "Privacy Policy", exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(editorUrl);
  await policy.close();
});

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
