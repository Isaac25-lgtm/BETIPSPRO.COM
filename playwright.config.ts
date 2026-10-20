import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;
process.env.FIP_PERSIST = ".wrangler/e2e-state";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1536, height: 1024 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, testMatch: /mobile|visual/ },
  ],
  webServer: {
    command: `node scripts/e2e-prepare.mjs && npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { FIP_PERSIST: ".wrangler/e2e-state", PORT: String(PORT) },
  },
});
