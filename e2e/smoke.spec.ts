import { expect, test } from "@playwright/test";

// Test credentials for the first admin user
const ADMIN = {
  firstName: "Test",
  lastName: "Admin",
  username: "testadmin",
  email: "admin@test.local",
  password: "TestPassword123!",
};

test.describe("Smoke tests", () => {
  // Tests run sequentially — registration creates the user that login tests use.
  test.describe.configure({ mode: "serial" });

  test("API health endpoint responds", async ({ request }) => {
    const response = await request.get("http://localhost:3333/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    // A8-11: the public liveness probe exposes only a coarse aggregate — the
    // per-subsystem breakdown (checks.database/storage/email) moved to the
    // authenticated /health/status endpoint and is no longer public.
    expect(body.status).toBe("healthy");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });

  test("first-user registration creates admin and redirects to dashboard", async ({ page }) => {
    // Give containers time to be fully ready (especially on CI)
    test.setTimeout(60000);

    await page.goto("/login");

    // On first access, the login page shows a registration form
    await expect(page.getByRole("button", { name: "Create Admin Account" })).toBeVisible({
      timeout: 30000,
    });

    // Fill in the registration form
    await page.getByLabel("First Name").fill(ADMIN.firstName);
    await page.getByLabel("Last Name").fill(ADMIN.lastName);
    await page.getByLabel("Username").fill(ADMIN.username);
    await page.getByLabel("Email").fill(ADMIN.email);
    // Password input is wrapped in a div (for visibility toggle), so the
    // <label for=...> targets the wrapper div, not the <input>. Use role instead.
    await page.getByRole("textbox", { name: "Password" }).fill(ADMIN.password);

    // Submit
    await page.getByRole("button", { name: "Create Admin Account" }).click();

    // Should redirect to dashboard after auto-login
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test("login page shows login form (not registration)", async ({ page }) => {
    await page.goto("/login");

    // Should show login form with email/username field
    await expect(page.getByLabel("Email or Username")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    // Registration form should NOT be visible (user already created)
    await expect(page.getByRole("button", { name: "Create Admin Account" })).not.toBeVisible();
  });

  test("login with credentials redirects to dashboard", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByLabel("Email or Username")).toBeVisible({ timeout: 15000 });

    // Fill in login form
    await page.getByLabel("Email or Username").fill(ADMIN.username);
    await page.getByRole("textbox", { name: "Password" }).fill(ADMIN.password);

    // Submit
    await page.getByRole("button", { name: "Sign In" }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Dashboard should contain meaningful content
    await expect(page.getByText("Dashboard")).toBeVisible({ timeout: 10000 });
  });
});
