import React, { useState } from "react";
import { Lock, User, AlertCircle, ShieldAlert, Key } from "lucide-react";
import { apiService } from "../services/apiService";

export default function Login({ onLoginSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSwitchMode = () => {
    setIsRegister(!isRegister);
    setError("");
    setSuccess("");
    setUsername("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!username || !password) {
      setError("Please fill in all fields");
      return;
    }

    if (isRegister && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      if (isRegister) {
        // Register operator
        await apiService.registerUser({
          username,
          password,
          role: "operator", // default role for public registration
        });
        setSuccess("Account created successfully! Switching to sign-in...");
        setUsername("");
        setPassword("");
        setConfirmPassword("");
        setTimeout(() => {
          setIsRegister(false);
          setSuccess("");
        }, 2000);
      } else {
        // Sign-in
        const data = await apiService.login(username, password);
        onLoginSuccess(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      width: "100vw",
      padding: "20px",
      position: "fixed",
      top: 0,
      left: 0,
      zIndex: 1000,
      background: "radial-gradient(circle at 50% 50%, rgba(20, 28, 48, 1) 0%, rgba(8, 11, 20, 1) 100%)",
    }}>
      <div className="glass-panel animate-fade-in" style={{
        padding: "40px",
        width: "100%",
        maxWidth: "420px",
        boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}>
        {/* Logo/Icon */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "24px" }}>
          <div style={{
            width: "56px",
            height: "56px",
            borderRadius: "16px",
            background: "linear-gradient(135deg, #3b82f6 0%, #a855f7 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            boxShadow: "0 0 24px rgba(59, 130, 246, 0.5)"
          }}>
            <ShieldAlert size={28} />
          </div>
        </div>

        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: "700", marginBottom: "6px" }}>
            {isRegister ? "Create Command Account" : "Fleet Command Sign-In"}
          </h1>
          <p style={{ color: "#64748b", fontSize: "14px" }}>
            {isRegister
              ? "Register new autonomous operator credentials."
              : "Enter credentials to access the autonomous UGV network."}
          </p>
        </div>

        {error && (
          <div className="glow-red" style={{
            padding: "12px 16px",
            borderRadius: "10px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "13px"
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div style={{
            padding: "12px 16px",
            borderRadius: "10px",
            marginBottom: "24px",
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.2)",
            color: "#34d399",
            fontSize: "13px",
            textAlign: "center"
          }}>
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px" }}><User size={13} /> Username</label>
            <input
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoFocus
              required
            />
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px" }}><Lock size={13} /> Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {isRegister && (
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: "flex", alignItems: "center", gap: "4px" }}><Key size={13} /> Confirm Password</label>
              <input
                type="password"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "12px",
              marginTop: "8px",
              fontSize: "15px"
            }}
          >
            {isRegister
              ? (loading ? "Creating Account..." : "Register Operator")
              : (loading ? "Authenticating..." : "Authorize Access")}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "24px" }}>
          <button
            type="button"
            onClick={handleSwitchMode}
            style={{
              background: "none",
              border: "none",
              color: "#60a5fa",
              cursor: "pointer",
              fontSize: "13px",
              textDecoration: "underline"
            }}
          >
            {isRegister ? "Already have an account? Sign In" : "Need an account? Register Operator"}
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "11px", color: "#475569" }}>
          SECURED ENCRYPTED CONNECTION • PORT 8087
        </div>
      </div>
    </div>
  );
}
