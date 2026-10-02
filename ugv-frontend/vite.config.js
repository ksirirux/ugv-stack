import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5177,
    host: "0.0.0.0",
    allowedHosts: ["app.tat-ugv.com"],
    watch: {
      usePolling: true
    },
    proxy: {
      "/api": {
        target: process.env.BACKEND_URL || "http://127.0.0.1:8087",
        changeOrigin: true,
        secure: false
      },
      "/ws-api": {
        target: process.env.BACKEND_URL || "http://127.0.0.1:8087",
        ws: true,
        changeOrigin: true,
        secure: false
      }
    }

  }
})
