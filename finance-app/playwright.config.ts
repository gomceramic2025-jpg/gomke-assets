import { defineConfig } from '@playwright/test';

const chromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const launchOptions = { executablePath: chromium, args: ['--no-sandbox'] };

export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', launchOptions },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    {
      name: 'iphone-viewport',
      // Chromium mô phỏng kích thước/UA iPhone. KHÔNG phải Safari/WebKit thật.
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
  ],
});
