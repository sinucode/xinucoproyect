import { test, expect } from '@playwright/test';

test.describe('Auth & Security Flow', () => {
  test('middleware protects tenant routes', async ({ page }) => {
    // Attempting to access a protected route without being logged in
    await page.goto('/test-barber/dashboard');

    // Should redirect to the tenant's login page
    await page.waitForURL('**/test-barber/login');
    await expect(page).toHaveURL(/.*\/test-barber\/login/);
  });

  test('middleware redirects global reserved words', async ({ page }) => {
    // /admin is a reserved slug
    await page.goto('/admin');
    
    // Should gracefully redirect to the global super-admin login
    await page.waitForURL('**/admin/login**');
    await expect(page).toHaveURL(/.*\/admin\/login/);
  });

});
