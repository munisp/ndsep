import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
import { VitePWA } from "vite-plugin-pwa";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

const pwaPlugin = VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["favicon.ico", "icons/*.png"],
  devOptions: { enabled: true },
  workbox: {
    // The verified vendor bundle is approximately 2.39 MB. Keep an explicit
    // bounded precache budget rather than relying on Workbox's 2 MB default.
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
    runtimeCaching: [
      {
        urlPattern: /^\/api\/trpc\//,
        handler: "NetworkFirst",
        options: {
          cacheName: "trpc-api-cache",
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 5 },
          networkTimeoutSeconds: 10,
        },
      },
      {
        urlPattern: /^\/api\/invoices\//,
        handler: "NetworkFirst",
        options: { cacheName: "invoice-pdf-cache", expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 } },
      },
    ],
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//],
  },
  manifest: {
    name: "NDSEP DPCO Portal",
    short_name: "DPCO Portal",
    description: "National Data Sovereignty Enforcement Platform — Data Protection Compliance Organisation Portal",
    theme_color: "#0f172a",
    background_color: "#0f172a",
    display: "standalone",
    orientation: "portrait-primary",
    scope: "/",
    start_url: "/dpco-app",
    categories: ["business", "productivity", "government"],
    icons: [
      { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "DPCO Dashboard",
        short_name: "Dashboard",
        url: "/dpco-app/dashboard",
        description: "Compliance overview, earnings, and activity feed",
        icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Overdue Invoices",
        short_name: "Overdue",
        url: "/dpco/billing?filter=overdue",
        description: "Jump directly to overdue invoices requiring action",
        icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Active Audit Workspace",
        short_name: "Audit",
        url: "/dpco/audit?view=active",
        description: "Open the active audit workspace for your current engagement",
        icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Billing & Earnings",
        short_name: "Billing",
        url: "/dpco/billing",
        description: "View invoices, record payments, and download PDFs",
        icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Client Register",
        short_name: "Clients",
        url: "/dpco/clients",
        description: "Manage client organisations and onboarding status",
        icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Subscription Plan",
        short_name: "Plan",
        url: "/dpco/subscription",
        description: "View and upgrade your DPCO service tier",
        icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
      },
    ],
    screenshots: [
      { src: "/icons/screenshot-wide.png", sizes: "1280x720", type: "image/png", form_factor: "wide", label: "DPCO Dashboard" },
      { src: "/icons/screenshot-narrow.png", sizes: "390x844", type: "image/png", form_factor: "narrow", label: "DPCO Mobile" },
    ],
  },
});

const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector(), pwaPlugin];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Source maps are opt-in for production diagnostics. Rendering source maps
    // for the full portal can exhaust constrained local/CI build environments
    // without affecting runtime functionality.
    sourcemap: process.env.GENERATE_SOURCEMAP === "true" ? "hidden" : false,
    // Compression-size reporting is diagnostic only and can be expensive for
    // this portal's large route graph; CI can enable it in a dedicated job.
    reportCompressedSize: false,
    // M14: Bundle analysis — run with ANALYZE=true pnpm build
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react") || id.includes("scheduler")) return "vendor";
          if (id.includes("@radix-ui/react-dialog") || id.includes("@radix-ui/react-dropdown-menu") || id.includes("@radix-ui/react-tabs")) return "ui";
          if (id.includes("recharts")) return "charts";
          return undefined;
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
