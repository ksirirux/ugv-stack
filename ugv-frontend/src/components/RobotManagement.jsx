import React, { useState, useEffect } from "react";
import { Cpu, Plus, Trash2, Key, Eye, EyeOff, User, Copy, Check, Plane, Truck } from "lucide-react";
import { apiService } from "../services/apiService";

export default function RobotManagement({ user, robots, onRefresh }) {
  const [users, setUsers] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Form fields
  const [robotId, setRobotId] = useState("");
  const [robotSerial, setRobotSerial] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [deviceType, setDeviceType] = useState("ugv");
  
  // Registration Method (Manual vs YAML file)
  const [regMethod, setRegMethod] = useState("manual");
  const [yamlContent, setYamlContent] = useState("");

  const [visibleTokens, setVisibleTokens] = useState({});
  const [copiedToken, setCopiedToken] = useState(null);

  // Load registered users
  useEffect(() => {
    apiService.getUsers()
      .then((data) => {
        if (Array.isArray(data)) {
          setUsers(data);
        }
      })
      .catch((err) => console.error("Error loading users:", err));
  }, []);

  const toggleTokenVisibility = (id) => {
    setVisibleTokens((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const copyToClipboard = (token) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleYamlUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      setYamlContent(evt.target.result);
    };
    reader.readAsText(file);
  };

  const handleRegisterRobot = async (e) => {
    e.preventDefault();
    
    if (regMethod === "manual" && (!robotId || !robotSerial)) {
      alert("Please fill in Robot ID and Serial Number");
      return;
    }

    if (regMethod === "yaml" && !yamlContent) {
      alert("Please upload or paste a valid robot.yaml configuration");
      return;
    }

    try {
      const payload = {
        owner: ownerId || null,
        type: deviceType,
      };

      if (regMethod === "yaml") {
        payload.yaml = yamlContent;
      } else {
        payload.robot_id = robotId;
        payload.robot_serial = robotSerial;
        payload.token = customToken || undefined;
      }

      await apiService.registerRobot(payload);

      // Reset form
      setDeviceType("ugv");
      setRegMethod("manual");
      setYamlContent("");
      setRobotId("");
      setRobotSerial("");
      setOwnerId("");
      setCustomToken("");
      setShowAddForm(false);
      
      // Refresh fleet registry
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteRobot = async (id) => {
    if (!window.confirm("Are you sure you want to delete this robot? This cannot be undone.")) {
      return;
    }

    try {
      await apiService.deleteRobot(id);
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex-between" style={{ marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "700" }}>Robot Fleet Registry</h1>
          <p style={{ color: "#94a3b8", fontSize: "14px" }}>Register and manage security credentials for robot fleet nodes.</p>
        </div>
        {user && user.role === "admin" && (
          <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus size={16} />
            {showAddForm ? "Cancel Registration" : "Register New Node"}
          </button>
        )}
      </div>

      {/* Register Form Panel */}
      {showAddForm && (
        <div className="glass-panel animate-fade-in" style={{ padding: "24px", marginBottom: "32px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "18px" }}>Register New Fleet Node</h2>
          
          <form onSubmit={handleRegisterRobot} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px" }}>
            
            {/* Mode selection radio buttons */}
            <div className="form-group" style={{ gridColumn: "1 / -1", margin: 0, display: "flex", gap: "24px", marginBottom: "12px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: "#f8fafc", fontSize: "14px" }}>
                <input
                  type="radio"
                  name="regMethod"
                  value="manual"
                  checked={regMethod === "manual"}
                  onChange={() => setRegMethod("manual")}
                  style={{ cursor: "pointer", width: "16px", height: "16px" }}
                />
                Manual Fields Entry
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: "#f8fafc", fontSize: "14px" }}>
                <input
                  type="radio"
                  name="regMethod"
                  value="yaml"
                  checked={regMethod === "yaml"}
                  onChange={() => setRegMethod("yaml")}
                  style={{ cursor: "pointer", width: "16px", height: "16px" }}
                />
                Upload/Paste robot.yaml Config File
              </label>
            </div>

            {regMethod === "manual" ? (
              <>
                <div className="form-group">
                  <label>ROBOT ID (Unique name, e.g., ugv-02)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={robotId}
                    onChange={(e) => setRobotId(e.target.value)}
                    placeholder="ugv-02"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>ROBOT SERIAL NUMBER</label>
                  <input
                    type="text"
                    className="form-input"
                    value={robotSerial}
                    onChange={(e) => setRobotSerial(e.target.value)}
                    placeholder="SN-XXXXXXX"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>CUSTOM SECURITY TOKEN (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={customToken}
                    onChange={(e) => setCustomToken(e.target.value)}
                    placeholder="Leave blank to auto-generate"
                  />
                </div>
              </>
            ) : (
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label>UPLOAD OR PASTE robot.yaml / robot.yml FILE</label>
                <input
                  type="file"
                  accept=".yaml,.yml"
                  onChange={handleYamlUpload}
                  style={{ marginBottom: "12px", display: "block", color: "#94a3b8", fontSize: "13px" }}
                />
                <textarea
                  className="form-input"
                  value={yamlContent}
                  onChange={(e) => setYamlContent(e.target.value)}
                  placeholder="Paste contents of robot.yaml here..."
                  style={{ height: "160px", fontFamily: "monospace", fontSize: "13px", resize: "vertical", width: "100%" }}
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label>OWNER ASSIGNMENT</label>
              <select
                className="form-input"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                style={{ appearance: "none" }}
              >
                <option value="">No Owner Assigned</option>
                {users.filter(u => u.role === "operator").map((user) => (
                  <option key={user._id} value={user._id}>
                    {user.username}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>DEVICE TYPE</label>
              <select
                className="form-input"
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value)}
                style={{ appearance: "none" }}
              >
                <option value="ugv">UGV (Ground Vehicle)</option>
                <option value="drone">Drone (Aerial UAV)</option>
              </select>
            </div>

            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "8px" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Confirm Registration
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Robot Cards Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "24px" }}>
        {robots.length === 0 ? (
          <div className="glass-panel" style={{ gridColumn: "1 / -1", padding: "64px 0", textAlign: "center", color: "#64748b" }}>
            <Cpu size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
            <p>No robots registered yet. Click the button above to add one.</p>
          </div>
        ) : (
          robots.map((robot) => {
            const isTokenVisible = visibleTokens[robot._id];
            const isCopied = copiedToken === robot.token;
            return (
              <div key={robot._id} className="glass-panel" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div className="flex-between">
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div className={robot.type === "drone" ? "glow-yellow" : "glow-blue"} style={{ width: "36px", height: "36px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {robot.type === "drone" ? <Plane size={18} /> : <Cpu size={18} />}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <h3 style={{ fontSize: "16px", fontWeight: "600" }}>{robot.robot_name || robot.robot_id}</h3>
                        <span className={`badge ${robot.type === "drone" ? "glow-yellow" : "glow-green"}`} style={{ fontSize: "9px", padding: "1px 6px" }}>
                          {robot.type ? robot.type.toUpperCase() : "UGV"}
                        </span>
                      </div>
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                        {robot.robot_name ? `ID: ${robot.robot_id} • ` : ""}Serial: {robot.robot_serial}
                      </span>
                    </div>
                  </div>
                  {user && user.role === "admin" && (
                    <button
                      onClick={() => handleDeleteRobot(robot._id)}
                      style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer", padding: "4px" }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                {/* Metadata from YAML Config if present */}
                {(robot.robot_model || robot.hardware_version) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "12px", color: "#94a3b8", background: "rgba(0,0,0,0.15)", padding: "8px 12px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.02)" }}>
                    {robot.robot_model && (
                      <div>
                        <span style={{ color: "#64748b" }}>Model: </span>{robot.robot_model}
                      </div>
                    )}
                    {robot.hardware_version && (
                      <div>
                        <span style={{ color: "#64748b" }}>HW: </span>v{robot.hardware_version}
                      </div>
                    )}
                  </div>
                )}

                <hr style={{ borderColor: "rgba(255,255,255,0.06)" }} />

                {/* Owner info */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#94a3b8", fontSize: "13px" }}>
                  <User size={14} />
                  <span>Owner: </span>
                  {user && user.role === "admin" ? (
                    <select
                      value={robot.owner?._id || robot.owner || ""}
                      onChange={async (e) => {
                        const newOwner = e.target.value || null;
                        try {
                          await apiService.updateRobot(robot._id, { owner: newOwner });
                          onRefresh();
                        } catch (err) {
                          alert(`Failed to update owner: ${err.message}`);
                        }
                      }}
                      className="form-input"
                      style={{ padding: "2px 8px", fontSize: "12px", width: "auto", display: "inline-block", background: "rgba(0,0,0,0.2)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", margin: 0 }}
                    >
                      <option value="">Unassigned</option>
                      {users.filter(u => u.role === "operator").map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.username}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: "#ffffff", fontWeight: "500" }}>
                      {robot.owner ? (typeof robot.owner === "object" ? robot.owner.username : robot.owner) : "Unassigned"}
                    </span>
                  )}
                </div>

                {/* Token box */}
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "8px", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <div className="flex-between" style={{ fontSize: "11px", color: "#64748b" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <Key size={12} /> SECURITY TOKEN
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => toggleTokenVisibility(robot._id)}
                        style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer" }}
                      >
                        {isTokenVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <button
                        onClick={() => copyToClipboard(robot.token)}
                        style={{ background: "transparent", border: "none", color: isCopied ? "#34d399" : "#94a3b8", cursor: "pointer" }}
                      >
                        {isCopied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                  <div style={{
                    fontFamily: "monospace",
                    fontSize: "12px",
                    color: isTokenVisible ? "#ffffff" : "#64748b",
                    letterSpacing: isTokenVisible ? "0.5px" : "3px",
                    wordBreak: "break-all",
                    userSelect: isTokenVisible ? "all" : "none"
                  }}>
                    {isTokenVisible ? robot.token : "••••••••••••••••••••••••••••••••"}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
