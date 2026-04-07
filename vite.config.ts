import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sslCertPath = path.join(process.cwd(), "ssl/t800.crt");
const sslKeyPath = path.join(process.cwd(), "ssl/t800.key");

const hasSSL = fs.existsSync(sslCertPath) && fs.existsSync(sslKeyPath);
const useHTTPS = process.env.VITE_HTTPS === "true" && hasSSL;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: process.env.VITE_BASE_PATH || "./",
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "ui-vendor": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-switch",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-separator",
            "lucide-react",
            "clsx",
            "tailwind-merge",
            "class-variance-authority",
          ],
          monaco: ["monaco-editor"],
          codemirror: [
            "@uiw/react-codemirror",
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/language",
            "@codemirror/commands",
            "@codemirror/search",
            "@codemirror/autocomplete",
          ],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    https: useHTTPS
      ? {
          cert: fs.readFileSync(sslCertPath),
          key: fs.readFileSync(sslKeyPath),
        }
      : false,
    port: 5175,
    host: "0.0.0.0",
    allowedHosts: true,
    hmr: {
      host: "169.254.0.123",
    },
    proxy: {
      // Auth, Host, RBAC APIs (port 30001)
      "/users": "http://127.0.0.1:30001",
      "/host": "http://127.0.0.1:30001",
      "/db": "http://127.0.0.1:30001",
      "/version": "http://127.0.0.1:30001",
      "/health": "http://127.0.0.1:30001",
      "/releases": "http://127.0.0.1:30001",
      "/rbac": "http://127.0.0.1:30001",
      "/bulk-import": "http://127.0.0.1:30001",
      "/bulk-update": "http://127.0.0.1:30001",
      "/autostart": "http://127.0.0.1:30001",
      "/alerts": "http://127.0.0.1:30001",
      "/settings": "http://127.0.0.1:30001",
      "/credential": "http://127.0.0.1:30001",
      // Terminal WebSocket (port 30002)
      "/terminal": {
        target: "http://127.0.0.1:30002",
        ws: true,
      },
      // Tunnel API (port 30003)
      "/ssh": "http://127.0.0.1:30003",
      // File Manager API (port 30004)
      "/ssh/file_manager": "http://127.0.0.1:30004",
      // Server Stats API (port 30005)
      "/stats": "http://127.0.0.1:30005",
      // Dashboard API (port 30006)
      "/dashboard": "http://127.0.0.1:30006",
      // Docker API (port 30007)
      "/docker": "http://127.0.0.1:30007",
      // Guacamole WebSocket (port 30008)
      "/guacamole": {
        target: "http://127.0.0.1:30008",
        ws: true,
      },
    },
  },
});
