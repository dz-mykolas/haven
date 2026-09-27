import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4322",
    timezoneId: "Europe/Vilnius",
    locale: "en-GB",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bash scripts/e2e-api.sh",
      url: "http://127.0.0.1:8181/api/health",
      timeout: 60000,
      reuseExistingServer: false,
    },
    {
      command:
        "ASTRO_DEV_BACKGROUND=0 HAVEN_API_URL=http://127.0.0.1:8181 npm run dev --workspace apps/web -- --ignore-lock --port 4322",
      url: "http://127.0.0.1:4322",
      timeout: 60000,
      reuseExistingServer: false,
    },
  ],
});
