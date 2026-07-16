import express from "express";
import http from "http";
import path from "path";
import WebSocket, { WebSocketServer } from "ws";
import * as ROSLIB from "roslib";
import { fileURLToPath } from "url";
import multer from "multer";
import mqtt from "mqtt";
import cors from "cors";
import fs from "fs";
import { createProxyMiddleware } from "http-proxy-middleware";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8080;
const ROSBRIDGE_URL = process.env.ROSBRIDGE_URL || "ws://localhost:9090";
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://192.168.1.129:1883";
const MQTT_USERNAME = process.env.MQTT_USERNAME || "plookpak";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "EJ90317A4";




const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const VISION_API_URL =
  process.env.VISION_API_URL || "http://localhost:8001";

// ตรวจสถานะ Vision backend
app.get("/api/vision/health", async (req, res) => {
  try {
    const response = await fetch(
      `${VISION_API_URL}/api/vision/health`
    );

    const body = await response.text();

    res
      .status(response.status)
      .type(response.headers.get("content-type") || "application/json")
      .send(body);
  } catch (error) {
    console.error("[VISION HEALTH ERROR]", error);

    res.status(502).json({
      error: "Vision service is unavailable",
      detail: error.message
    });
  }
});

// วิเคราะห์แปลง
app.post("/api/vision/analyze-field", async (req, res) => {
  try {
    console.log("[VISION] Analyze field request");

    const response = await fetch(
      `${VISION_API_URL}/api/vision/analyze-field`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(req.body)
      }
    );

    const body = await response.text();
    console.log("[VISION] Analyze field response:", body);

    res
      .status(response.status)
      .type(response.headers.get("content-type") || "application/json")
      .send(body);
  } catch (error) {
    console.error("[VISION ANALYZE ERROR]", error);

    res.status(502).json({
      error: "Vision service is unavailable",
      detail: error.message
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

// --- MQTT Setup ---
const mqttOptions = {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD
};
const mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);
mqttClient.on('connect', () => {
  console.log('Connected to MQTT Broker:', MQTT_BROKER_URL);
});
mqttClient.on('error', (err) => {
  console.error('MQTT connection error:', err);
});

// --- Multer Setup ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, "public", "firmware");
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, "update.bin"); // overwrite the same file
  }
});
const upload = multer({ storage: storage });

// --- OTA API Route ---
app.post("/api/ota/upload", upload.single("firmware"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // Get the host that the client used to connect to the server (e.g., 192.168.1.x)
  const hostIp = req.hostname; 
  const downloadUrl = `http://${hostIp}:${PORT}/firmware/update.bin`;
  
  console.log("Firmware uploaded. Triggering OTA with URL:", downloadUrl);
  
  // Publish to MQTT
  mqttClient.publish("/ugv/ota_update", downloadUrl, { qos: 1 }, (err) => {
    if (err) {
      console.error("MQTT Publish Error:", err);
      return res.status(500).json({ error: "Failed to notify robot via MQTT" });
    }
    res.json({ success: true, message: "OTA Update triggered", url: downloadUrl });
  });
});

const clients = {
  robots: new Map(),
  browsers: new Set(),
};
const latestRobotData = new Map();
function sendJson(socket, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function broadcastToBrowsers(data) {
  for (const socket of clients.browsers) {
    sendJson(socket, data);
  }
}

// --- ROS Setup ---
let rosConnected = false;
let latestGps = { latitude: null, longitude: null, altitude: null, gps_status: null };

const ros = new ROSLIB.Ros({
  url: ROSBRIDGE_URL
});

ros.on('connection', () => {
  console.log('Connected to rosbridge server.');
  rosConnected = true;
  broadcastToBrowsers({
    type: "robot_status",
    robot_id: "ugv-01",
    connected: true,
  });
});

ros.on('error', (error) => {
  console.error('Error connecting to rosbridge server:', error.message || error);
  rosConnected = false;
});

ros.on('close', () => {
  console.log('Connection to rosbridge server closed.');
  rosConnected = false;
  broadcastToBrowsers({
    type: "robot_status",
    robot_id: "ugv-01",
    connected: false,
  });
});

// Setup Subscribers
const scanListener = new ROSLIB.Topic({
  ros: ros,
  name: '/scan',
  messageType: 'sensor_msgs/LaserScan'
});

scanListener.subscribe((message) => {
  broadcastToBrowsers({
    type: "laser_scan",
    robot_id: "ugv-01",
    ranges: message.ranges,
    angle_min: message.angle_min,
    angle_max: message.angle_max,
    angle_increment: message.angle_increment
  });
});

const batteryListener = new ROSLIB.Topic({
  ros: ros,
  name: '/battery',
  messageType: 'sensor_msgs/BatteryState'
});

batteryListener.subscribe((message) => {
  broadcastToBrowsers({
    type: "telemetry",
    robot_id: "ugv-01",
    battery: message.voltage,
    rtk_status: latestRtkStatus,
    ...latestGps
  });
});

const fixListener = new ROSLIB.Topic({
  ros: ros,
  name: '/gps/fix',
  messageType: 'sensor_msgs/NavSatFix'
});

fixListener.subscribe((message) => {
  console.log("[GPS Fix]:", message);
  latestGps = {
    latitude: message.latitude,
    longitude: message.longitude,
    altitude: message.altitude,
    gps_status: message.status.status
  };
});

let latestRtkStatus = "UNKNOWN";
const rtkListener = new ROSLIB.Topic({
  ros: ros,
  name: '/gps/rtk_status',
  messageType: 'std_msgs/String'
});

rtkListener.subscribe((message) => {
  console.log("[RTK Status]:", message);
  latestRtkStatus = message.data;
});
// -----------------

wss.on("connection", (socket, request) => {
  console.log("New WebSocket connection:", request.socket.remoteAddress);

  socket.clientType = "unknown";
  socket.robotId = null;

  socket.on("message", (rawData) => {
    let message;

    try {
      message = JSON.parse(rawData.toString());
    } catch (error) {
      sendJson(socket, {
        type: "error",
        message: "Invalid JSON",
      });
      return;
    }

    if (message.type === "register") {
      if (message.client === "robot") {
        const robotId = message.robot_id || "ugv-01";

        socket.clientType = "robot";
        socket.robotId = robotId;
        clients.robots.set(robotId, socket);

        console.log(`Robot connected: ${robotId}`);

        broadcastToBrowsers({
          type: "robot_status",
          robot_id: robotId,
          connected: true,
        });
      }

      if (message.client === "browser") {
        socket.clientType = "browser";
        clients.browsers.add(socket);

        const robotStatus = [];

        let isUgvConnected = rosConnected;

        for (const [robotId, robotSocket] of clients.robots.entries()) {
          if (robotId === "ugv-01" && robotSocket.readyState === WebSocket.OPEN) {
            isUgvConnected = true;
          } else if (robotId !== "ugv-01") {
            robotStatus.push({
              robot_id: robotId,
              connected: robotSocket.readyState === WebSocket.OPEN,
            });
          }
        }

        robotStatus.push({
          robot_id: "ugv-01",
          connected: isUgvConnected,
        });

        sendJson(socket, {
          type: "robot_list",
          robots: robotStatus,
        });
        for (const [robotId, cache] of latestRobotData.entries()) {
          if (cache.telemetry) {
            sendJson(socket, cache.telemetry);
          }

          if (cache.map) {
            sendJson(socket, cache.map);
          }

          if (cache.scan) {
            sendJson(socket, cache.scan);
          }

          if (cache.pose) {
            sendJson(socket, cache.pose);
          }

          if (cache.path) {
            sendJson(socket, cache.path);
          }
          if(cache.navigation){
            sendJson(socket, cache.navigation);
          }
        }


        console.log("Browser connected");
      }

      return;
    }
    if (socket.clientType === "robot") {
      const robotId =
          message.robot_id ||
          socket.robotId ||
          "ugv-01";

        if (!latestRobotData.has(robotId)) {
          latestRobotData.set(robotId, {});
        }

        const robotCache = latestRobotData.get(robotId);

        switch (message.type) {
          case "occupancy_grid":
          case "map":
            robotCache.map = message;
            break;

          case "laser_scan":
            robotCache.scan = message;
            break;

          case "telemetry":
            robotCache.telemetry = message;
            break;

          case "robot_pose":
            robotCache.pose = message;
            break;

          case "path":
            robotCache.path = message;
            break;
         
          case "navigation_status":
          case "navigation_feedback":
          case "navigation_result":
            robotCache.navigation = message;
            break;

          default:
            break;
        }

        broadcastToBrowsers(message);
        return;
    }
    
if (socket.clientType === "browser") {
  console.log("BROWSER");
  const robotId = String(
    message.robot_id || "ugv-01"
  );

  const robotSocket = clients.robots.get(robotId);

  console.log("[BROWSER RX]", {
    type: message.type,
    robot_id: robotId,
    message,
  });

  if (
    !robotSocket ||
    robotSocket.readyState !== WebSocket.OPEN
  ) {
    console.error(
      `[SERVER] Robot socket unavailable: ${robotId}`
    );

    sendJson(socket, {
      type: "error",
      robot_id: robotId,
      message: `Robot ${robotId} is not connected`,
    });

    return;
  }

  // ตรวจและจำกัด cmd_vel ก่อนส่ง
  if (message.type === "cmd_vel") {
    const linearX = Number(message.linear_x);
    const angularZ = Number(message.angular_z);

    if (
      !Number.isFinite(linearX) ||
      !Number.isFinite(angularZ)
    ) {
      console.error(
        "[SERVER] Invalid cmd_vel:",
        message
      );

      sendJson(socket, {
        type: "cmd_vel_error",
        robot_id: robotId,
        message: "Invalid linear_x or angular_z",
      });

      return;
    }

    message.linear_x = Math.max(
      -0.8,
      Math.min(0.8, linearX)
    );

    message.angular_z = Math.max(
      -1.5,
      Math.min(1.5, angularZ)
    );

    console.log(
      `[SERVER TX ROBOT] cmd_vel ${robotId}:`,
      `linear_x=${message.linear_x.toFixed(2)}`,
      `angular_z=${message.angular_z.toFixed(2)}`
    );
  }

  if (message.type === "navigate_to_pose") {
    const x = Number(message.x);
    const y = Number(message.y);
    const yaw = Number(message.yaw ?? 0);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(yaw)
    ) {
      console.error(
        "[SERVER] Invalid navigation goal:",
        message
      );

      sendJson(socket, {
        type: "navigate_to_pose_error",
        robot_id: robotId,
        message: "Invalid x, y or yaw",
      });

      return;
    }

    message.robot_id = robotId;
    message.frame_id = String(
      message.frame_id || "map"
    );
    message.x = x;
    message.y = y;
    message.yaw = yaw;

    console.log(
      `[SERVER TX ROBOT] navigate_to_pose ${robotId}:`,
      `frame=${message.frame_id}`,
      `x=${x.toFixed(3)}`,
      `y=${y.toFixed(3)}`,
      `yaw=${yaw.toFixed(3)}`
    );
  }

  if (message.type === "navigate_to_gps") {
    const lat = Number(message.latitude);
    const lon = Number(message.longitude);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      console.error(
        "[SERVER] Invalid GPS navigation goal:",
        message
      );

      sendJson(socket, {
        type: "navigate_to_gps_error",
        robot_id: robotId,
        message: "Invalid latitude or longitude",
      });

      return;
    }

    message.robot_id = robotId;
    message.latitude = lat;
    message.longitude = lon;

    console.log(
      `[SERVER TX ROBOT] navigate_to_gps ${robotId}:`,
      `lat=${lat.toFixed(7)}`,
      `lon=${lon.toFixed(7)}`
    );
  }

  if (
    message.type === "cancel_navigation" ||
    message.type === "emergency_stop"
  ) {
    message.robot_id = robotId;

    console.log(
      `[SERVER TX ROBOT] ${message.type} ${robotId}`
    );
  }

  // ส่งหลังจากตรวจสอบและปรับข้อมูลเรียบร้อยแล้ว
  sendJson(robotSocket, message);

  console.log(
    `[SERVER] Forwarded ${message.type} to ${robotId}`
  );

  return;
}



    // if (socket.clientType === "browser") {
    //   const robotId = message.robot_id || "ugv-01";
    //   const robotSocket = clients.robots.get(robotId);

    //   if (!robotSocket || robotSocket.readyState !== WebSocket.OPEN) {
    //     sendJson(socket, {
    //       type: "error",
    //       message: `Robot ${robotId} is not connected`,
    //     });
    //     return;
    //   }

    //   sendJson(robotSocket, message);
    //   if (message.type === "cmd_vel") {
    //     console.log(
    //       `cmd_vel ${message.robot_id}:`,
    //       `linear_x=${message.linear_x.toFixed(2)}`,
    //       `angular_z=${message.angular_z.toFixed(2)}`
    //     );
    //     const linearX = Number(message.linear_x);
    //     const angularZ = Number(message.angular_z);

    //     if (
    //       typeof linearX !== "number" ||
    //       typeof angularZ !== "number" ||
    //       !Number.isFinite(linearX) ||
    //       !Number.isFinite(angularZ)
    //     ) {
    //       console.error("Invalid linear_x or angular_z received.");
    //       return;
    //     }
    //     //limit speed
    //     message.linear_x = Math.max(
    //       -0.8,
    //       Math.min(0.8, linearX)
    //     );
    //     message.angular_z = Math.max(
    //       -1.5,
    //       Math.min(1.5, angularZ)
    //     );
       
    //   }
    // }
  });

  socket.on("close", () => {
    if (socket.clientType === "browser") {
      clients.browsers.delete(socket);
    }

    if (socket.clientType === "robot" && socket.robotId) {
      clients.robots.delete(socket.robotId);

      broadcastToBrowsers({
        type: "robot_status",
        robot_id: socket.robotId,
        connected: false,
      });

      console.log(`Robot disconnected: ${socket.robotId}`);
    }
  });

  socket.on("error", (error) => {
    console.error("WebSocket error:", error.message);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Web dashboard: http://localhost:${PORT}`);
  console.log(`Robot WebSocket: ws://192.168.1.129:${PORT}`);
});