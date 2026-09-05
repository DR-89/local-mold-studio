import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/benchmark",
  timeout: 240_000,
  workers: 1,
  reporter: "line",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  use: {
    baseURL: "http://localhost:4173",
    trace: "off",
  },
  webServer: {
    command: "npm run dev -- --host localhost --port 4173",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});