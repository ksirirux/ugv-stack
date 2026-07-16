import React from "react";

export default function CameraStream({ topic, label, ip = "192.168.1.129", port = 8080 }) {
  // สร้าง URL สำหรับดึงภาพจาก web_video_server
  // หมายเหตุ: ใช้ default เป็น 8080 แต่อาจจะต้องเปลี่ยนเป็น 8081 ถ้าชนกับ WebSocket
  const streamUrl = `http://${ip}:${port}/stream?topic=${topic}`;

  return (
    <div className="camera-card">
      <div className="camera-header">
        <h2>{label}</h2>
        <p>{topic}</p>
      </div>
      <div className="camera-viewport">
        {/* ใช้แท็ก img ธรรมดาเพื่อแสดงผลภาพแบบ MJPEG */}
        <img
          src={streamUrl}
          alt={`${label} Stream`}
          className="camera-canvas"
          onError={(e) => {
            // เมื่อไม่สามารถโหลดภาพได้ ให้แสดงสีดำ
            e.target.style.display = 'none';
            e.target.parentElement.classList.add('camera-error');
          }}
          onLoad={(e) => {
            e.target.style.display = 'block';
            e.target.parentElement.classList.remove('camera-error');
          }}
        />
      </div>
    </div>
  );
}
