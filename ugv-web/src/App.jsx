import { useEffect, useRef, useState, useMemo } from "react";
import "./App.css";
import GpsMap from "./components/GpsMap";
import RobotControl from "./components/RobotControl";
import NavigationPanel from "./components/NavigationPanel";
import CameraStream from "./components/CameraStream";
import FirmwareUpdateCard from "./components/FirmwareUpdateCard";
import MapCanvas from "./components/MapCanvas";
import JobPlanner from "./components/JobPlanner";
import JobPlannerAI from "./components/JobPlanner_AI";
import Dashboard from "./components/Dashboard";


const WEBSOCKET_URL =
  import.meta.env.VITE_WEBSOCKET_URL ??
  "wss://app.tat-ugv.com";

function getLatLngDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
  const R = 6371000; // Radius of the earth in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

const ROBOT_ID =
  import.meta.env.VITE_ROBOT_ID ??
  "ugv-01";

const NAVIGATION_BUSY_STATUSES = [
  "sending_goal",
  "accepted",
  "navigating",
];

export default function App() {
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const lastScanTimerRef = useRef(null);

  const [serverConnected, setServerConnected] = useState(false);
  const [robotConnected, setRobotConnected] = useState(false);

  const [controlMode, setControlMode] = useState("manual");
  const isManualMode = controlMode === "manual";
  const isAutoMode = controlMode === "auto";

  const [mapMode, setMapMode] = useState("outdoor"); // "outdoor" or "indoor"
  const [activeTab, setActiveTab] = useState("dashboard"); // "dashboard" or "planner"


  const [laserScan, setLaserScan] = useState(null);
  const [battery, setBattery] = useState(null);
  const [gps, setGps] = useState(null);
  const [occupancyGrid, setOccupancyGrid] = useState(null);
  const [robotPose, setRobotPose] = useState(null);
  const [navigationGoal, setNavigationGoal] = useState(null);
  const [path, setPath] = useState(null);
  const [gpsHistory, setGpsHistory] = useState([]);
  const [nodeStatuses, setNodeStatuses] = useState({
    wifi: "Offline",
    imu: "Offline",
    esp32: "Offline",
    gps: "Offline",
    lidar: "Offline",
    navigation: "Offline"
  });

  const [navigation, setNavigation] = useState({
    status: "idle",
    distanceRemaining: null,
    estimatedTimeRemainingSec: null,
    navigationTimeSec: null,
    recoveries: null,
    message: "",
  });

  const computedDistanceRemaining = useMemo(() => {
    if (
      navigationGoal &&
      navigationGoal.frame_id === "wgs84" &&
      gps &&
      gps.latitude !== null &&
      gps.longitude !== null
    ) {
      const dist = getLatLngDistance(
        Number(gps.latitude),
        Number(gps.longitude),
        Number(navigationGoal.latitude || navigationGoal.x),
        Number(navigationGoal.longitude || navigationGoal.y)
      );
      return Number.isFinite(dist) ? dist : null;
    }
    return navigation.distanceRemaining;
  }, [gps, navigationGoal, navigation.distanceRemaining]);

  const navigationBusy = NAVIGATION_BUSY_STATUSES.includes(
    navigation.status
  );

  useEffect(() => {
    let componentDestroyed = false;

    function connectWebSocket() {
      const socket = new WebSocket(WEBSOCKET_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("WebSocket connected:", WEBSOCKET_URL);
        setServerConnected(true);

        socket.send(
          JSON.stringify({
            type: "register",
            client: "browser",
          })
        );
      };

      socket.onmessage = (event) => {
        let message;

        try {
          message = JSON.parse(event.data);
        } catch (error) {
          console.error("Invalid JSON received:", error);
          return;
        }

        processMessage(message);
      };

      socket.onerror = (error) => {
        console.error("WebSocket connection error", {
          url: WEBSOCKET_URL,
          readyState: socket.readyState,
          event,
        });
      };

      socket.onclose = () => {
        console.warn("WebSocket disconnected");
        setServerConnected(false);
        setRobotConnected(false);
        setLaserScan(null);
        setNodeStatuses({
          wifi: "Offline",
          imu: "Offline",
          esp32: "Offline",
          gps: "Offline",
          lidar: "Offline",
          navigation: "Offline"
        });

        if (!componentDestroyed) {
          reconnectTimerRef.current = window.setTimeout(
            connectWebSocket,
            2000
          );
        }
      };
    }

    function processMessage(message) {
      if (
        message.type === "node_statuses" &&
        message.robot_id === ROBOT_ID
      ) {
        setNodeStatuses(message.statuses);
        return;
      }

      if (
        message.type === "robot_status" &&
        message.robot_id === ROBOT_ID
      ) {
        setRobotConnected(Boolean(message.connected));
        return;
      }

      if (message.type === "robot_list") {
        const robot = message.robots?.find(
          (item) => item.robot_id === ROBOT_ID
        );

        setRobotConnected(Boolean(robot?.connected));
        return;
      }

      if (message.robot_id !== ROBOT_ID) {
        return;
      }

      if (message.type === "telemetry") {
        console.log("[Telemetry]:", message);
        setBattery(message.battery);

        const newLat = Number(message.latitude);
        const newLon = Number(message.longitude);

        setGps({
          latitude: newLat,
          longitude: newLon,
          altitude: message.altitude,
          status: message.gps_status,
          rtk_status: message.rtk_status,
        });

        // Record history of coordinates
        if (Number.isFinite(newLat) && Number.isFinite(newLon) && newLat !== 0 && newLon !== 0) {
          setGpsHistory((prev) => {
            if (prev.length === 0) {
              return [[newLat, newLon]];
            }
            const lastPoint = prev[prev.length - 1];
            const dist = getLatLngDistance(lastPoint[0], lastPoint[1], newLat, newLon);
            if (dist > 0.2) {
              const updated = [...prev, [newLat, newLon]];
              if (updated.length > 2000) {
                updated.shift();
              }
              return updated;
            }
            return prev;
          });
        }

        // Compute GPS navigation feedback locally if goal is active
        if (navigationGoal && navigationGoal.frame_id === "wgs84") {
          const goalLat = navigationGoal.latitude || navigationGoal.x;
          const goalLon = navigationGoal.longitude || navigationGoal.y;
          const dist = getLatLngDistance(
            message.latitude,
            message.longitude,
            goalLat,
            goalLon
          );

          setNavigation((current) => ({
            ...current,
            status: current.status === "sending_goal" ? "navigating" : current.status,
            distanceRemaining: dist,
          }));
        }
        return;
      }
      if (message.type === "navigation_result") {
        console.log("[Goal Status]:", message);
        setNavigation((current) => ({
          ...current,
          status: message.status ?? current.status,
        }));
        if (message.status === "succeeded") {
          setNavigationGoal(null);
          alert("ถึงจุดหมายแล้ว")
        }
        if (message.status === "failed") {
          alert("ส่งภารกิจไม่สำเร็จ")
        }
        if (message.status === "canceled") {
          alert("ยกเลิกภารกิจ")
        }
        if (message.status === "aborted") {
          alert("ยกเลิกภารกิจ")
        }
      }

      if (message.type === "laser_scan") {
        setLaserScan(message);

        if (lastScanTimerRef.current) {
          window.clearTimeout(lastScanTimerRef.current);
        }

        lastScanTimerRef.current = window.setTimeout(() => {
          setLaserScan(null);
        }, 1500);
        return;
      }

      if (message.type === "occupancy_grid") {
        setOccupancyGrid(message);
        return;
      }

      if (message.type === "robot_pose") {
        setRobotPose(message);
        return;
      }

      if (message.type === "path") {
        setPath(message);
        return;
      }

      if (message.type === "navigation_status") {
        setNavigation((current) => ({
          ...current,
          status: message.status ?? current.status,
          message: message.message ?? "",
        }));
        return;
      }

      if (message.type === "navigation_feedback") {
        setNavigation((current) => ({
          ...current,
          status: message.status ?? "navigating",
          distanceRemaining:
            message.distance_remaining ?? current.distanceRemaining,
          estimatedTimeRemainingSec:
            message.estimated_time_remaining_sec ??
            current.estimatedTimeRemainingSec,
          navigationTimeSec:
            message.navigation_time_sec ?? current.navigationTimeSec,
          recoveries:
            message.number_of_recoveries ?? current.recoveries,
          message: "",
        }));
        return;
      }

      if (message.type === "navigation_result") {
        setNavigation((current) => ({
          ...current,
          status: message.status ?? "unknown",
          message:
            message.error_msg ??
            message.message ??
            "",
        }));

        if (message.status === "succeeded") {
          alert("🎉 หุ่นยนต์เดินทางถึงจุดหมายปลายทางเรียบร้อยแล้ว!");
        } else if (message.status === "failed") {
          alert(`⚠️ การนำทางล้มเหลว: ${message.error_msg || message.message || ""}`);
        } else if (message.status === "canceled") {
          alert("⏹️ การนำทางถูกยกเลิก");
        }

        setControlMode("manual");
        setPath(null);
        setNavigationGoal(null); // Reset/Clear goal for new one
      }
    }

    connectWebSocket();

    return () => {
      componentDestroyed = true;

      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }

      if (lastScanTimerRef.current) {
        window.clearTimeout(lastScanTimerRef.current);
      }

      const socket = socketRef.current;

      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "cmd_vel",
            robot_id: ROBOT_ID,
            linear_x: 0,
            angular_z: 0,
            timestamp: Date.now(),
          })
        );
      }

      socket?.close();
    };
  }, []);

  function sendRobotMessage(payload) {
    const socket = socketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("ERROR SOCKET", socket.readyState);
      setNavigation((current) => ({
        ...current,
        status: "server_disconnected",
        message: "WebSocket server is disconnected",
      }));
      return false;
    }
    console.log("sendRobotMessage", payload);
    socket.send(
      JSON.stringify({
        ...payload,
        robot_id: ROBOT_ID,
      })
    );

    return true;
  }

  function startNavigation() {
    if (!navigationGoal) {
      return;
    }
    setControlMode("auto");
    setGpsHistory([]); // Clear history on start navigation

    let payload;
    if (navigationGoal.frame_id === "wgs84") {
      payload = {
        type: "navigate_to_gps",
        latitude: navigationGoal.latitude || navigationGoal.x,
        longitude: navigationGoal.longitude || navigationGoal.y,
      };
    } else {
      payload = {
        type: "navigate_to_pose",
        frame_id: navigationGoal.frame_id || "map",
        x: navigationGoal.x,
        y: navigationGoal.y,
        yaw: navigationGoal.yaw ?? 0,
      };
    }

    const sent = sendRobotMessage(payload);

    if (sent) {
      setNavigation({
        status: "sending_goal",
        distanceRemaining: null,
        estimatedTimeRemainingSec: null,
        navigationTimeSec: null,
        recoveries: null,
        message: "",
      });

    }
  }

  function cancelNavigation() {
    if (sendRobotMessage({ type: "cancel_navigation" })) {
      setNavigation((current) => ({
        ...current,
        status: "canceling",
      }));
      setControlMode("manual");
      setPath(null);
    }
  }

  function emergencyStop() {
    sendRobotMessage({ type: "emergency_stop" });

    setNavigation((current) => ({
      ...current,
      status: "emergency_stop",
    }));
    setControlMode("manual");
  }

  function clearGoal() {
    setNavigationGoal(null);
    setNavigation({
      status: "idle",
      distanceRemaining: null,
      estimatedTimeRemainingSec: null,
      navigationTimeSec: null,
      recoveries: null,
      message: "",
    });
    setControlMode("manual");
    setGpsHistory([]); // Clear history on clear goal
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>UGV Dashboard</h1>
          <p>Robot ID: {ROBOT_ID}</p>
        </div>

        <div className="connection-group">
          <StatusItem label="Server" connected={serverConnected} />
          <StatusItem label="Robot" connected={robotConnected} />
        </div>
      </header>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', borderBottom: '2px solid #cbd5e1', paddingBottom: '12px' }}>
        <button
          onClick={() => setActiveTab('dashboard')}
          style={{
            padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', border: 'none',
            background: activeTab === 'dashboard' ? '#2563eb' : '#cbd5e1',
            color: activeTab === 'dashboard' ? 'white' : '#1f2937',
            transition: '0.2s'
          }}
        >
          🕹️ ควบคุมรถ (Dashboard)
        </button>
        <button
          onClick={() => setActiveTab('planner')}
          style={{
            padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', border: 'none',
            background: activeTab === 'planner' ? '#f59e0b' : '#cbd5e1',
            color: activeTab === 'planner' ? 'white' : '#1f2937',
            transition: '0.2s'
          }}
        >
          🗺️ สร้างแผนงานรถ (Create Job)
        </button>
        <button onClick={() => setActiveTab("planner-ai")}
          style={{
            padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', border: 'none',
            background: activeTab === 'planner-ai' ? '#f59e0b' : '#cbd5e1',
            color: activeTab === 'planner-ai' ? 'white' : '#1f2937',
            transition: '0.2s'
          }}
        >
          🗺️ สร้างแผนงานรถ (Create Job AI)
        </button>
      </div>

      {activeTab === "planner" && (
        <JobPlanner
          gps={gps}
          robotPose={robotPose}
          sendRobotMessage={sendRobotMessage}
        />
      )}
      {activeTab === "planner-ai" && (
        <JobPlannerAI
          gps={gps}
          robotPose={robotPose}
          sendRobotMessage={sendRobotMessage}
          gpsHistory={gpsHistory}
        />
      )}
      {activeTab === "dashboard" && (
        <Dashboard
          nodeStatuses={nodeStatuses}
          battery={battery}
          gps={gps}
          robotPose={robotPose}
          path={path}
          laserScan={laserScan}
          navigationGoal={navigationGoal}
          setNavigationGoal={setNavigationGoal}
          navigationBusy={navigationBusy}
          mapMode={mapMode}
          setMapMode={setMapMode}
          occupancyGrid={occupancyGrid}
          navigation={{
            ...navigation,
            distanceRemaining: computedDistanceRemaining
          }}
          serverConnected={serverConnected}
          robotConnected={robotConnected}
          startNavigation={startNavigation}
          cancelNavigation={cancelNavigation}
          emergencyStop={emergencyStop}
          onClearGoal={clearGoal}
          socketRef={socketRef}
          ROBOT_ID={ROBOT_ID}
          controlMode={controlMode}
          setControlMode={setControlMode}
          gpsHistory={gpsHistory}
        />
      )}
    </main>
  );

}


function StatusItem({ label, connected }) {
  return (
    <div className="status-item">
      <span>{label}</span>
      <strong
        className={
          connected
            ? "status-connected"
            : "status-disconnected"
        }
      >
        {connected ? "CONNECTED" : "DISCONNECTED"}
      </strong>
    </div>
  );
}
