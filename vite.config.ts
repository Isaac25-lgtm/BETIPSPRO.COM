import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { rmSync } from "node:fs";

// TESTING-PHASE reference assets (owner decision D-029): real players / league logos cut from the owner's
// reference screenshot and real club crests. Shipped ONLY when VITE_LOCAL_REFERENCE_HERO=true (gitignored
// .env.local on the owner's machine). Must be switched off and removed before payments go live.
const stripLocalOnlyAssets = (keep: boolean) => ({
  name: "strip-local-only-assets",
  closeBundle() {
    if (keep) return;
    rmSync("dist/client/images/local", { recursive: true, force: true });
    rmSync("dist/client/crests", { recursive: true, force: true });
  },
});

// One deployable unit: the React SPA is served as Worker static assets and
// /api/* is handled by the Worker (see wrangler.jsonc run_worker_first).
export default defineConfig(({ mode }) => {
  const referenceAssets = loadEnv(mode, process.cwd(), "").VITE_LOCAL_REFERENCE_HERO === "true";
  return {
  // FIP_PERSIST lets E2E runs use an isolated local D1 state directory.
  plugins: [react(), stripLocalOnlyAssets(referenceAssets), cloudflare(process.env.FIP_PERSIST ? { persistState: { path: process.env.FIP_PERSIST } } : {})],
  build: {
    target: "es2022",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
        },
      },
    },
  },
  // Bind IPv4 loopback explicitly (Windows otherwise listens on ::1 only, which some VPNs/proxies
  // and debuggers cannot reach) and disable browser caching so every reload shows the latest build.
  server: { host: "127.0.0.1", port: Number(process.env.PORT ?? 5173), strictPort: true, headers: { "Cache-Control": "no-store" } },
};
});
