// Merge this `server.proxy` section into the existing vite.config.js.
server: {
  proxy: {
    "/api": {
      target: "http://127.0.0.1:8001",
      changeOrigin: true
    }
  }
}
