import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/offline",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:4174",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- -p 4174 -H localhost",
    url: "http://localhost:4174",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
