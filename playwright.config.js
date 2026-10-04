import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
    trace: 'on',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'chromium-mouse', use: { browserName: 'chromium', hasTouch: false } },
    { name: 'chromium-touch', use: { browserName: 'chromium', hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: 'node tests/serve.js',
    url: 'http://127.0.0.1:4173/survey/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
