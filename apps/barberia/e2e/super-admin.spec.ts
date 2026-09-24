import { test, expect } from '@playwright/test';

test.describe('Super Admin Flow', () => {
  test('unauthorized users cannot access super admin panel', async ({ page }) => {
    // If we try to access /adminbarberia without being logged in, it redirects to login
    await page.goto('/adminbarberia');
    await page.waitForURL('**/admin/login**');
    await expect(page).toHaveURL(/.*\/admin\/login/);
  });

  test('admin login page renders correctly', async ({ page }) => {
    await page.goto('/admin/login');
    
    // We expect a form to be present
    const form = page.locator('form');
    await expect(form).toBeVisible();

    // Check for email and password inputs
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
  
  // NOTE: A full E2E test for tenant creation requires a valid super_admin session.
  // In a real CI environment, we would use page.route() to mock the Supabase API 
  // response or use a dedicated test database seeded with a test super_admin.
  // For QA structure purposes, these assertions validate the routing security.
});
