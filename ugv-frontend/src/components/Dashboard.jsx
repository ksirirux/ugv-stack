import React, { useState } from "react";
import { Cpu, Wifi, WifiOff, AlertTriangle, Battery, Shield, Search, MapPin } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

// Fix Leaflet default marker icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

export default function Dashboard({ robots, wsConnections, telemetry, onSelectRobot }) {
  const [searchTerm, setSearchTerm] = useState("");

  // Default center based on user's UGV coordinates
  const defaultCenter = [16.67709, 99.59130];

  // Process online markers
  const onlineMarkers = robots.map(r => {
    const isOnline = wsConnections[r.robot_id];
    if (!isOnline) return null;

    const activeTelMsg = telemetry[r.robot_id] || {};
    const activeTel = activeTelMsg.telemetry || {};
    const lat = activeTel.latitude ?? activeTel.gps_lat;
    const lon = activeTel.longitude ?? activeTel.gps_lon;

    if (!lat || !lon) return null;

    return {
      robot: r,
      lat,
      lon,
      activeTel
    };
  }).filter(Boolean);

  // Map center will be the first online robot's position or default
  const mapCenter = onlineMarkers.length > 0 ? [onlineMarkers[0].lat, onlineMarkers[0].lon] : defaultCenter;

  // Statistics
  const totalRobots = robots.length;
  const onlineCount = robots.filter(r => wsConnections[r.robot_id]).length;
  const offlineCount = totalRobots - onlineCount;
  
  // Simple check for high error logs or battery alerts in latest telemetry
  let alertCount = 0;
  robots.forEach(r => {
    const t = telemetry[r.robot_id];
    if (t && t.battery !== undefined && t.battery < 20) {
      alertCount++;
    }
  });

  const filteredRobots = robots.filter(
    (r) =>
      r.robot_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.robot_serial.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="animate-fade-in">
      <div className="flex-between" style={{ marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "700" }}>System Overview</h1>
          <p style={{ color: "#94a3b8", fontSize: "14px" }}>Monitor status and health logs of your autonomous fleet.</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "32px" }}>
        <div className="glass-panel" style={{ padding: "20px", display: "flex", alignItems: "center", gap: "16px" }}>
          <div className="glow-blue" style={{ width: "48px", height: "48px", borderRadius: "12px", display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "center" }}>
            <Cpu size={24} />
          </div>
          <div>
            <span style={{ fontSize: "13px", color: "#94a3b8", display: "block" }}>Total Fleet Size</span>
            <span style={{ fontSize: "24px", fontWeight: "700", color: "#ffffff" }}>{totalRobots}</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: "20px", display: "flex", alignItems: "center", gap: "16px" }}>
          <div className="glow-green" style={{ width: "48px", height: "48px", borderRadius: "12px", display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "center" }}>
            <Wifi size={24} />
          </div>
          <div>
            <span style={{ fontSize: "13px", color: "#94a3b8", display: "block" }}>Online Robots</span>
            <span style={{ fontSize: "24px", fontWeight: "700", color: "#ffffff" }}>{onlineCount}</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: "20px", display: "flex", alignItems: "center", gap: "16px" }}>
          <div className="glow-red" style={{ width: "48px", height: "48px", borderRadius: "12px", display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "center" }}>
            <WifiOff size={24} />
          </div>
          <div>
            <span style={{ fontSize: "13px", color: "#94a3b8", display: "block" }}>Offline Robots</span>
            <span style={{ fontSize: "24px", fontWeight: "700", color: "#ffffff" }}>{offlineCount}</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: "20px", display: "flex", alignItems: "center", gap: "16px" }}>
          <div className="glow-yellow" style={{ width: "48px", height: "48px", borderRadius: "12px", display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "center" }}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <span style={{ fontSize: "13px", color: "#94a3b8", display: "block" }}>Fleet Battery Alerts</span>
            <span style={{ fontSize: "24px", fontWeight: "700", color: "#ffffff" }}>{alertCount}</span>
          </div>
        </div>
      </div>

      {/* Fleet Live Map */}
      <div className="glass-panel" style={{ padding: "20px", marginBottom: "32px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
          <MapPin size={18} style={{ color: "#ef4444" }} /> Fleet Live Locations (Online)
        </h2>
        <div style={{ height: "320px", width: "100%", borderRadius: "12px", overflow: "hidden", position: "relative" }}>
          <MapContainer center={mapCenter} zoom={13} style={{ width: "100%", height: "100%", position: "absolute" }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            {onlineMarkers.map((marker) => (
              <Marker key={marker.robot._id} position={[marker.lat, marker.lon]}>
                <Popup>
                  <div style={{ minWidth: "160px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <strong style={{ fontSize: "14px", color: "#ffffff" }}>{marker.robot.robot_name || marker.robot.robot_id}</strong>
                      <span className={`badge ${marker.robot.type === "drone" ? "glow-yellow" : "glow-green"}`} style={{ fontSize: "9px", padding: "1px 6px" }}>
                        {marker.robot.type ? marker.robot.type.toUpperCase() : "UGV"}
                      </span>
                    </div>
                    <div style={{ fontSize: "12px", color: "#94a3b8", display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
                      <span><strong>RTK:</strong> {marker.activeTel.rtk_status || "N/A"}</span>
                      <span><strong>GPS Fix:</strong> {marker.activeTel.gps_fix_type || "N/A"}</span>
                      <span><strong>Battery:</strong> {marker.activeTel.battery ? `${marker.activeTel.battery}%` : "N/A"}</span>
                      <span><strong>Heading:</strong> {marker.activeTel.heading ? `${marker.activeTel.heading.toFixed(1)}°` : "0°"}</span>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() => onSelectRobot(marker.robot)}
                      style={{ width: "100%", padding: "4px 8px", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
                    >
                      <Cpu size={12} /> Monitor Node
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>

      {/* Fleet List Panel */}
      <div className="glass-panel" style={{ padding: "24px" }}>
        <div className="flex-between" style={{ marginBottom: "20px", gap: "16px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600" }}>UGV Fleet Registry</h2>
          <div style={{ position: "relative", width: "300px" }}>
            <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
            <input
              type="text"
              placeholder="Search robot ID or serial..."
              className="form-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ paddingLeft: "36px" }}
            />
          </div>
        </div>

        {filteredRobots.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "#64748b" }}>
            <Cpu size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
            <p>No robots matching your search.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontSize: "13px", fontWeight: "500" }}>ROBOT ID</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontSize: "13px", fontWeight: "500" }}>SERIAL</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontSize: "13px", fontWeight: "500" }}>STATUS</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontSize: "13px", fontWeight: "500" }}>BATTERY</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontSize: "13px", fontWeight: "500" }}>VERSION</th>
                  <th style={{ padding: "12px 16px", color: "#64748b", fontSize: "13px", fontWeight: "500", textAlign: "right" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredRobots.map((robot) => {
                  const isOnline = wsConnections[robot.robot_id];
                  const robotTel = telemetry[robot.robot_id];
                  const battery = robotTel?.battery ?? robotTel?.battery_percentage ?? null;
                  
                  // Get latest version from software history
                  const latestVer = robot.software_history && robot.software_history.length > 0 
                    ? robot.software_history[robot.software_history.length - 1].version 
                    : "Unknown";

                  return (
                    <tr
                      key={robot._id}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        transition: "background 0.2s"
                      }}
                      className="hover-row"
                    >
                      <td style={{ padding: "16px", fontWeight: "600", color: "#ffffff" }}>
                        {robot.robot_id}
                      </td>
                      <td style={{ padding: "16px", color: "#94a3b8" }}>{robot.robot_serial}</td>
                      <td style={{ padding: "16px" }}>
                        <span className={`badge ${isOnline ? "glow-green" : "glow-red"}`} style={{ display: "inline-flex", gap: "6px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor" }} />
                          {isOnline ? "Online" : "Offline"}
                        </span>
                      </td>
                      <td style={{ padding: "16px" }}>
                        {battery !== null ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: battery < 20 ? "#f87171" : "#e2e8f0" }}>
                            <Battery size={16} />
                            <span>{battery}%</span>
                          </div>
                        ) : (
                          <span style={{ color: "#475569" }}>--</span>
                        )}
                      </td>
                      <td style={{ padding: "16px" }}>
                        <span style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          color: "#94a3b8"
                        }}>
                          {latestVer}
                        </span>
                      </td>
                      <td style={{ padding: "16px", textAlign: "right" }}>
                        <button
                          onClick={() => onSelectRobot(robot)}
                          className="btn btn-secondary"
                          style={{ padding: "6px 12px", fontSize: "12px" }}
                        >
                          Monitor Health
                        </button>
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
