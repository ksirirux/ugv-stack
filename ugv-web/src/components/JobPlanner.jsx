import React, { useState, useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMap, useMapEvents, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  toLocalXY,
  toLatLng,
  getDistance,
  calculateArea,
  offsetPolygon,
  generatePathPlan,
  reorderPathStartPoint
} from "../utils/pathPlannerUtils";

// Fix Leaflet marker icons
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;





// Map Event Handler for drawing
function MapEventsHandler({ drawingMode, onMapClick }) {
  useMapEvents({
    click(e) {
      if (drawingMode === "none") return;
      onMapClick(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

// Map Controller helper to expose map instance to parent
function MapController({ setMapRef }) {
  const map = useMap();
  useEffect(() => {
    if (map && setMapRef) {
      setMapRef(map);
    }
  }, [map, setMapRef]);
  return null;
}

export default function JobPlanner({ gps, robotPose, sendRobotMessage }) {
  const defaultCenter = [16.538273, 99.453084]; // Bangkok default
  const mapCenter = gps && gps.latitude !== null ? [gps.latitude, gps.longitude] : defaultCenter;

  const [mapRef, setMapRef] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [hasCenteredInitially, setHasCenteredInitially] = useState(false);

  const hasGps = gps && gps.latitude !== null && gps.longitude !== null;
  const isRtkFixed = gps?.rtk_status === "RTK_FIXED";
  const robotMarkerColor = isRtkFixed ? '#22c55e' : '#eab308';
  const yaw = robotPose?.yaw ?? 0;
  const headingDeg = -(yaw * 180 / Math.PI) + 90;

  const robotMarkerIcon = useMemo(() => {
    return L.divIcon({
      className: "custom-robot-icon",
      html: `<div style="transform: rotate(${headingDeg}deg); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));">
               <svg width="32" height="32" viewBox="0 0 24 24" fill="${robotMarkerColor}" stroke="white" stroke-width="2" stroke-linejoin="round">
                 <path d="M12 2 L22 21 L12 17 L2 21 Z" />
               </svg>
             </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }, [robotMarkerColor, headingDeg]);

  // Drawing state
  const [drawingMode, setDrawingMode] = useState("none"); // "none", "boundary", "obstacle"
  const [boundaryVertices, setBoundaryVertices] = useState([]); // Array of [lat, lng]

  // Obstacles state
  const [obstacles, setObstacles] = useState([]); // Array of arrays of [lat, lng]
  const [activeObstacleIndex, setActiveObstacleIndex] = useState(null);

  // Job Parameters
  const [jobName, setJobName] = useState("แผนงานแปลงใหม่");
  const [inset, setInset] = useState(2.0); // meters
  const [spacing, setSpacing] = useState(3.0); // meters
  const [angle, setAngle] = useState(0); // degrees
  const [pattern, setPattern] = useState("sweep"); // "sweep", "spiral", "boundary"

  // Planning Result
  const [generatedPath, setGeneratedPath] = useState([]); // Array of [lat, lng]
  const [pathLength, setPathLength] = useState(0); // meters

  // Undo/Redo History states
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const pushStateToHistory = (newBoundary, newObstacles) => {
    setHistory(prev => {
      const next = prev.slice(0, historyIndex + 1);
      next.push({
        boundary: JSON.parse(JSON.stringify(newBoundary)),
        obstacles: JSON.parse(JSON.stringify(newObstacles))
      });
      setHistoryIndex(next.length - 1);
      return next;
    });
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      const prevState = history[prevIndex];
      setBoundaryVertices(prevState.boundary);
      setObstacles(prevState.obstacles);
      setHistoryIndex(prevIndex);
    } else if (historyIndex === 0) {
      setBoundaryVertices([]);
      setObstacles([]);
      setHistoryIndex(-1);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      const nextState = history[nextIndex];
      setBoundaryVertices(nextState.boundary);
      setObstacles(nextState.obstacles);
      setHistoryIndex(nextIndex);
    }
  };




  // Recenter map on UGV location exactly once when GPS becomes available
  useEffect(() => {
    if (gps && gps.latitude !== null && gps.longitude !== null && !hasCenteredInitially) {
      if (mapRef) {
        mapRef.setView([gps.latitude, gps.longitude], 18);
        setHasCenteredInitially(true);
      }
    }
  }, [gps, mapRef, hasCenteredInitially]);

  const centerOnUser = () => {
    if (!navigator.geolocation) {
      alert("เบราว์เซอร์ของคุณไม่สนับสนุนการหาตำแหน่ง!");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const loc = [latitude, longitude];
        setUserLocation(loc);
        if (mapRef) {
          mapRef.setView(loc, 19);
        }
      },
      (error) => {
        console.error(error);
        alert("ไม่สามารถดึงตำแหน่งของคุณได้: " + error.message);
      },
      { enableHighAccuracy: true }
    );
  };

  const centerOnRobot = () => {
    if (gps && gps.latitude !== null && gps.longitude !== null) {
      if (mapRef) {
        mapRef.setView([gps.latitude, gps.longitude], 19);
      }
    } else {
      alert("ไม่มีข้อมูล GPS ของตัวรถในขณะนี้!");
    }
  };

  const findLongestEdgeAngle = () => {
    if (boundaryVertices.length < 2) return 0;

    let maxDist = -1;
    let longestEdgeAngle = 0;
    const n = boundaryVertices.length;

    const ref = boundaryVertices[0];
    const pts = boundaryVertices.map(v => toLocalXY(v[0], v[1], ref[0], ref[1]));

    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > maxDist) {
        maxDist = dist;
        let deg = (Math.atan2(dy, dx) * 180 / Math.PI);
        deg = (deg + 360) % 180; // normalize to [0, 180)
        longestEdgeAngle = Math.round(deg);
      }
    }
    return longestEdgeAngle;
  };

  const lastLenRef = useRef(0);
  useEffect(() => {
    const len = boundaryVertices.length;
    if (len >= 3 && lastLenRef.current < 3) {
      // Finished drawing new polygon, auto-align to longest side!
      const bestAngle = findLongestEdgeAngle();
      setAngle(bestAngle);
    }
    lastLenRef.current = len;
  }, [boundaryVertices]);




  // Saved Jobs
  const [savedJobs, setSavedJobs] = useState([]);

  // Load saved jobs on startup
  useEffect(() => {
    const jobs = localStorage.getItem("ugv_saved_jobs");
    if (jobs) {
      try {
        setSavedJobs(JSON.parse(jobs));
      } catch (e) {
        console.error("Failed to parse saved jobs", e);
      }
    }
  }, []);

  // Save jobs helper
  const persistJobs = (newJobs) => {
    setSavedJobs(newJobs);
    localStorage.setItem("ugv_saved_jobs", JSON.stringify(newJobs));
  };

  // Click handler on map
  const handleMapClick = (lat, lng) => {
    if (drawingMode === "boundary") {
      const next = [...boundaryVertices, [lat, lng]];
      setBoundaryVertices(next);
      pushStateToHistory(next, obstacles);
    } else if (drawingMode === "obstacle") {
      if (activeObstacleIndex === null) {
        // Start a new obstacle polygon
        const newObsIdx = obstacles.length;
        const nextObs = [...obstacles, [[lat, lng]]];
        setObstacles(nextObs);
        setActiveObstacleIndex(newObsIdx);
        pushStateToHistory(boundaryVertices, nextObs);
      } else {
        // Add to existing active obstacle
        setObstacles(prev => {
          const next = [...prev];
          next[activeObstacleIndex] = [...next[activeObstacleIndex], [lat, lng]];
          pushStateToHistory(boundaryVertices, next);
          return next;
        });
      }
    }
  };


  // Dragging vertex handlers
  const handleBoundaryVertexDrag = (index, latlng) => {
    setBoundaryVertices(prev => {
      const next = [...prev];
      next[index] = [latlng.lat, latlng.lng];
      return next;
    });
  };

  const handleBoundaryVertexDragEnd = (index, latlng) => {
    setBoundaryVertices(prev => {
      const next = [...prev];
      next[index] = [latlng.lat, latlng.lng];
      pushStateToHistory(next, obstacles);
      return next;
    });
  };

  const handleObstacleVertexDrag = (obsIndex, vertexIndex, latlng) => {
    setObstacles(prev => {
      const next = [...prev];
      const obsPoints = [...next[obsIndex]];
      obsPoints[vertexIndex] = [latlng.lat, latlng.lng];
      next[obsIndex] = obsPoints;
      return next;
    });
  };

  const handleObstacleVertexDragEnd = (obsIndex, vertexIndex, latlng) => {
    setObstacles(prev => {
      const next = [...prev];
      const obsPoints = [...next[obsIndex]];
      obsPoints[vertexIndex] = [latlng.lat, latlng.lng];
      next[obsIndex] = obsPoints;
      pushStateToHistory(boundaryVertices, next);
      return next;
    });
  };


  // Delete Vertex Handler
  const removeBoundaryVertex = (index) => {
    const next = boundaryVertices.filter((_, i) => i !== index);
    setBoundaryVertices(next);
    pushStateToHistory(next, obstacles);
  };

  const removeObstacleVertex = (obsIndex, vertexIndex) => {
    setObstacles(prev => {
      const next = [...prev];
      const obsPoints = next[obsIndex].filter((_, i) => i !== vertexIndex);
      if (obsPoints.length === 0) {
        next.splice(obsIndex, 1);
        setActiveObstacleIndex(null);
      } else {
        next[obsIndex] = obsPoints;
      }
      pushStateToHistory(boundaryVertices, next);
      return next;
    });
  };

  const removeEntireObstacle = (obsIndex) => {
    const next = obstacles.filter((_, idx) => idx !== obsIndex);
    setObstacles(next);
    if (activeObstacleIndex === obsIndex) {
      setActiveObstacleIndex(null);
    } else if (activeObstacleIndex > obsIndex) {
      setActiveObstacleIndex(prev => prev - 1);
    }
    pushStateToHistory(boundaryVertices, next);
  };



  // Boundary stats
  const areaSqM = useMemo(() => calculateArea(boundaryVertices), [boundaryVertices]);
  const areaHectares = (areaSqM / 10000).toFixed(2);
  const areaRai = (areaSqM / 1600).toFixed(1);

  // Midpoints for segment length displays
  const boundaryEdges = useMemo(() => {
    const edges = [];
    const n = boundaryVertices.length;
    if (n < 2) return [];

    for (let i = 0; i < n; i++) {
      const p1 = boundaryVertices[i];
      const p2 = boundaryVertices[(i + 1) % n];
      const dist = getDistance(p1[0], p1[1], p2[0], p2[1]);
      edges.push({
        midpoint: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2],
        distance: dist,
        id: `b-edge-${i}`
      });
    }
    return edges;
  }, [boundaryVertices]);

  // Calculate shrunken boundary for display on map
  const shrunkenBoundaryVertices = useMemo(() => {
    if (boundaryVertices.length < 3 || inset <= 0) return [];
    try {
      const ref = boundaryVertices[0];
      const bXY = boundaryVertices.map(v => toLocalXY(v[0], v[1], ref[0], ref[1]));
      const shrunkenB = offsetPolygon(bXY, inset);
      return shrunkenB.map(pt => toLatLng(pt.x, pt.y, ref[0], ref[1]));
    } catch (e) {
      console.error("Failed to compute shrunken boundary vertices", e);
      return [];
    }
  }, [boundaryVertices, inset]);

  // Partition generatedPath into styled segments (work, turn, transit) for map display
  const pathSegments = useMemo(() => {
    if (generatedPath.length < 2) return [];

    const segments = [];
    let currentSegment = [generatedPath[0]];
    let currentType = generatedPath[1]?.type || "work";

    for (let i = 1; i < generatedPath.length; i++) {
      const pt = generatedPath[i];
      currentSegment.push(pt);

      const nextType = generatedPath[i + 1]?.type;
      if (nextType !== currentType || i === generatedPath.length - 1) {
        segments.push({
          positions: currentSegment,
          type: currentType
        });
        currentSegment = [pt]; // overlap to connect lines visually
        currentType = nextType;
      }
    }
    return segments;
  }, [generatedPath]);

  // Boustrophedon Sweep coverage path algorithm

  const generatePathWaypoints = () => {
    if (boundaryVertices.length < 3) {
      alert("กรุณาวาดขอบเขตแปลงอย่างน้อย 3 จุด!");
      setGeneratedPath([]);
      setPathLength(0);
      return;
    }
    const result = generatePathPlan(boundaryVertices, obstacles, inset, spacing, angle);
    console.log(result);
    if (result.error) {
      console.log(result);
      alert(result.error);
      setGeneratedPath([]);
      setPathLength(0);
      return;
    }
    setGeneratedPath(result.path);
    setPathLength(result.length);
  };

  const handleReversePath = () => {
    if (generatedPath.length < 2) return;

    const original = [...generatedPath];
    const N = original.length;
    const reversed = [...original].reverse();

    for (let k = 1; k < N; k++) {
      reversed[k].type = original[N - k].type;
    }
    reversed[0].type = undefined;

    setGeneratedPath(reversed);
  };

  const handleSetStartPoint = (clickedIdx) => {
    if (generatedPath.length < 2) return;
    const modes = generatedPath.map(pt => ({ type: pt.type || "work", spray: pt.type === "work" }));
    const result = reorderPathStartPoint(
      generatedPath,
      modes,
      boundaryVertices,
      obstacles,
      inset,
      inset, // use inset as obstacle clearance
      clickedIdx
    );
    if (result) {
      setGeneratedPath(result.path);
    }
  };







  // Save current job
  const handleSaveJob = () => {
    if (!jobName.trim()) {
      alert("กรุณากรอกชื่อแผนงาน!");
      return;
    }
    if (boundaryVertices.length === 0) {
      alert("กรุณาวาดขอบเขตก่อนบันทึก!");
      return;
    }

    const newJob = {
      id: Date.now().toString(),
      name: jobName,
      boundary: boundaryVertices,
      obstacles: obstacles,
      inset,
      spacing,
      angle,
      pattern,
      path: generatedPath,
      pathLength
    };

    const newJobs = [newJob, ...savedJobs.filter(j => j.name !== jobName)];
    persistJobs(newJobs);
    alert("บันทึกแผนงานสำเร็จ!");
  };

  // Load a job
  const handleLoadJob = (job) => {
    setJobName(job.name);
    setBoundaryVertices(job.boundary);
    setObstacles(job.obstacles || []);
    setInset(job.inset);
    setSpacing(job.spacing);
    setAngle(job.angle);
    setPattern(job.pattern || "sweep");
    setGeneratedPath(job.path || []);
    setPathLength(job.pathLength || 0);
    setDrawingMode("none");
    setActiveObstacleIndex(null);
    pushStateToHistory(job.boundary, job.obstacles || []);
  };


  // Delete a job
  const handleDeleteJob = (id, e) => {
    e.stopPropagation();
    if (confirm("ต้องการลบแผนงานนี้ใช่หรือไม่?")) {
      const newJobs = savedJobs.filter(j => j.id !== id);
      persistJobs(newJobs);
    }
  };

  // Apply mission to UGV
  const handleSendMission = () => {
    if (generatedPath.length === 0) {
      alert("กรุณาคำนวณเส้นทางก่อนส่งภารกิจ!");
      return;
    }

    // Convert generated path to message structure expected by robot
    const poses = generatedPath.map((pt, idx) => ({
      header: {
        seq: idx,
        stamp: { secs: Math.floor(Date.now() / 1000), nsecs: 0 },
        frame_id: "wgs84"
      },
      pose: {
        position: { x: pt[0], y: pt[1], z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 }
      },
      type: pt.type || "work"
    }));


    const pathMessage = {
      type: "path",
      poses: poses
    };

    if (sendRobotMessage(pathMessage)) {
      alert("ส่งภารกิจเส้นทางไปยังรถเรียบร้อย!");
    } else {
      alert("ไม่สามารถติดต่อเซิร์ฟเวอร์เพื่อส่งภารกิจได้");
    }
  };

  const handleClearMap = () => {
    setBoundaryVertices([]);
    setObstacles([]);
    setActiveObstacleIndex(null);
    setGeneratedPath([]);
    setPathLength(0);
    setDrawingMode("none");
    pushStateToHistory([], []);
  };


  // Generate icons for custom markers
  const getVertexIcon = (num, color = "#2563eb") => {
    return L.divIcon({
      className: "custom-vertex-icon",
      html: `<div style="background-color: ${color}; color: white; border: 2.5px solid white; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.4);">${num}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  };

  const getDistanceIcon = (meters) => {
    return L.divIcon({
      className: "custom-distance-icon",
      html: `<div style="background-color: #000; opacity: 0.8; color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1.5px solid rgba(255,255,255,0.3); white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.5);">${meters.toFixed(1)}m</div>`,
      iconSize: [50, 20],
      iconAnchor: [25, 10]
    });
  };

  return (
    <div className="planner-layout" style={{ display: "grid", gridTemplateColumns: "350px 1fr", gap: "20px", width: "100%", minHeight: "700px" }}>
      {/* Parameters Panel */}
      <aside className="planner-sidebar" style={{ background: "#1f2937", color: "white", padding: "20px", borderRadius: "12px", display: "flex", flexDirection: "column", gap: "16px", boxShadow: "0 4px 16px rgba(0,0,0,0.15)" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", margin: "0 0 12px 0", color: "#f59e0b", borderBottom: "1px solid #374151", paddingBottom: "8px" }}>📦 สร้างแผนงานรถ UGV</h2>
          <label style={{ fontSize: "13px", color: "#9ca3af", display: "block", marginBottom: "4px" }}>ชื่อแผนงาน (Job Name)</label>
          <input
            type="text"
            value={jobName}
            onChange={(e) => setJobName(e.target.value)}
            style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #4b5563", background: "#111827", color: "white" }}
          />
        </div>

        {/* Drawing Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: "13px", color: "#9ca3af" }}>โหมดการวาดแผนที่</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <button
              onClick={() => setDrawingMode(drawingMode === "boundary" ? "none" : "boundary")}
              style={{
                padding: "10px 6px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: "13px",
                background: drawingMode === "boundary" ? "#10b981" : "#374151",
                color: "white"
              }}
            >
              🟢 วาดขอบเขต {drawingMode === "boundary" && "●"}
            </button>
            <button
              onClick={() => {
                setDrawingMode(drawingMode === "obstacle" ? "none" : "obstacle");
                setActiveObstacleIndex(null); // start fresh
              }}
              style={{
                padding: "10px 6px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: "13px",
                background: drawingMode === "obstacle" ? "#ef4444" : "#374151",
                color: "white"
              }}
            >
              🔴 วาดสิ่งกีดขวาง {drawingMode === "obstacle" && "●"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "4px" }}>
            <button
              onClick={handleUndo}
              disabled={historyIndex < 0}
              style={{
                padding: "8px", borderRadius: "6px", border: "1px solid #4b5563", cursor: historyIndex >= 0 ? "pointer" : "not-allowed",
                background: historyIndex >= 0 ? "#374151" : "#1f2937", color: historyIndex >= 0 ? "white" : "#4b5563",
                fontWeight: "bold", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", transition: "0.2s"
              }}
            >
              ↩️ ย้อนกลับ (Undo)
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              style={{
                padding: "8px", borderRadius: "6px", border: "1px solid #4b5563", cursor: historyIndex < history.length - 1 ? "pointer" : "not-allowed",
                background: historyIndex < history.length - 1 ? "#374151" : "#1f2937", color: historyIndex < history.length - 1 ? "white" : "#4b5563",
                fontWeight: "bold", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", transition: "0.2s"
              }}
            >
              ↪️ ทำซ้ำ (Redo)
            </button>
          </div>

          {drawingMode === "obstacle" && activeObstacleIndex !== null && (
            <button
              onClick={() => setActiveObstacleIndex(null)}
              style={{
                marginTop: "8px", width: "100%", padding: "8px", borderRadius: "6px", border: "none",
                background: "#f59e0b", color: "#111827", fontWeight: "bold", cursor: "pointer", fontSize: "12px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", transition: "0.2s"
              }}
            >
              🔒 เสร็จสิ้นสิ่งกีดขวางนี้ (เริ่มจุดถัดไป)
            </button>
          )}
          {drawingMode !== "none" && (

            <p style={{ fontSize: "12px", margin: "0", color: "#f59e0b", animation: "pulse 1.5s infinite" }}>
              * คลิกบนแผนที่ดาวเทียมเพื่อวางหมุด
            </p>
          )}
        </div>

        {/* Parameters */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", borderTop: "1px solid #374151", paddingTop: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "14px" }}>บีบระยะขอบเขต (Inset)</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                onClick={() => setInset(prev => Math.max(0, parseFloat((prev - 0.5).toFixed(1))))}
                style={{ width: "28px", height: "28px", background: "#374151", border: "none", borderRadius: "4px", color: "white", cursor: "pointer", fontSize: "16px", fontWeight: "bold" }}
              >-</button>
              <span style={{ width: "50px", textAlign: "center", fontFamily: "monospace", fontSize: "15px" }}>{inset} m</span>
              <button
                onClick={() => setInset(prev => parseFloat((prev + 0.5).toFixed(1)))}
                style={{ width: "28px", height: "28px", background: "#374151", border: "none", borderRadius: "4px", color: "white", cursor: "pointer", fontSize: "16px", fontWeight: "bold" }}
              >+</button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "14px" }}>ระยะห่างแถว (Spacing)</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                onClick={() => setSpacing(prev => Math.max(0.5, parseFloat((prev - 0.5).toFixed(1))))}
                style={{ width: "28px", height: "28px", background: "#374151", border: "none", borderRadius: "4px", color: "white", cursor: "pointer", fontSize: "16px", fontWeight: "bold" }}
              >-</button>
              <span style={{ width: "50px", textAlign: "center", fontFamily: "monospace", fontSize: "15px" }}>{spacing} m</span>
              <button
                onClick={() => setSpacing(prev => parseFloat((prev + 0.5).toFixed(1)))}
                style={{ width: "28px", height: "28px", background: "#374151", border: "none", borderRadius: "4px", color: "white", cursor: "pointer", fontSize: "16px", fontWeight: "bold" }}
              >+</button>
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontSize: "14px" }}>องศาแนวแถว (Angle)</span>
              <span style={{ fontFamily: "monospace", color: "#f59e0b" }}>{angle}°</span>
            </div>
            <input
              type="range"
              min="0"
              max="180"
              value={angle}
              onChange={(e) => setAngle(parseInt(e.target.value))}
              style={{ width: "100%", cursor: "pointer", marginBottom: "6px" }}
            />
            {boundaryVertices.length >= 3 && (
              <button
                onClick={() => setAngle(findLongestEdgeAngle())}
                style={{
                  width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #f59e0b",
                  background: "transparent", color: "#f59e0b", fontSize: "12px", fontWeight: "bold",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                  transition: "0.2s"
                }}
              >
                📐 จัดแนวตามแนวขอบยาวที่สุด ({findLongestEdgeAngle()}°)
              </button>
            )}
          </div>

        </div>

        {/* Metrics Summary */}
        <div style={{ background: "#111827", padding: "12px", borderRadius: "8px", fontSize: "13px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#9ca3af" }}>พื้นที่ทั้งหมด:</span>
            <strong>{areaSqM.toFixed(1)} ตร.ม. ({areaRai} ไร่ / {areaHectares} Hec)</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#9ca3af" }}>ความยาวแถวรวม:</span>
            <strong style={{ color: "#f59e0b" }}>{pathLength.toFixed(1)} เมตร</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#9ca3af" }}>จำนวนจุดเลี้ยว:</span>
            <strong>{generatedPath.length} จุด</strong>
          </div>
        </div>

        {/* Major Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "auto" }}>
          <button
            onClick={generatePathWaypoints}
            style={{
              width: "100%", padding: "12px", borderRadius: "8px", border: "none",
              background: "#f59e0b", color: "#111827", fontWeight: "bold", cursor: "pointer",
              transition: "0.2s"
            }}
          >
            📐 คำนวณเส้นทาง (Generate Path)
          </button>
          <div style={{
            width: "100%", padding: "6px", borderRadius: "8px", background: "rgba(255, 255, 255, 0.05)",
            color: "#9ca3af", fontSize: "11px", textAlign: "center"
          }}>
            * วาดขอบเขตและสิ่งกีดขวางให้เสร็จ แล้วจึงกดคำนวณเส้นทาง
          </div>

          {generatedPath.length > 0 && (
            <button
              onClick={handleReversePath}
              style={{
                width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #f59e0b",
                background: "transparent", color: "#f59e0b", fontWeight: "bold", cursor: "pointer",
                transition: "0.2s", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
              }}
            >
              🔄 สลับจุดเริ่ม/สิ้นสุด (สลับ S/F)
            </button>
          )}




          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <button
              onClick={handleSaveJob}
              style={{ padding: "10px", borderRadius: "6px", border: "1px solid #4b5563", background: "#374151", color: "white", fontWeight: "bold", cursor: "pointer" }}
            >
              💾 บันทึกแผนงาน
            </button>
            <button
              onClick={handleClearMap}
              style={{ padding: "10px", borderRadius: "6px", border: "1px solid #f87171", background: "transparent", color: "#f87171", fontWeight: "bold", cursor: "pointer" }}
            >
              🧹 ล้างข้อมูล
            </button>
          </div>

          <button
            onClick={handleSendMission}
            disabled={generatedPath.length === 0}
            style={{
              width: "100%", padding: "12px", borderRadius: "8px", border: "none",
              background: generatedPath.length > 0 ? "#10b981" : "#4b5563",
              color: "white", fontWeight: "bold", cursor: generatedPath.length > 0 ? "pointer" : "not-allowed",
              marginTop: "8px"
            }}
          >
            🚀 ส่งภารกิจไปยังรถ UGV
          </button>
        </div>

        {/* Saved Jobs List */}
        {savedJobs.length > 0 && (
          <div style={{ borderTop: "1px solid #374151", paddingTop: "12px", maxHeight: "150px", overflowY: "auto" }}>
            <span style={{ fontSize: "13px", color: "#9ca3af", display: "block", marginBottom: "6px" }}>📂 แผนงานที่บันทึกไว้</span>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {savedJobs.map(job => (
                <div
                  key={job.id}
                  onClick={() => handleLoadJob(job)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#374151", padding: "6px 10px", borderRadius: "4px", fontSize: "12px", cursor: "pointer", transition: "0.2s" }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "180px" }}>{job.name}</span>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <span style={{ color: "#9ca3af", fontSize: "10px" }}>{job.pathLength ? `${job.pathLength.toFixed(0)}m` : ""}</span>
                    <button
                      onClick={(e) => handleDeleteJob(job.id, e)}
                      style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "12px" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Satellite Map Area */}
      <div className="planner-map" style={{ background: "#ffffff", borderRadius: "12px", overflow: "hidden", position: "relative", boxShadow: "0 4px 16px rgba(0,0,0,0.1)" }}>
        <MapContainer
          center={mapCenter}
          zoom={18}
          maxZoom={25}
          style={{ height: "100%", width: "100%", minHeight: "680px", zIndex: 1 }}
        >
          <TileLayer
            url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
            attribution="&copy; Google Maps"
            maxNativeZoom={21}
            maxZoom={25}
          />

          {/* UGV Robot Location Marker */}
          {hasGps && (
            <Marker position={[gps.latitude, gps.longitude]} icon={robotMarkerIcon}>
              <Popup>
                <strong>รถ UGV (Robot)</strong><br />
                Lat: {gps.latitude.toFixed(6)}<br />
                Lng: {gps.longitude.toFixed(6)}<br />
                RTK: {gps.rtk_status || "UNKNOWN"}
              </Popup>
            </Marker>
          )}


          {/* Draw Boundary Polygon */}
          {boundaryVertices.length > 0 && (
            <Polygon
              positions={boundaryVertices}
              pathOptions={{ color: "#10b981", weight: 3, fillColor: "#10b981", fillOpacity: 0.15 }}
            />
          )}

          {/* Draw Shrunken Boundary (Safe Zone) */}
          {shrunkenBoundaryVertices.length > 0 && (
            <Polygon
              positions={shrunkenBoundaryVertices}
              pathOptions={{ color: "#34d399", weight: 1.5, dashArray: "4, 6", fillColor: "transparent" }}
            />
          )}


          {/* Draw Obstacles Polygons */}
          {obstacles.map((obs, obsIdx) => (
            <Polygon
              key={`obs-poly-${obsIdx}`}
              positions={obs}
              pathOptions={{ color: "#ef4444", weight: 2, fillColor: "#ef4444", fillOpacity: 0.3 }}
              eventHandlers={{
                mousedown: (e) => {
                  const timer = setTimeout(() => {
                    if (window.confirm(`คุณต้องการลบสิ่งกีดขวางที่ ${obsIdx + 1} หรือไม่?`)) {
                      removeEntireObstacle(obsIdx);
                    }
                  }, 800);
                  e.target._deleteTimer = timer;
                },
                mouseup: (e) => {
                  if (e.target._deleteTimer) {
                    clearTimeout(e.target._deleteTimer);
                  }
                },
                click: (e) => {
                  if (e.target._deleteTimer) {
                    clearTimeout(e.target._deleteTimer);
                  }
                },
                contextmenu: (e) => {
                  if (e.originalEvent) {
                    e.originalEvent.preventDefault();
                  }
                  if (window.confirm(`คุณต้องการลบสิ่งกีดขวางที่ ${obsIdx + 1} หรือไม่?`)) {
                    removeEntireObstacle(obsIdx);
                  }
                }
              }}
            />
          ))}

          {/* Boundary Vertex Markers */}
          {boundaryVertices.map((vertex, i) => (
            <Marker
              key={`b-vertex-${i}`}
              position={vertex}
              draggable={true}
              icon={getVertexIcon(i + 1, "#10b981")}

              eventHandlers={{
                drag: (e) => handleBoundaryVertexDrag(i, e.target.getLatLng()),
                dragend: (e) => handleBoundaryVertexDragEnd(i, e.target.getLatLng()),
                dblclick: () => removeBoundaryVertex(i)
              }}


            >
              <Popup>
                จุดที่ {i + 1}<br />
                <button onClick={() => removeBoundaryVertex(i)} style={{ color: "red", marginTop: "4px" }}>ลบจุดนี้</button>
              </Popup>
            </Marker>
          ))}

          {/* Obstacle Vertex Markers */}
          {obstacles.map((obs, obsIdx) =>
            obs.map((vertex, vIdx) => (
              <Marker
                key={`obs-vertex-${obsIdx}-${vIdx}`}
                position={vertex}
                draggable={true}
                icon={getVertexIcon(`${obsIdx + 1}.${vIdx + 1}`, "#ef4444")}

                eventHandlers={{
                  drag: (e) => handleObstacleVertexDrag(obsIdx, vIdx, e.target.getLatLng()),
                  dragend: (e) => handleObstacleVertexDragEnd(obsIdx, vIdx, e.target.getLatLng()),
                  dblclick: () => removeObstacleVertex(obsIdx, vIdx)
                }}

              >
                <Popup>
                  สิ่งกีดขวาง {obsIdx + 1} - จุด {vIdx + 1}<br />
                  <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                    <button
                      onClick={() => removeObstacleVertex(obsIdx, vIdx)}
                      style={{ color: "#f87171", border: "1px solid #ef4444", background: "transparent", padding: "2px 6px", borderRadius: "4px", cursor: "pointer", fontSize: "11px", fontWeight: "bold" }}
                    >
                      ลบจุดนี้
                    </button>
                    <button
                      onClick={() => removeEntireObstacle(obsIdx)}
                      style={{ color: "#ffffff", border: "none", background: "#ef4444", padding: "2px 6px", borderRadius: "4px", cursor: "pointer", fontSize: "11px", fontWeight: "bold" }}
                    >
                      ลบทั้งหมด
                    </button>
                  </div>
                </Popup>
              </Marker>

            ))
          )}

          {/* Distance markers along the boundary edges */}
          {boundaryEdges.map(edge => (
            <Marker
              key={edge.id}
              position={edge.midpoint}
              icon={getDistanceIcon(edge.distance)}
              zIndexOffset={100}
            />
          ))}

          {/* Generated coverage path */}
          {generatedPath.length > 0 && (
            <>
              {/* Render multi-colored path segments */}
              {pathSegments.map((seg, idx) => {
                let color = "#f59e0b";
                let dashArray = undefined;
                let weight = 4;

                if (seg.type === "work") {
                  color = "#06b6d4"; // Cyan for spraying/working
                  weight = 4;
                } else if (seg.type === "turn") {
                  color = "#f97316"; // Orange for warning/turns
                  weight = 3.5;
                } else if (seg.type === "transit") {
                  color = "#ef4444"; // Red/dashed for transit travel
                  dashArray = "6, 8";
                  weight = 3;
                }

                return (
                  <Polyline
                    key={`path-seg-${idx}`}
                    positions={seg.positions}
                    pathOptions={{ color, weight, dashArray, lineCap: "round", lineJoin: "round" }}
                  />
                );
              })}

              {/* Intermediate Waypoint Markers showing path numbers and styled by type */}
              {generatedPath.slice(1, -1).map((pt, idx) => {
                let color = "#f59e0b";
                if (pt.type === "work") color = "#06b6d4";
                else if (pt.type === "turn") color = "#f97316";
                else if (pt.type === "transit") color = "#ef4444";

                const realIdx = idx + 1;
                return (
                  <Marker
                    key={`path-wp-${idx}`}
                    position={pt}
                    icon={L.divIcon({
                      className: "path-wp-marker",
                      html: `<div style="background-color: ${color}; color: #ffffff; border: 1.5px solid white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 9px; box-shadow: 0 1px 3px rgba(0,0,0,0.4);">${realIdx + 1}</div>`,
                      iconSize: [18, 18],
                      iconAnchor: [9, 9]
                    })}
                  >
                    <Popup>
                      <div style={{ textAlign: "center" }}>
                        <strong>จุดที่ {realIdx + 1}</strong><br />
                        <button
                          onClick={() => handleSetStartPoint(realIdx)}
                          style={{
                            marginTop: "6px", padding: "4px 8px", background: "#10b981",
                            color: "white", border: "none", borderRadius: "4px",
                            fontWeight: "bold", fontSize: "11px", cursor: "pointer"
                          }}
                        >
                          🚩 ตั้งเป็นจุดเริ่มต้น
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {/* Start Waypoint Marker */}
              <Marker
                position={generatedPath[0]}
                icon={L.divIcon({
                  className: "start-marker",
                  html: `<div style="background-color: #10b981; color: white; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">S</div>`,
                  iconSize: [24, 24],
                  iconAnchor: [12, 12]
                })}
              />
              {/* End Waypoint Marker */}
              <Marker
                position={generatedPath[generatedPath.length - 1]}
                icon={L.divIcon({
                  className: "end-marker",
                  html: `<div style="background-color: #ef4444; color: white; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">F</div>`,
                  iconSize: [24, 24],
                  iconAnchor: [12, 12]
                })}
              >
                <Popup>
                  <div style={{ textAlign: "center" }}>
                    <strong>จุดสิ้นสุด (F)</strong><br />
                    <button
                      onClick={() => handleSetStartPoint(generatedPath.length - 1)}
                      style={{
                        marginTop: "6px", padding: "4px 8px", background: "#10b981",
                        color: "white", border: "none", borderRadius: "4px",
                        fontWeight: "bold", fontSize: "11px", cursor: "pointer"
                      }}
                    >
                      🚩 ตั้งเป็นจุดเริ่มต้น
                    </button>
                  </div>
                </Popup>
              </Marker>
            </>
          )}

          {/* User Location Dot */}
          {userLocation && (
            <Marker
              position={userLocation}
              icon={L.divIcon({
                className: "user-location-marker",
                html: `<div style="background-color: #3b82f6; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 8px #3b82f6; animation: user-pulse 1.8s infinite;"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
              })}
            />
          )}

          {/* Handlers */}
          <MapEventsHandler drawingMode={drawingMode} onMapClick={handleMapClick} />
          <MapController setMapRef={setMapRef} />
        </MapContainer>

        {/* Centering buttons overlay */}
        <div style={{
          position: "absolute",
          bottom: "20px",
          right: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          zIndex: 1000
        }}>
          <button
            onClick={centerOnUser}
            style={{
              padding: "10px 14px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "#2563eb",
              color: "white",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px"
            }}
          >
            📍 ตำแหน่งของฉัน (My Location)
          </button>
          <button
            onClick={centerOnRobot}
            style={{
              padding: "10px 14px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "#10b981",
              color: "white",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px"
            }}
          >
            🤖 ตำแหน่งรถ UGV
          </button>
        </div>


        {/* Map mode overlay indicator */}
        <div style={{
          position: "absolute",
          top: "12px",
          right: "12px",
          background: "rgba(17, 24, 39, 0.85)",
          color: "white",
          padding: "6px 14px",
          borderRadius: "20px",
          fontSize: "12px",
          fontWeight: "bold",
          zIndex: 1000,
          border: "1px solid rgba(255, 255, 255, 0.15)",
          display: "flex",
          alignItems: "center",
          gap: "6px"
        }}>
          {drawingMode === "boundary" && <span style={{ color: "#10b981" }}>● กำลังวาดขอบเขต</span>}
          {drawingMode === "obstacle" && <span style={{ color: "#ef4444" }}>● กำลังวาดสิ่งกีดขวาง</span>}
          {drawingMode === "none" && <span style={{ color: "#3b82f6" }}>ℹ️ ลากจุดเพื่อแก้ไขแผนที่ได้</span>}
        </div>
      </div>
    </div>
  );
}
