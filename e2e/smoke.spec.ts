import { expect, test } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("homepage loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/ouitransfer/i);
  });

  test("API health endpoint responds", async ({ request }) => {
    const response = await request.get("http://localhost:3333/api/health");
    expect(response.ok()).toBeTruthy();
  });
});
