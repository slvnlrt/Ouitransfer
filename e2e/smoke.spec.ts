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
    // A cold Docker stack serves the first requests slowly (Next.js standalone
    // first-hit compile + the multi-step auto-login redirect), so allow ample time.
    test.setTimeout(120000);

    await page.goto("/login");

    const registerButton = page.getByRole("button", { name: "Create Admin Account" });
    const loginField = page.getByLabel("Email or Username");

    // Fresh DB shows the registration form. On a CI retry the SAME (now seeded)
    // SQLite volume persists, so the registration form is gone — fall back to
    // logging in with the account a prior attempt created. Both paths must land
    // on the dashboard, which keeps this stateful test idempotent across retries.
    await expect(registerButton.or(loginField)).toBeVisible({ timeout: 45000 });

    if (await registerButton.isVisible()) {
      await page.getByLabel("First Name").fill(ADMIN.firstName);
      await page.getByLabel("Last Name").fill(ADMIN.lastName);
      await page.getByLabel("Username").fill(ADMIN.username);
      await page.getByLabel("Email").fill(ADMIN.email);
      // Password input is wrapped in a div (for visibility toggle), so the
      // <label for=...> targets the wrapper div, not the <input>. Use role instead.
      await page.getByRole("textbox", { name: "Password" }).fill(ADMIN.password);
      await page.getByRole("button", { name: "Create Admin Account" }).click();
    } else {
      await loginField.fill(ADMIN.username);
      await page.getByRole("textbox", { name: "Password" }).fill(ADMIN.password);
      await page.getByRole("button", { name: "Sign In" }).click();
    }

    // Should redirect to the dashboard after auto-login / login.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 45000 });
  });

  test("login page shows login form (not registration)", async ({ page }) => {
    await page.goto("/login");

    // Should show login form with email/username field
    await expect(page.getByLabel("Email or Username")).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    // Registration form should NOT be visible (user already created)
    await expect(page.getByRole("button", { name: "Create Admin Account" })).not.toBeVisible();
  });

  test("login with credentials redirects to dashboard", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("/login");

    await expect(page.getByLabel("Email or Username")).toBeVisible({ timeout: 30000 });

    // Fill in login form
    await page.getByLabel("Email or Username").fill(ADMIN.username);
    await page.getByRole("textbox", { name: "Password" }).fill(ADMIN.password);

    // Submit
    await page.getByRole("button", { name: "Sign In" }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 45000 });

    // Dashboard should contain meaningful content
    await expect(page.getByText("Dashboard")).toBeVisible({ timeout: 20000 });
  });
});
