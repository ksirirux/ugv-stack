import express from "express";
import http from "http";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import connectDB from "./src/config/db.js";
import authRoutes from "./src/routes/authRoutes.js";
import visionRoutes from "./src/routes/visionRoutes.js";
import otaRoutes from "./src/routes/otaRoutes.js";
import missionRoutes from "./src/routes/missionRoutes.js";
import pathPlanRoutes from "./src/routes/pathPlanRoutes.js";
import robotRoutes from "./src/routes/robotRoutes.js";
import cors from "cors";
import dotenv from "dotenv";
import { initWebSocket } from "./src/services/websocketService.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8087;
console.log("Port: ", PORT);

// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);

// Initialize WebSocket Service
initWebSocket(server);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/", express.static(path.join(__dirname, "public")));

// Log incoming HTTP requests
app.use((req, res, next) => {
  console.log(`[HTTP Request] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("  Body:", JSON.stringify(req.body));
  }
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/vision", visionRoutes);
app.use("/api/ota", otaRoutes);
app.use("/api/paths", pathPlanRoutes);
app.use("/api", missionRoutes);
app.use("/api/robots", robotRoutes);
app.use("/api/test", (req, res) => res.json({ data: "TEST API" }));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Web dashboard: http://localhost:${PORT}`);
  
  // Resolve local IP dynamically
  const interfaces = os.networkInterfaces();
  let localIp = "localhost";
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
  }

  console.log(`Robot WebSocket: ws://${localIp}:${PORT}`);
});