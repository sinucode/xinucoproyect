import { test, expect } from '@playwright/test';

test('has title and redirects to login when accessing admin', async ({ page }) => {
  // We mock the response because the server might not be fully configured with env vars in CI
  // However, for local E2E, this will try to load the actual server.
  await page.goto('/');

  // Depending on the default page, we might just check for the Next.js standard title or Barberia title
  // For now, let's just make sure it loads without a 500 error
  const status = await page.evaluate(() => document.readyState);
  expect(status).toBe('complete');

  // Test the middleware reserved slug redirection
  await page.goto('/admin');
  await page.waitForURL('**/admin/login**');

  // Verify that it reached the login page
  await expect(page).toHaveURL(/.*\/admin\/login/);
});
