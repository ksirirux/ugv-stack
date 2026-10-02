import React, { useState, useEffect } from "react";
import { Clock, Search, Filter, Cpu, RefreshCw, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { apiService } from "../services/apiService";

export default function LogViewer({ robots }) {
  const [logs, setLogs] = useState([]);
  const [selectedRobot, setSelectedRobot] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await apiService.getAllLogs({
        page,
        limit: 25,
        robot_id: selectedRobot,
        level: selectedLevel,
        search: searchQuery
      });
      setLogs(data.logs || []);
      setTotalPages(data.pagination?.pages || 1);
      setTotalCount(data.pagination?.total || 0);
    } catch (err) {
      console.error("Error loading logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, selectedRobot, selectedLevel]);

  // Reset page to 1 when filters change
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchLogs();
  };

  const levelOptions = [
    { value: "", label: "All Levels" },
    { value: "info", label: "Info" },
    { value: "warn", label: "Warning" },
    { value: "error", label: "Error" },
    { value: "debug", label: "Debug" },
  ];

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <h1 style={{ fontSize: "28px", fontWeight: "700" }}>System Log History</h1>
        <p style={{ color: "#94a3b8", fontSize: "14px" }}>Query, filter, and audit logs recorded across the entire UGV fleet.</p>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-panel" style={{ padding: "20px" }}>
        <form onSubmit={handleSearchSubmit} style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end" }}>
          
          <div className="form-group" style={{ margin: 0, flex: "1 1 200px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px" }}><Cpu size={14} /> Filter by Robot</label>
            <select
              className="form-input"
              value={selectedRobot}
              onChange={(e) => { setSelectedRobot(e.target.value); setPage(1); }}
            >
              <option value="">All Robots</option>
              {robots.map((robot) => (
                <option key={robot._id} value={robot.robot_id}>
                  {robot.robot_id}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0, flex: "1 1 150px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px" }}><Filter size={14} /> Filter by Level</label>
            <select
              className="form-input"
              value={selectedLevel}
              onChange={(e) => { setSelectedLevel(e.target.value); setPage(1); }}
            >
              {levelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0, flex: "2 1 300px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px" }}><Search size={14} /> Search Message</label>
            <input
              type="text"
              className="form-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search keyword in logs..."
            />
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <button type="submit" className="btn btn-primary">
              Query Logs
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSelectedRobot("");
                setSelectedLevel("");
                setSearchQuery("");
                setPage(1);
                fetchLogs();
              }}
              style={{ padding: "10px" }}
            >
              <RefreshCw size={18} className={loading ? "spin" : ""} />
            </button>
          </div>

        </form>
      </div>

      {/* Logs Table */}
      <div className="glass-panel" style={{ padding: "24px" }}>
        <div className="flex-between" style={{ marginBottom: "16px" }}>
          <span style={{ fontSize: "14px", color: "#94a3b8" }}>
            Showing {logs.length} of {totalCount} logs found
          </span>
        </div>

        {loading ? (
          <div style={{ padding: "64px 0", textAlign: "center", color: "#64748b" }}>
            <RefreshCw size={32} className="spin" style={{ marginBottom: "12px" }} />
            <p>Loading fleet logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: "64px 0", textAlign: "center", color: "#64748b" }}>
            <AlertCircle size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
            <p>No log records found matching your filters.</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto", marginBottom: "20px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "500" }}>TIME</th>
                    <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "500" }}>ROBOT ID</th>
                    <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "500" }}>LEVEL</th>
                    <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "500" }}>MESSAGE</th>
                    <th style={{ padding: "12px 16px", color: "#64748b", fontWeight: "500" }}>METADATA</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const levelClass = log.level === "error" ? "glow-red" : log.level === "warn" ? "glow-yellow" : "glow-blue";
                    return (
                      <tr key={log._id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "14px 16px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td style={{ padding: "14px 16px", fontWeight: "600", color: "#ffffff" }}>
                          {log.robot_id}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span className={`badge ${levelClass}`} style={{ fontSize: "9px", padding: "2px 8px" }}>
                            {log.level}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", color: "#e2e8f0", fontWeight: "500" }}>
                          {log.message}
                        </td>
                        <td style={{ padding: "14px 16px", color: "#64748b", fontFamily: "monospace", fontSize: "11px" }}>
                          {log.metadata ? JSON.stringify(log.metadata) : "{}"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex-between">
                <button
                  className="btn btn-secondary"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{ display: "flex", alignItems: "center", gap: "4px" }}
                >
                  <ChevronLeft size={16} /> Previous
                </button>
                <span style={{ fontSize: "14px", color: "#94a3b8" }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  className="btn btn-secondary"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  style={{ display: "flex", alignItems: "center", gap: "4px" }}
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
