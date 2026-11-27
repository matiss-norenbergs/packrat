import path from "node:path"
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Backend port for local dev proxying, read from frontend/.env.local (not
  // committed) or the shell environment. Override with BACKEND_PORT if 50505
  // (the documented default) is already in use on your machine.
  const env = loadEnv(mode, process.cwd(), "")
  const backendPort = env.BACKEND_PORT ?? "50505"

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: env.PORT ? Number(env.PORT) : 5173,
      proxy: {
        "/api": `http://localhost:${backendPort}`,
        "/media-files": `http://localhost:${backendPort}`,
        "/local-images": `http://localhost:${backendPort}`,
        "/ws": {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
    },
    build: {
      rolldownOptions: {
        output: {
          // Without explicit groups the page split leaves ~100 tiny shared
          // chunks (one per lucide icon / radix primitive). Keep it to a few
          // named ones. Rolldown groups capture a matched module's *dependencies*
          // recursively by default, so a group that is meant to load on demand
          // must opt out (`includeDependenciesRecursively: false`) or it swallows
          // React core / clsx and every startup chunk then imports it (and
          // index.html modulepreloads it). `scripts/check-bundle.mjs` guards this.
          //  - vendor-react: startup, so it outranks every on-demand group.
          //  - vendor-charts: recharts and its helpers, Dashboard only.
          //  - vendor-dnd / vendor-panels / vendor-calendar / vendor-qr / vendor-virtual:
          //    libraries one screen uses (Edit Sequence, Artist dialog + date formatting, 2FA setup, the Library's windowed grid).
          //  - vendor-tauri: the desktop plugins, only ever dynamically imported.
          //  - vendor: the rest, i.e. what the startup path needs.
          //  - app-shared: components/ui, hooks, lib, types (minus calendar/resizable,
          //    which travel with their consumers).
          codeSplitting: {
            groups: [
              {
                name: "vendor-react",
                test: /node_modules[\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run|cookie|set-cookie-parser)[\/]/,
                priority: 40,
              },
              {
                name: "vendor-charts",
                test: /node_modules[\/](recharts|d3-[^\/]+|victory-vendor|internmap|decimal\.js-light|es-toolkit|immer|reselect|@reduxjs|redux|react-redux|use-sync-external-store|tiny-invariant)[\/]/,
                priority: 30,
                includeDependenciesRecursively: false,
              },
              {
                name: "vendor-dnd",
                test: /node_modules[\/]@dnd-kit[\/]/,
                priority: 25,
                includeDependenciesRecursively: false,
              },
              {
                name: "vendor-panels",
                test: /node_modules[\/]react-resizable-panels[\/]/,
                priority: 25,
                includeDependenciesRecursively: false,
              },
              {
                name: "vendor-calendar",
                test: /node_modules[\/](react-day-picker|date-fns|@date-fns)[\/]/,
                priority: 25,
                includeDependenciesRecursively: false,
              },
              {
                name: "vendor-qr",
                test: /node_modules[\/]qrcode\.react[\/]/,
                priority: 25,
                includeDependenciesRecursively: false,
              },
              {
                name: "vendor-virtual",
                test: /node_modules[\/]@tanstack[\/](react-virtual|virtual-core)[\/]/,
                priority: 25,
                includeDependenciesRecursively: false,
              },
              {
                name: "vendor-tauri",
                test: /node_modules[\/]@tauri-apps[\/]/,
                priority: 25,
                includeDependenciesRecursively: false,
              },
              { name: "vendor", test: /node_modules[\/]/, priority: 10 },
              {
                name: "app-shared",
                test: /src[\/](components[\/]ui[\/](?!calendar\.tsx|resizable\.tsx)|hooks[\/]|lib[\/]|types[\/])/,
                priority: 5,
              },
            ],
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: true,
    },
  }
})
