import path from "node:path"
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Backend port for local dev proxying, read from frontend/.env.local (not
  // committed) or the shell environment. Override with BACKEND_PORT if 8080
  // (the documented default) is already in use on your machine.
  const env = loadEnv(mode, process.cwd(), "")
  const backendPort = env.BACKEND_PORT ?? "8080"

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy: {
        "/downloads": `http://localhost:${backendPort}`,
        "/library": `http://localhost:${backendPort}`,
        "/health": `http://localhost:${backendPort}`,
        "/media-files": `http://localhost:${backendPort}`,
        "/ws": {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
    },
  }
})
