import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Barbería reescribe / y /admin* hacia apps/web, así que ambas zonas deben estar arriba.
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../web',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_WEB_URL: 'http://localhost:3000',
        NEXT_PUBLIC_BARBERIA_URL: 'http://localhost:3001',
      },
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:3001',
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_WEB_URL: 'http://localhost:3000',
        NEXT_PUBLIC_BARBERIA_URL: 'http://localhost:3001',
        WEB_ZONE_URL: 'http://localhost:3000',
      },
    },
  ],
})
