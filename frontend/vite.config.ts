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
          // chunks (one per lucide icon / radix primitive). Keep it to a few:
          // charts (Dashboard only), react core, one vendor bucket, and the shared ui/hooks/lib code.
          codeSplitting: {
            groups: [
              {
                name: "vendor-charts",
                test: /node_modules[\/](recharts|d3-[^\/]+|victory-vendor|internmap|decimal\.js-light|es-toolkit|immer|reselect|@reduxjs|redux|react-redux|use-sync-external-store|tiny-invariant)[\/]/,
                priority: 30,
              },
              {
                name: "vendor-react",
                test: /node_modules[\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run|cookie|set-cookie-parser)[\/]/,
                priority: 20,
              },
              { name: "vendor", test: /node_modules[\/]/, priority: 10 },
              {
                name: "app-shared",
                test: /src[\/](components[\/]ui|hooks|lib|types)[\/]/,
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
