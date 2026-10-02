import React from "react";
import { LayoutDashboard, Cpu, FileClock, LogOut, User, Users } from "lucide-react";

export default function Sidebar({ activeTab, setActiveTab, user, onLogout }) {
  const menuItems = [
    { id: "dashboard", name: "Dashboard", icon: LayoutDashboard },
    { id: "robots", name: "Robots Management", icon: Cpu },
    { id: "logs", name: "System Log Viewer", icon: FileClock },
  ];

  if (user && user.role === "admin") {
    menuItems.push({ id: "users", name: "Users Management", icon: Users });
  }

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "36px", paddingLeft: "8px" }}>
        <div style={{
          width: "32px",
          height: "32px",
          borderRadius: "8px",
          background: "linear-gradient(135deg, #3b82f6 0%, #a855f7 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontWeight: "800",
          fontSize: "16px",
          boxShadow: "0 0 16px rgba(59, 130, 246, 0.4)"
        }}>
          U
        </div>
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: "700", letterSpacing: "0.5px" }}>UGV COMMAND</h2>
          <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "500", textTransform: "uppercase" }}>Fleet Manager v2.0</span>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px 16px",
                borderRadius: "10px",
                border: "none",
                background: isActive ? "rgba(59, 130, 246, 0.15)" : "transparent",
                color: isActive ? "#60a5fa" : "#94a3b8",
                fontSize: "14px",
                fontWeight: isActive ? "600" : "500",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                borderLeft: isActive ? "3px solid #3b82f6" : "3px solid transparent",
                paddingLeft: isActive ? "13px" : "16px"
              }}
            >
              <Icon size={18} />
              {item.name}
            </button>
          );
        })}
      </nav>

      {/* User Session and Logged-in Info */}
      {user && (
        <div className="glass-panel" style={{ padding: "12px", borderRadius: "12px", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <div className="glow-blue" style={{ width: "28px", height: "28px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <User size={14} />
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#ffffff", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                {user.username}
              </div>
              <div style={{ fontSize: "10px", color: "#64748b", textTransform: "capitalize" }}>
                {user.role}
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="btn btn-secondary"
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "6px 12px",
              fontSize: "11px",
              gap: "6px",
              background: "rgba(239, 68, 68, 0.05)",
              border: "1px solid rgba(239, 68, 68, 0.1)",
              color: "#f87171"
            }}
          >
            <LogOut size={12} />
            Sign Out
          </button>
        </div>
      )}

      {/* Server Status Panel */}
      <div className="glass-panel" style={{ padding: "12px", borderRadius: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
          <span style={{ fontSize: "11px", color: "#94a3b8" }}>Server: Connected</span>
        </div>
      </div>
    </aside>
  );
}
