import React, { useState, useEffect } from "react";
import { ArrowLeft, Wifi, Battery, MapPin, Cpu, Clock, History, AlertCircle, RefreshCw } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { apiService } from "../services/apiService";

// Fix Leaflet default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Component to dynamically recenter the map
function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] !== 0 && center[1] !== 0) {
      map.setView(center, 17);
    }
  }, [center, map]);
  return null;
}

export default function RobotDetails({ robot, user, telemetry, wsConnected, onBack, activeLogs, stopStates, onSendEmergencyStop }) {
  const [dbLogs, setDbLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Get active telemetry
  const activeTelMsg = telemetry[robot.robot_id] || {};
  const activeTel = activeTelMsg.telemetry || {};
  const lat = activeTel.latitude ?? activeTel.gps_lat ?? 13.7563; // Fallback to Bangkok
  const lon = activeTel.longitude ?? activeTel.gps_lon ?? 100.5018;
  const isOnline = wsConnected;

  const states = stopStates || robot.stop_states || {
    hardware_stop: false,
    operator_stop: false,
    admin_stop: false
  };
  const isStopped = states.hardware_stop || states.operator_stop || states.admin_stop;

  // Battery and wifi
  const battery = activeTel.battery ?? activeTel.battery_percentage ?? null;
  const rssi = activeTel.rssi ?? activeTel.wifi_signal ?? null;

  // Node statuses from robot (OK, Error, Offline)
  const nodeStatuses = activeTelMsg.node_statuses ?? activeTel.statuses ?? {
    wifi: isOnline ? "OK" : "Offline",
    imu: isOnline ? "OK" : "Offline",
    esp32: isOnline ? "OK" : "Offline",
    gps: isOnline ? "OK" : "Offline",
    lidar: isOnline ? "OK" : "Offline",
    navigation: isOnline ? "OK" : "Offline"
  };

  const mapCenter = [lat, lon];

  // Load persistent logs from database
  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const data = await apiService.getRobotLogs(robot.robot_id, 15);
      setDbLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [robot.robot_id]);

  // Combine real-time incoming logs (from WS) and historical db logs
  const combinedLogs = [...activeLogs, ...dbLogs].slice(0, 15);

  const getStatusColor = (status) => {
    if (!status) return "glow-red";
    switch (status.toUpperCase()) {
      case "OK":
      case "ONLINE":
        return "glow-green";
      case "ERROR":
      case "WARN":
      case "WARNING":
        return "glow-yellow";
      default:
        return "glow-red";
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <button className="btn btn-secondary" onClick={onBack} style={{ padding: "8px" }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: "700" }}>{robot.robot_id}</h1>
            <span className={`badge ${isOnline ? "glow-green" : "glow-red"}`}>
              {isOnline ? "Online" : "Offline"}
            </span>
          </div>
          <p style={{ color: "#94a3b8", fontSize: "13px" }}>Serial: {robot.robot_serial} | Owner: {robot.owner?.username || "Unassigned"}</p>
        </div>
      </div>

      {/* Main Details Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: "24px" }}>
        
        {/* Telemetry and Node Health */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

          {/* E-Stop Safety Center Widget */}
          <div className="glass-panel" style={{ padding: "20px", border: isStopped ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid rgba(255,255,255,0.06)", background: isStopped ? "rgba(239, 68, 68, 0.02)" : "" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertCircle size={18} style={{ color: isStopped ? "#ef4444" : "#10b981" }} /> 
              Safety & E-Stop Center
            </h2>

            {/* Banner detailing current safety locks */}
            {isStopped && (
              <div style={{ background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: "8px", padding: "12px", marginBottom: "16px", color: "#fca5a5", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>
                  <strong>VEHICLE LOCKED:</strong> {
                    [
                      states.hardware_stop && "Hardware Physical Stop is Active",
                      states.operator_stop && "Operator Software Stop is Active",
                      states.admin_stop && "Admin Software Stop is Active"
                    ].filter(Boolean).join(" and ")
                  }. Movement has been cut off.
                </span>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Hardware Stop Item */}
              <div className="glass-card flex-between" style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#ffffff" }}>1. Physical Hardware Stop</span>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>Triggered physically on UGV. Read-only on cloud.</span>
                </div>
                <span className={`badge ${states.hardware_stop ? "glow-red" : "glow-green"}`} style={{ fontSize: "11px", padding: "4px 10px" }}>
                  {states.hardware_stop ? "LOCKED" : "CLEARED"}
                </span>
              </div>

              {/* Operator Stop Item */}
              <div className="glass-card flex-between" style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#ffffff" }}>2. Operator Software Stop</span>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>Controlled by vehicle owner or administrator.</span>
                </div>
                <button
                  className={`btn ${states.operator_stop ? "btn-secondary" : "btn-danger"}`}
                  onClick={() => onSendEmergencyStop(robot.robot_id, "operator", !states.operator_stop)}
                  style={{ padding: "6px 12px", fontSize: "12px", minWidth: "110px" }}
                >
                  {states.operator_stop ? "Unlock (Clear)" : "STOP UGV"}
                </button>
              </div>

              {/* Admin Stop Item */}
              <div className="glass-card flex-between" style={{ padding: "12px 16px", opacity: user?.role === "admin" ? 1 : 0.6 }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", color: "#ffffff" }}>3. Admin Software Stop</span>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>Admin priority lock. Cannot be unlocked by operators.</span>
                </div>
                {user?.role === "admin" ? (
                  <button
                    className={`btn ${states.admin_stop ? "btn-secondary" : "btn-danger"}`}
                    onClick={() => onSendEmergencyStop(robot.robot_id, "admin", !states.admin_stop)}
                    style={{ padding: "6px 12px", fontSize: "12px", minWidth: "110px" }}
                  >
                    {states.admin_stop ? "Unlock (Clear)" : "STOP UGV"}
                  </button>
                ) : (
                  <span className={`badge ${states.admin_stop ? "glow-red" : "glow-green"}`} style={{ fontSize: "11px", padding: "4px 10px" }}>
                    {states.admin_stop ? "LOCKED BY ADMIN" : "CLEARED"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="glass-panel" style={{ padding: "20px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Cpu size={18} style={{ color: "#3b82f6" }} /> Telemetry Metrics
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "12px", color: "#64748b" }}>Battery Health</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Battery size={20} style={{ color: battery !== null && battery < 20 ? "#ef4444" : "#10b981" }} />
                  <span style={{ fontSize: "20px", fontWeight: "700" }}>{battery !== null ? `${battery}%` : "N/A"}</span>
                </div>
                {battery !== null && (
                  <div style={{ width: "100%", height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ width: `${battery}%`, height: "100%", background: battery < 20 ? "#ef4444" : "#10b981" }} />
                  </div>
                )}
              </div>

              <div className="glass-card" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "12px", color: "#64748b" }}>WiFi Signal</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Wifi size={20} style={{ color: "#3b82f6" }} />
                  <span style={{ fontSize: "20px", fontWeight: "700" }}>{rssi !== null ? `${rssi} dBm` : "Good"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Node Health Statuses */}
          <div className="glass-panel" style={{ padding: "20px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Wifi size={18} style={{ color: "#3b82f6" }} /> Hardware & Node Status
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
              {Object.entries(nodeStatuses).map(([node, status]) => (
                <div key={node} className="glass-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "500", textTransform: "capitalize", color: "#94a3b8" }}>{node}</span>
                  <span className={`badge ${getStatusColor(status)}`} style={{ fontSize: "9px", padding: "2px 6px" }}>
                    {status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Software Version History */}
          <div className="glass-panel" style={{ padding: "20px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <History size={18} style={{ color: "#a855f7" }} /> Software version history
            </h2>
            {robot.software_history && robot.software_history.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {robot.software_history.map((history, idx) => (
                  <div key={idx} className="glass-card flex-between" style={{ padding: "10px 14px", fontSize: "13px" }}>
                    <span style={{ fontWeight: "600", color: "#ffffff" }}>{history.version}</span>
                    <span style={{ color: "#64748b" }}>{new Date(history.installed_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "#64748b", fontSize: "13px", textAlign: "center", padding: "12px 0" }}>No software version updates recorded.</p>
            )}
          </div>
        </div>

        {/* GPS Map View */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="glass-panel" style={{ padding: "20px", display: "flex", flexDirection: "column", flex: 1, minHeight: "350px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              <MapPin size={18} style={{ color: "#ef4444" }} /> Live GPS Location
            </h2>
            <div style={{ flex: 1, position: "relative", minHeight: "260px", borderRadius: "12px", overflow: "hidden" }}>
              <MapContainer center={mapCenter} zoom={17} style={{ width: "100%", height: "100%", position: "absolute" }}>
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                <Marker position={mapCenter}>
                  <Popup>
                    <strong>{robot.robot_id}</strong> <br />
                    Lat: {lat.toFixed(5)} <br />
                    Lon: {lon.toFixed(5)}
                  </Popup>
                </Marker>
                <MapRecenter center={mapCenter} />
              </MapContainer>
            </div>
            <div style={{ marginTop: "12px", fontSize: "12px", color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
              <span>Latitude: {lat.toFixed(6)}</span>
              <span>Longitude: {lon.toFixed(6)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Log History */}
      <div className="glass-panel" style={{ padding: "24px" }}>
        <div className="flex-between" style={{ marginBottom: "16px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600", display: "flex", alignItems: "center", gap: "8px" }}>
            <Clock size={20} style={{ color: "#3b82f6" }} /> Real-time & Recent Logs
          </h2>
          <button className="btn btn-secondary" onClick={fetchLogs} disabled={loadingLogs} style={{ padding: "6px 12px", fontSize: "12px" }}>
            <RefreshCw size={14} className={loadingLogs ? "spin" : ""} style={{ marginRight: "4px" }} />
            Reload Historical Logs
          </button>
        </div>

        {combinedLogs.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: "#64748b" }}>
            <AlertCircle size={32} style={{ opacity: 0.3, marginBottom: "8px" }} />
            <p>No logs found for this robot.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <th style={{ padding: "10px 12px", color: "#64748b", fontWeight: "500" }}>TIME</th>
                  <th style={{ padding: "10px 12px", color: "#64748b", fontWeight: "500" }}>LEVEL</th>
                  <th style={{ padding: "10px 12px", color: "#64748b", fontWeight: "500" }}>MESSAGE</th>
                  <th style={{ padding: "10px 12px", color: "#64748b", fontWeight: "500" }}>METADATA</th>
                </tr>
              </thead>
              <tbody>
                {combinedLogs.map((log, idx) => {
                  const levelClass = log.level === "error" ? "glow-red" : log.level === "warn" ? "glow-yellow" : "glow-blue";
                  return (
                    <tr key={log._id || idx} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "12px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                        {new Date(log.createdAt || Date.now()).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: "12px" }}>
                        <span className={`badge ${levelClass}`} style={{ fontSize: "9px", padding: "1px 6px" }}>
                          {log.level}
                        </span>
                      </td>
                      <td style={{ padding: "12px", color: "#ffffff", fontWeight: "500" }}>{log.message}</td>
                      <td style={{ padding: "12px", color: "#64748b", fontFamily: "monospace", fontSize: "11px" }}>
                        {log.metadata ? JSON.stringify(log.metadata) : "{}"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
