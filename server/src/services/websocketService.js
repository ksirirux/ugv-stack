import WebSocket, { WebSocketServer } from "ws";
import os from "os";
import jwt from "jsonwebtoken";
import Robot from "../models/Robot.js";
import RobotLog from "../models/RobotLog.js";
import User from "../models/User.js";

const robotOwners = new Map(); // robotId -> ownerUserId (string or null)

const clients = {
  robots: new Map(),
  browsers: new Set(),
  app: new Set(),
};

const latestRobotData = new Map();
const cloudConnections = new Map(); // robotId -> { socket, interval }

function sendJson(socket, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

function broadcastToBrowsers(data) {
  const robotId = data.robot_id;
  
  for (const socket of clients.browsers) {
    if (!socket.user) continue;

    // Admin role receives all logs and telemetries
    if (socket.user.role === "admin") {
      sendJson(socket, data);
      continue;
    }

    // Operators only receive data for robots they own
    if (robotId) {
      
      const ownerId = robotOwners.get(robotId);
      if (ownerId && socket.user.id === ownerId) {
        sendJson(socket, data);
      }
    } else {
      // General broad system notifications
      sendJson(socket, data);
    }
  }

  // Also broadcast to connected App clients
  broadcastToApp(data);
}

function broadcastToApp(data) {
  const robotId = data.robot_id;
  //console.log(`[WebSocket] Broadcasting to App: ${robotId}`);
  for (const socket of clients.app) {
    if (!socket.user) continue;
    console.log(`[WebSocket] Sending to App: ${socket.user.username} - ${socket.robotId}`);

    // Admin role receives all logs and telemetries
    if (socket.user.role === "admin") {
      sendJson(socket, data);
      continue;
    }

    // Operators only receive data for robots they own
    if (robotId) {
      if (socket.robotId === robotId) {
        sendJson(socket, data);
      }
    } else {
      // General broad system notifications
      sendJson(socket, data);
    }
  }
}

// --- Cloud WebSocket Client Management ---
function connectToCloud(robotId, accessToken) {
  if (cloudConnections.has(robotId)) {
    const existing = cloudConnections.get(robotId);
    clearInterval(existing.interval);
    existing.socket.close();
  }

  const cloudUrl = `wss://api.tat-ugv.com/ws/robot?robot_id=${robotId}&token=${accessToken}`;
  console.log(`[Cloud] Connecting to Cloud WebSocket for robot ${robotId}...`);

  const cloudSocket = new WebSocket(cloudUrl);

  const activeConnection = {
    socket: cloudSocket,
    interval: null
  };
  cloudConnections.set(robotId, activeConnection);

  cloudSocket.on("open", () => {
    console.log(`[Cloud] Connected to Cloud WebSocket for robot: ${robotId}`);

    // telemetry_sender task: publishes every 1.0 second
    activeConnection.interval = setInterval(async () => {
      if (cloudSocket.readyState === WebSocket.OPEN) {
        const cache = latestRobotData.get(robotId) || {};
        
        // Fetch latest 5 logs from MongoDB for this robot
        let latestLogs = [];
        try {
          const logs = await RobotLog.find({ robot_id: robotId })
            .sort({ createdAt: -1 })
            .limit(5);
          latestLogs = logs.map(l => ({
            level: l.level,
            message: l.message,
            timestamp: l.createdAt
          }));
        } catch (err) {
          console.error(`[Cloud] Failed to fetch latest logs for ${robotId}:`, err);
        }

        const telemetryMessage = {
          type: "telemetry_sender",
          robot_id: robotId,
          timestamp: Date.now(),
          
          // GPS / RTK
          gps: {
            latitude: cache.telemetry?.latitude ?? cache.telemetry?.gps_lat ?? 0,
            longitude: cache.telemetry?.longitude ?? cache.telemetry?.gps_lon ?? 0,
            altitude: cache.telemetry?.altitude ?? cache.telemetry?.gps_alt ?? 0,
            gps_status: cache.telemetry?.gps_status ?? "Offline",
            gps_fix_type: cache.telemetry?.gps_fix_type ?? 0,
            rtk_status: cache.telemetry?.rtk_status ?? "Offline",
            heading: cache.telemetry?.heading ?? cache.pose?.yaw ?? 0
          },

          // Logs
          latest_logs: latestLogs,

          // Sensor (LiDAR)
          sensor: {
            laser_scan: cache.scan ?? null
          },

          // Robot Info
          robot_info: {
            name: cache.telemetry?.robot_name || robotId,
            id: robotId,
            code: cache.telemetry?.robot_code || "ugv",
            battery: cache.telemetry?.battery ?? cache.telemetry?.battery_percentage ?? 0
          },

          // Device Status
          device_status: {
            motor: cache.telemetry?.motor_status ?? "Offline",
            imu: cache.telemetry?.imu_status ?? "Offline",
            gps: cache.telemetry?.gps_status ?? "Offline",
            camera: cache.telemetry?.camera_status ?? "Offline"
          }
        };

        cloudSocket.send(JSON.stringify(telemetryMessage));
      }
    }, 1000);
  });

  cloudSocket.on("message", (data) => {
    try {
      const command = JSON.parse(data.toString());
      console.log(`[Cloud Message RX] Command for ${robotId}:`, command);

      const robotSocket = clients.robots.get(robotId);
      if (robotSocket && robotSocket.readyState === WebSocket.OPEN) {
        robotSocket.send(JSON.stringify(command));
        console.log(`[Cloud -> Robot] Forwarded command to local robot ${robotId}`);
      }
    } catch (err) {
      console.error(`[Cloud Message] Error parsing or forwarding cloud command for ${robotId}:`, err);
    }
  });

  cloudSocket.on("close", () => {
    console.log(`[Cloud] Cloud WebSocket connection closed for robot: ${robotId}`);
    clearInterval(activeConnection.interval);
    cloudConnections.delete(robotId);

    const localRobotSocket = clients.robots.get(robotId);
    if (localRobotSocket && localRobotSocket.readyState === WebSocket.OPEN) {
      console.log(`[Cloud] Local robot ${robotId} is still connected. Reconnecting to cloud in 5s...`);
      setTimeout(() => {
        const activeLocalSocket = clients.robots.get(robotId);
        if (activeLocalSocket && activeLocalSocket.readyState === WebSocket.OPEN) {
          connectToCloud(robotId, accessToken);
        }
      }, 5000);
    }
  });

  cloudSocket.on("error", (err) => {
    console.error(`[Cloud] WebSocket error for robot ${robotId}:`, err.message);
    cloudSocket.close();
  });
}

// --- Node Status Tracking ---
const lastReceived = {
  wifi: Date.now(),
  imu: 0,
  esp32: 0,
  gps: 0,
  lidar: 0,
  navigation: 0
};

let latestSystemState = 0;

const nodeStates = {
  wifi: "Offline",
  imu: "Offline",
  esp32: "Offline",
  gps: "Offline",
  lidar: "Offline",
  navigation: "Offline"
};

function updateNodeStatuses() {
  const now = Date.now();
  const timeout = 4000; // 4 seconds

  // wifi
  const isRobotWsConnected = Array.from(clients.robots.values()).some(s => s.readyState === WebSocket.OPEN);
  if (isRobotWsConnected) {
    nodeStates.wifi = "OK";
  } else {
    nodeStates.wifi = "Offline";
  }

  // If wifi is offline, all other nodes are offline
  if (nodeStates.wifi === "Offline") {
    nodeStates.imu = "Offline";
    nodeStates.esp32 = "Offline";
    nodeStates.gps = "Offline";
    nodeStates.lidar = "Offline";
    nodeStates.navigation = "Offline";
    return;
  }

  // imu
  if (now - lastReceived.imu < timeout) {
    nodeStates.imu = "OK";
  } else {
    nodeStates.imu = "Offline";
  }

  // esp32
  if (now - lastReceived.esp32 < timeout) {
    if (latestSystemState < 0) {
      nodeStates.esp32 = "Error";
    } else {
      nodeStates.esp32 = "OK";
    }
  } else {
    nodeStates.esp32 = "Offline";
  }

  // gps
  if (now - lastReceived.gps < timeout) {
    nodeStates.gps = "OK";
  } else {
    nodeStates.gps = "Offline";
  }

  // lidar
  if (now - lastReceived.lidar < timeout) {
    nodeStates.lidar = "OK";
  } else {
    nodeStates.lidar = "Offline";
  }

  // navigation
  if (isRobotWsConnected) {
    nodeStates.navigation = "OK";
  } else {
    nodeStates.navigation = "Offline";
  }
}

export function initWebSocket(server) {
  const wss = new WebSocketServer({ server });

  // Start periodic status broadcast
  const statusInterval = setInterval(() => {
    updateNodeStatuses();
    broadcastToBrowsers({
      type: "node_statuses",
      robot_id: "ugv-01",
      statuses: nodeStates
    });
  }, 1000);

  wss.on("connection", (socket, request) => {
    console.log("New WebSocket connection:", request.socket.remoteAddress);
    
    socket.clientType = "unknown";
    socket.robotId = null;
    socket.on("message", async (rawData) => {
      let message;

      try {
        message = JSON.parse(rawData.toString());
        //console.log(`[WS Auth] Raw message: ${JSON.stringify(message)}`);
      } catch (error) {
        sendJson(socket, {
          type: "error",
          message: "Invalid JSON",
        });
        return;
      }


      if (message.type === "register") {
        if (message.client === "robot") {
          
          const robotId = message.robot_id ;
          const token = message.token;
          console.log(`[WS Auth] Registering robot ${robotId} with token ${token}`);

          let robot;
          try {
            robot = await Robot.findOne({ robot_id: robotId });
            if (!robot) {
              console.log(`[WS Auth] Robot registration failed: Robot ${robotId} not registered in DB`);
              sendJson(socket, {
                type: "error",
                message: `Robot ${robotId} is not registered in DB. Please register via Dashboard.`,
              });
              socket.close();
              return;
            }
            if (robot.token !== token) {
              console.log(`[WS Auth] Robot registration failed: Invalid token for robot ${robotId}`);
              sendJson(socket, {
                type: "error",
                message: "Invalid registration token",
              });
              socket.close();
              return;
            }

            // If software version is reported in registration, record it
            const reportedVersion = message.software_version || message.version;
            if (reportedVersion) {
              const latestHistory = robot.software_history[robot.software_history.length - 1];
              if (!latestHistory || latestHistory.version !== reportedVersion) {
                robot.software_history.push({
                  version: reportedVersion,
                  installed_at: new Date()
                });
                await robot.save();
                console.log(`[WS Auth] Software version updated for ${robotId} to ${reportedVersion}`);
              }
            }
          } catch (err) {
            console.error("[WS Auth] Error verifying robot:", err);
            sendJson(socket, {
              type: "error",
              message: "Internal server error during verification",
            });
            socket.close();
            return;
          }

          socket.clientType = "robot";
          socket.robotId = robotId;
          clients.robots.set(robotId, socket);

          // Cache owner ID in memory for rapid lookup
          robotOwners.set(robotId, robot.owner ? robot.owner.toString() : null);

          // Cache stop states in memory
          if (!latestRobotData.has(robotId)) {
            latestRobotData.set(robotId, {});
          }
          const cache = latestRobotData.get(robotId);
          cache.stop_states = {
            hardware_stop: (robot.stop_states && robot.stop_states.hardware_stop) || false,
            operator_stop: (robot.stop_states && robot.stop_states.operator_stop) || false,
            admin_stop: (robot.stop_states && robot.stop_states.admin_stop) || false
          };

          console.log(`Robot connected: ${robotId}`);

          // Connect to Cloud WebSocket gateway
          connectToCloud(robotId, token);

          // Send current E-Stop state to the physical robot upon registration
          const initialCombinedStop = cache.stop_states.hardware_stop || 
                                      cache.stop_states.operator_stop || 
                                      cache.stop_states.admin_stop;
          sendJson(socket, {
            type: "emergency_stop",
            robot_id: robotId,
            value: initialCombinedStop,
            stop_states: cache.stop_states
          });

          broadcastToBrowsers({
            type: "robot_status",
            robot_id: robotId,
            connected: true,
          });
        }

        if (message.client === "browser") {
          console.log("[WS AUTH] Registering browser...", message);
          const browserToken = message.token;
          if (!browserToken) {
            console.log("[WS Auth] Browser registration failed: No token provided");
            sendJson(socket, { type: "error", message: "Authentication token required" });
            socket.close();
            return;
          }

          let decodedUser = null;
          try {
            const decoded = jwt.verify(browserToken, process.env.JWT_SECRET || "ugv-secret-key");
            const user = await User.findById(decoded.id).select("role username");
            if (!user) {
              console.log("[WS Auth] Browser registration failed: User not found in DB");
              sendJson(socket, { type: "error", message: "User not found" });
              socket.close();
              return;
            }
            decodedUser = {
              id: user._id.toString(),
              role: user.role,
              username: user.username
            };
            
            socket.user = decodedUser;
            console.log(`[WS Auth] Browser connected & authenticated: ${user.username} (${user.role})`);
          } catch (err) {
            console.log("[WS Auth] Browser registration failed: Invalid token");
            sendJson(socket, { type: "error", message: "Invalid or expired token" });
            socket.close();
            return;
          }

          socket.clientType = "browser";
          clients.browsers.add(socket);

          const robotStatus = [];

          // Query owned robots if operator
          let ownedRobotIds = [];
          if (decodedUser.role !== "admin") {
            const ownedRobots = await Robot.find({ owner: decodedUser.id });
            ownedRobotIds = ownedRobots.map(r => r.robot_id);
          }

          for (const [id, s] of clients.robots) {
            if (decodedUser.role === "admin" || ownedRobotIds.includes(id)) {
              robotStatus.push({
                robot_id: id,
                connected: s.readyState === WebSocket.OPEN,
              });
            }
          }

          sendJson(socket, {
            type: "robot_list",
            robots: robotStatus,
          });

          // Send any cached telemetry to the browser immediately for all active nodes
          for (const [id, cache] of latestRobotData) {
            if (decodedUser.role === "admin" || ownedRobotIds.includes(id)) {
              if (cache.telemetry) {
                sendJson(socket, cache.telemetry);
              }
              if (cache.pose) {
                sendJson(socket, cache.pose);
              }
              if (cache.path) {
                sendJson(socket, cache.path);
              }
              if (cache.navigation) {
                sendJson(socket, cache.navigation);
              }
              if (cache.stop_states) {
                sendJson(socket, {
                  type: "stop_states",
                  robot_id: id,
                  stop_states: cache.stop_states
                });
              }
            }
          }

          console.log("Browser connected");
        }
        if (message.client === "app") {
            const appToken = message.token;
            const robot_id=message.robot_id;
            
            if (!appToken) {
              console.log("[WS Auth] App registration failed: No token provided");
              sendJson(socket, { type: "error", message: "Authentication token required" });
              socket.close();
              return;
            }

            let decodedUser = null;
            try {
              const decoded = jwt.verify(appToken, process.env.JWT_SECRET || "ugv-secret-key");
              const user = await User.findById(decoded.id).select("role username");
              if (!user) {
                console.log("[WS Auth] App registration failed: User not found in DB");
                sendJson(socket, { type: "error", message: "User not found" });
                socket.close();
                return;
              }
              decodedUser = {
                id: user._id.toString(),
                role: user.role,
                username: user.username
              };
              console.log('[websocketService-decodedUser]: ', decodedUser);
              socket.user = decodedUser;
              console.log(`[WS Auth] App connected & authenticated: ${user.username} (${user.role}) for robot ${robot_id}`);
            } catch (err) {
              console.log("[WS Auth] App registration failed: Invalid token");
              sendJson(socket, { type: "error", message: "Invalid or expired token" });
              socket.close();
              return;
            }
            
             // Check if user owns robot
            const robot = await Robot.findOne({ robot_id: robot_id, owner: decodedUser.id });
            if (!robot) {
              console.log("[WS Auth] App registration failed: User does not own robot");
              sendJson(socket, { type: "error", message: "You do not own this robot" });
              socket.close();
              return;
            }

            socket.clientType = "app";
            socket.robotId = robot_id;
            clients.app.add(socket);

            sendJson(socket, {
              type: "robot_status",
              robot_id: robot_id,
              connected: true,
            });

            // Send any cached telemetry to the app immediately
            const cache = latestRobotData.get(robot_id);
            if (cache) {
              if (cache.telemetry) {
                sendJson(socket, cache.telemetry);
              }
              if (cache.pose) {
                sendJson(socket, cache.pose);
              }
              if (cache.path) {
                sendJson(socket, cache.path);
              }
              if (cache.navigation) {
                sendJson(socket, cache.navigation);
              }
              if (cache.stop_states) {
                sendJson(socket, {
                  type: "stop_states",
                  robot_id: robot_id,
                  stop_states: cache.stop_states
                });
              }
            }
        }

        return;
      } //end of register

      if (socket.clientType === "robot" || message.type === "telemetry") {
        socket.clientType="robot";

        lastReceived.wifi = Date.now();
        const robotId =
            message.robot_id ||
            socket.robotId ||
            "ugv-01";

        if (!latestRobotData.has(robotId)) {
          latestRobotData.set(robotId, {});
        }

        //console.log(`[WS Robot] Received message type: ${message.type} ${robotId}`);
        const robotCache = latestRobotData.get(robotId);
        //console.log("robotCache:",robotCache);

        // Auto-save logs to database for errors/warnings/custom logs
        let shouldLog = false;
        let logLevel = "info";
        let logMsg = "";

        if (message.type === "error" || message.level === "error") {
          shouldLog = true;
          logLevel = "error";
          logMsg = message.message || "Error reported by robot";
        } else if (message.type === "warning" || message.level === "warn") {
          shouldLog = true;
          logLevel = "warn";
          logMsg = message.message || "Warning reported by robot";
        } else if (message.type === "log") {
          shouldLog = true;
          logLevel = message.level || "info";
          logMsg = message.message || "";
        }

        if (shouldLog && logMsg) {
          const logEntry = new RobotLog({
            robot_id: robotId,
            level: logLevel,
            message: logMsg
          });
          logEntry.save().catch(e => console.error("Error saving automatic robot log:", e));
        }

        // Cache incoming data by type and broadcast to browsers
        if (message.type === "telemetry") {
          robotCache.telemetry = message;
          if (message.telemetry) {
            lastReceived.gps = Date.now();
            lastReceived.imu = Date.now();
            lastReceived.esp32 = Date.now();
            latestSystemState = message.telemetry.system_state || 0;

            const innerTelemetry = message.telemetry || {};
            const hwStopValue = innerTelemetry.hardware_stop !== undefined 
              ? !!innerTelemetry.hardware_stop 
              : (message.hardware_stop !== undefined ? !!message.hardware_stop : undefined);

            if (hwStopValue !== undefined && robotCache.stop_states && robotCache.stop_states.hardware_stop !== hwStopValue) {
              robotCache.stop_states.hardware_stop = hwStopValue;

              // Persist stop state changes to MongoDB
              Robot.findOneAndUpdate(
                { robot_id: robotId },
                { "stop_states.hardware_stop": hwStopValue }
              ).catch(e => console.error("[WS Safety] Error saving hardware_stop status:", e));

              // Broadcast updated stop_states immediately
              broadcastToBrowsers({
                type: "stop_states",
                robot_id: robotId,
                stop_states: robotCache.stop_states
              });
            }
          }
          broadcastToBrowsers(message);
          broadcastToApp(message);
        } else if (message.type === "pose") {
          robotCache.pose = message;
          broadcastToBrowsers(message);
          broadcastToApp(message);
        } else if (message.type === "path") {
          robotCache.path = message;
          broadcastToBrowsers(message);
        } else if (message.type === "scan") {
          lastReceived.lidar = Date.now();
          robotCache.scan = message.scan;
          broadcastToBrowsers(message);
        } else if (message.type === "navigation") {
          lastReceived.navigation = Date.now();
          robotCache.navigation = message;
          broadcastToBrowsers(message);
        } else if (message.type === "cmd_vel") {
          broadcastToBrowsers(message);
        }
      }

      if (socket.clientType === "browser" || socket.clientType === "app") {
        if (message.type === "cmd_vel" || message.type === "navigation") {
          const robotId = message.robot_id || "ugv-01";
          
          // Verify browser permission to send controls
          const ownerId = robotOwners.get(robotId);
          if (socket.user && socket.user.role !== "admin" && (!ownerId || socket.user.id !== ownerId)) {
            console.log(`[WS Command Denied] User ${socket.user.username} tried to control unauthorized robot ${robotId}`);
            return;
          }

          const robotSocket = clients.robots.get(robotId);
          if (robotSocket) {
            sendJson(robotSocket, message);
          }
        }

        if (message.type === "emergency_stop") {
          const robotId = message.robot_id;
          const stopType = message.stop_type; // "operator" or "admin"
          const stopValue = !!message.value;

          if (!robotId || !["operator", "admin"].includes(stopType)) {
            sendJson(socket, { type: "error", message: "Invalid E-Stop configuration params" });
            return;
          }

          // Permission checks:
          const ownerId = robotOwners.get(robotId);
          const userRole = socket.user?.role;
          const userId = socket.user?.id;

          if (stopType === "admin" && userRole !== "admin") {
            console.log(`[WS Safety Denied] User ${socket.user?.username} cannot modify Admin E-Stop`);
            sendJson(socket, { type: "error", message: "Admin authorization required to toggle Admin Stop" });
            return;
          }

          if (stopType === "operator" && userRole !== "admin" && (!ownerId || userId !== ownerId)) {
            console.log(`[WS Safety Denied] User ${socket.user?.username} cannot modify Operator E-Stop for ${robotId}`);
            sendJson(socket, { type: "error", message: "Ownership or Admin status required to toggle Operator Stop" });
            return;
          }

          // Fetch or initialize latestRobotData cache
          if (!latestRobotData.has(robotId)) {
            latestRobotData.set(robotId, {});
          }
          const robotCache = latestRobotData.get(robotId);
          if (!robotCache.stop_states) {
            robotCache.stop_states = { hardware_stop: false, operator_stop: false, admin_stop: false };
          }

          // Apply state change in memory cache
          if (stopType === "admin") {
            robotCache.stop_states.admin_stop = stopValue;
          } else {
            robotCache.stop_states.operator_stop = stopValue;
          }

          // Persist the state in MongoDB
          const targetField = stopType === "admin" ? "stop_states.admin_stop" : "stop_states.operator_stop";
          Robot.findOneAndUpdate(
            { robot_id: robotId },
            { [targetField]: stopValue },
            { new: true }
          ).then(updated => {
            console.log(`[WS Safety] ${stopType.toUpperCase()} stop updated to ${stopValue} for robot ${robotId}`);

            // Broadcast the entire E-Stop states structure to all open dashboards
            broadcastToBrowsers({
              type: "stop_states",
              robot_id: robotId,
              stop_states: robotCache.stop_states
            });

            // Calculate combined stop status
            const combinedStop = robotCache.stop_states.hardware_stop || 
                                 robotCache.stop_states.operator_stop || 
                                 robotCache.stop_states.admin_stop;

            // Route command to physical robot
            const robotSocket = clients.robots.get(robotId);
            if (robotSocket) {
              sendJson(robotSocket, {
                type: "emergency_stop",
                robot_id: robotId,
                value: combinedStop,
                stop_states: robotCache.stop_states
              });
            }
          }).catch(err => {
            console.error("Failed to save stop state updates to DB:", err);
            sendJson(socket, { type: "error", message: "Database write error" });
          });
        }
      }
    });

    socket.on("close", () => {
      if (socket.clientType === "browser") {
        clients.browsers.delete(socket);
      }

      if (socket.clientType === "app") {
        clients.app.delete(socket);
      }

      if (socket.clientType === "robot" && socket.robotId) {
        clients.robots.delete(socket.robotId);

        // Clean up cloud connection
        if (cloudConnections.has(socket.robotId)) {
          const cloudConn = cloudConnections.get(socket.robotId);
          clearInterval(cloudConn.interval);
          cloudConn.socket.close();
          cloudConnections.delete(socket.robotId);
          console.log(`[Cloud] Cleaned up cloud connection for disconnected robot: ${socket.robotId}`);
        }

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

  // Return clean-up handler if needed
  return () => {
    clearInterval(statusInterval);
  };
}
export default initWebSocket;
