import React, { useState, useEffect } from "react";
import { User, UserPlus, Key, Shield, AlertCircle, RefreshCw } from "lucide-react";
import { apiService } from "../services/apiService";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState("operator");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const getRoleBadgeClass = (role) => {
    switch (role) {
      case "admin": return "glow-yellow";
      case "technician": return "glow-blue";
      case "operator": return "glow-green";
      case "viewer": return "glow-red";
      default: return "glow-green";
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case "admin": return "#818cf8";
      case "technician": return "#60a5fa";
      case "operator": return "#34d399";
      case "viewer": return "#f87171";
      default: return "#34d399";
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await apiService.getUsers();
      setUsers(data || []);
    } catch (err) {
      console.error("Failed to load users:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRegisterUser = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!username || !password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      await apiService.registerUser({
        username,
        password,
        role,
      });

      setSuccess(`User "${username}" registered successfully!`);
      setUsername("");
      setPassword("");
      setConfirmPassword("");
      setRole("operator");
      fetchUsers();
      setTimeout(() => setShowAddForm(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex-between" style={{ marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "700" }}>Operator & User Accounts</h1>
          <p style={{ color: "#94a3b8", fontSize: "14px" }}>Manage registered system accounts and access control roles.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
          <UserPlus size={16} />
          {showAddForm ? "Cancel Creation" : "Register New User"}
        </button>
      </div>

      {/* Add User Form */}
      {showAddForm && (
        <div className="glass-panel animate-fade-in" style={{ padding: "24px", marginBottom: "32px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "18px", display: "flex", alignItems: "center", gap: "8px" }}>
            <UserPlus size={20} style={{ color: "var(--accent-color)" }} />
            Create System User Account
          </h2>
          <form onSubmit={handleRegisterUser} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px" }}>
            <div className="form-group">
              <label>USERNAME</label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={{ paddingLeft: "36px" }}
                />
                <User size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
              </div>
            </div>

            <div className="form-group">
              <label>PASSWORD</label>
              <div style={{ position: "relative" }}>
                <input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingLeft: "36px" }}
                />
                <Key size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
              </div>
            </div>

            <div className="form-group">
              <label>CONFIRM PASSWORD</label>
              <div style={{ position: "relative" }}>
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ paddingLeft: "36px" }}
                />
                <Key size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
              </div>
            </div>

            <div className="form-group">
              <label>ROLE AUTHORITY</label>
              <div style={{ position: "relative" }}>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  style={{ paddingLeft: "36px", height: "42px", width: "100%", borderRadius: "8px", background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.1)", color: "#f8fafc" }}
                >
                  <option value="operator" style={{ background: "#0f172a" }}>Operator</option>
                  <option value="admin" style={{ background: "#0f172a" }}>Admin</option>
                  <option value="technician" style={{ background: "#0f172a" }}>Technician</option>
                  <option value="viewer" style={{ background: "#0f172a" }}>Viewer</option>
                </select>
                <Shield size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
              </div>
            </div>

            <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "10px" }}>
              {error && (
                <div className="flex-align" style={{ color: "#ef4444", fontSize: "14px", gap: "6px" }}>
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div style={{ color: "#10b981", fontSize: "14px" }}>
                  <span>{success}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                <button type="submit" className="btn btn-primary" style={{ minWidth: "150px" }}>
                  Register Account
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Users List Grid */}
      <div className="glass-panel" style={{ padding: "24px" }}>
        <div className="flex-between" style={{ marginBottom: "20px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600" }}>System Accounts Directory</h2>
          <button onClick={fetchUsers} disabled={loading} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Created Date</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id}>
                  <td style={{ fontWeight: "600", color: "#f8fafc" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(255, 255, 255, 0.05)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255, 255, 255, 0.1)" }}>
                        <User size={14} style={{ color: getRoleColor(u.role) }} />
                      </div>
                      {u.username}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${getRoleBadgeClass(u.role)}`}>
                      {u.role.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ color: "#94a3b8" }}>
                    {new Date(u.createdAt).toLocaleDateString("th-TH", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
