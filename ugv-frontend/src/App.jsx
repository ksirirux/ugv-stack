import React, { useState, useEffect, useRef } from "react";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import RobotManagement from "./components/RobotManagement";
import RobotDetails from "./components/RobotDetails";
import LogViewer from "./components/LogViewer";
import Login from "./components/Login";
import UserManagement from "./components/UserManagement";
import { apiService } from "./services/apiService";

// Dynamic WebSocket URL routed through proxy to avoid port/SSL conflicts
const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws-api`;
console.log('[WS_URL]:', WS_URL);

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [robots, setRobots] = useState([]);
  const [selectedRobot, setSelectedRobot] = useState(null);

  // Real-time states
  const [wsConnections, setWsConnections] = useState({});
  const [telemetry, setTelemetry] = useState({});
  const [activeLogs, setActiveLogs] = useState([]); // Real-time incoming logs for selected robot
  const [stopStates, setStopStates] = useState({});

  const socketRef = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // Check localStorage on mount for active session and setup listeners
  useEffect(() => {
    const storedUser = localStorage.getItem("ugv_user");
    const storedToken = localStorage.getItem("ugv_token");
    if (storedUser && storedToken) {
      setUser(JSON.parse(storedUser));
      setToken(storedToken);
    }

    const handleAuthFailed = () => {
      handleLogout();
    };

    window.addEventListener("auth_failed", handleAuthFailed);
    return () => {
      window.removeEventListener("auth_failed", handleAuthFailed);
    };
  }, []);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    setToken(userData.token);
    localStorage.setItem("ugv_user", JSON.stringify(userData));
    localStorage.setItem("ugv_token", userData.token);
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("ugv_user");
    localStorage.removeItem("ugv_token");
    setSelectedRobot(null);
    setRobots([]);

    // Close WebSocket
    if (socketRef.current) {
      socketRef.current.close();
    }
  };

  // Load robots list (secured with auth headers)
  const fetchRobots = async () => {
    if (!token) return;
    try {
      const data = await apiService.getRobots();
      setRobots(data || []);
    } catch (err) {
      console.error("Error loading robots list:", err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchRobots();
    }
  }, [token]);

  // Connect to WebSocket Server (only when logged in)
  const connectWebSocket = () => {
    if (!token || socketRef.current) return;

    console.log(`Connecting to WebSocket: ${WS_URL}`);
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected to fleet server.");
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current);
        reconnectIntervalRef.current = null;
      }

      // Register as browser
      ws.send(JSON.stringify({
        type: "register",
        client: "browser",
        token: token
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log("[WS MESSAGE]:", message);
        const robotId = message.robot_id || "ugv-01";

        switch (message.type) {
          case "robot_list":
            const connectionMap = {};
            message.robots.forEach((r) => {
              connectionMap[r.robot_id] = r.connected;
            });
            setWsConnections(connectionMap);
            break;

          case "robot_status":
            setWsConnections((prev) => ({
              ...prev,
              [robotId]: message.connected,
            }));
            break;

          case "telemetry":
            setTelemetry((prev) => ({
              ...prev,
              [robotId]: message,
            }));
            break;

          case "stop_states":
            setStopStates((prev) => ({
              ...prev,
              [robotId]: message.stop_states,
            }));
            break;

          case "node_statuses":
            setTelemetry((prev) => ({
              ...prev,
              [robotId]: {
                ...(prev[robotId] || {}),
                node_statuses: message.statuses
              }
            }));
            break;

          case "robot_log":
            if (message.log) {
              setActiveLogs((prev) => [message.log, ...prev].slice(0, 50));
            }
            break;

          default:
            if (message.type) {
              setTelemetry((prev) => ({
                ...prev,
                [robotId]: {
                  ...(prev[robotId] || {}),
                  [message.type]: message
                }
              }));
            }
            break;
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket connection closed. Reconnecting...");
      socketRef.current = null;
      setWsConnections({});

      if (!reconnectIntervalRef.current && token) {
        reconnectIntervalRef.current = setInterval(() => {
          connectWebSocket();
        }, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      ws.close();
    };
  };

  const sendEmergencyStop = (robotId, stopType, value) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: "emergency_stop",
        robot_id: robotId,
        stop_type: stopType,
        value: value
      }));
    }
  };

  useEffect(() => {
    if (token) {
      connectWebSocket();
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current);
      }
    };
  }, [token]);

  // Clear real-time active logs when switching selected robots
  const handleSelectRobot = (robot) => {
    setActiveLogs([]);
    setSelectedRobot(robot);
  };

  // Render Login screen if not authenticated
  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={(tab) => { setSelectedRobot(null); setActiveTab(tab); }}
        user={user}
        onLogout={handleLogout}
      />

      {/* Main Panel Content */}
      <main className="main-content">
        {selectedRobot ? (
          <RobotDetails
            robot={selectedRobot}
            user={user}
            telemetry={telemetry}
            wsConnected={!!wsConnections[selectedRobot.robot_id]}
            onBack={() => setSelectedRobot(null)}
            activeLogs={activeLogs.filter(log => log.robot_id === selectedRobot.robot_id)}
            stopStates={stopStates[selectedRobot.robot_id] || selectedRobot.stop_states || { hardware_stop: false, operator_stop: false, admin_stop: false }}
            onSendEmergencyStop={sendEmergencyStop}
          />
        ) : (
          <>
            {activeTab === "dashboard" && (
              <Dashboard
                robots={robots}
                wsConnections={wsConnections}
                telemetry={telemetry}
                onSelectRobot={handleSelectRobot}
              />
            )}

            {activeTab === "robots" && (
              <RobotManagement
                user={user}
                robots={robots}
                onRefresh={fetchRobots}
              />
            )}

            {activeTab === "logs" && (
              <LogViewer
                robots={robots}
              />
            )}

            {activeTab === "users" && user && user.role === "admin" && (
              <UserManagement />
            )}
          </>
        )}
      </main>
    </div>
  );
}
