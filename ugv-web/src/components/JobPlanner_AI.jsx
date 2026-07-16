import React, { useState, useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMap, useMapEvents, Popup, Circle } from "react-leaflet";
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
} from "../utils/pathPlannerUtils_AI";

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





function getRowRectangle(rowLine, halfWidth = 1.0) {
    if (!Array.isArray(rowLine) || rowLine.length < 2) return [];
    const [p1, p2] = rowLine;
    const refLat = p1[0];
    const refLng = p1[1];

    const xy1 = toLocalXY(p1[0], p1[1], refLat, refLng);
    const xy2 = toLocalXY(p2[0], p2[1], refLat, refLng);

    const dx = xy2.x - xy1.x;
    const dy = xy2.y - xy1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return [];

    const nx = -dy / len;
    const ny = dx / len;

    const c1 = { x: xy1.x + halfWidth * nx, y: xy1.y + halfWidth * ny };
    const c2 = { x: xy2.x + halfWidth * nx, y: xy2.y + halfWidth * ny };
    const c3 = { x: xy2.x - halfWidth * nx, y: xy2.y - halfWidth * ny };
    const c4 = { x: xy1.x - halfWidth * nx, y: xy1.y - halfWidth * ny };

    return [
        toLatLng(c1.x, c1.y, refLat, refLng),
        toLatLng(c2.x, c2.y, refLat, refLng),
        toLatLng(c3.x, c3.y, refLat, refLng),
        toLatLng(c4.x, c4.y, refLat, refLng)
    ];
}


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
    const defaultCenter = [16.394486, 99.620452]; // Bangkok default
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
    const [inset, setInset] = useState(2.0); // boundary inset in meters
    const [obstacleClearance, setObstacleClearance] = useState(1.1); // vehicle half-width + safety margin
    const [spacing, setSpacing] = useState(3.0); // meters
    const [angle, setAngle] = useState(0); // degrees
    const [pattern, setPattern] = useState("sweep"); // "sweep", "spiral", "boundary"

    // Satellite/map row analysis through backend API
    const [mapAnalysis, setMapAnalysis] = useState(null);
    const [isAnalyzingMap, setIsAnalyzingMap] = useState(false);
    const [detectedRows, setDetectedRows] = useState([]);
    const [showRowBlocks, setShowRowBlocks] = useState(true);
    const rowBlockWidth = 2.0;

    // Planning Result
    const [generatedPath, setGeneratedPath] = useState([]); // flattened Array of [lat, lng]
    const [generatedSegments, setGeneratedSegments] = useState([]); // work/transit segments
    const [waypointModes, setWaypointModes] = useState([]);
    const [pathLength, setPathLength] = useState(0); // meters
    const [workLength, setWorkLength] = useState(0);
    const [transitLength, setTransitLength] = useState(0);

    // Water Spray Refill System States
    const [tankCapacity, setTankCapacity] = useState(200); // Liters
    const [speedMin, setSpeedMin] = useState(20); // meters/minute
    const [sprayRate, setSprayRate] = useState(10.0); // Liters/minute
    const [refillPoints, setRefillPoints] = useState([]); // Computed [{ lat, lng, index }]
    const [refillStrategy, setRefillStrategy] = useState("headland"); // "headland" or "midrow"

    // Haversine distance formula
    const getLatLngDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    // Calculate maximum row length and water requirement to check for deficit warning
    const maxRowLength = useMemo(() => {
        const workSegs = generatedSegments.filter(s => s.type === "work");
        if (workSegs.length === 0) return 0;
        let maxLen = 0;
        workSegs.forEach(segment => {
            let len = 0;
            const pts = segment.points;
            if (pts && pts.length >= 2) {
                for (let i = 0; i < pts.length - 1; i++) {
                    len += getLatLngDistance(
                        pts[i][0] ?? pts[i].lat, pts[i][1] ?? pts[i].lng,
                        pts[i + 1][0] ?? pts[i + 1].lat, pts[i + 1][1] ?? pts[i + 1].lng
                    );
                }
            }
            if (len > maxLen) maxLen = len;
        });
        return maxLen;
    }, [generatedSegments]);

    const maxRowWaterNeeded = speedMin > 0 ? (maxRowLength * sprayRate / speedMin) : 0;
    const hasWaterDeficitWarning = maxRowWaterNeeded > (tankCapacity * 0.90);

    // Recommend safe flow rate based on longest row and speed
    const recommendedSprayRate = useMemo(() => {
        const usableCapacity = tankCapacity * 0.90;
        if (maxRowLength > 0 && speedMin > 0) {
            return (usableCapacity * speedMin) / maxRowLength;
        }
        return null;
    }, [maxRowLength, tankCapacity, speedMin]);

    // Calculate exact refill coordinates (based on refillStrategy, enforcing 10% min safety buffer)
    useEffect(() => {
        if (generatedSegments.length === 0) {
            setRefillPoints([]);
            return;
        }

        const refills = [];
        let currentWater = tankCapacity;
        const K = speedMin > 0 ? (sprayRate / speedMin) : 0; // Liters per meter
        const minWater = tankCapacity * 0.10; // 10% safety buffer to protect the pump

        if (refillStrategy === "midrow") {
            // Add initial refill at start point
            const firstSeg = generatedSegments.find(s => s.type === "work");
            if (firstSeg && firstSeg.points && firstSeg.points.length >= 2) {
                const startPt = firstSeg.points[0];
                refills.push({
                    lat: startPt[0] ?? startPt.lat,
                    lng: startPt[1] ?? startPt.lng,
                    index: 1,
                    refillAmount: tankCapacity,
                    isHeadland: false,
                    isStartPoint: true
                });
                currentWater = tankCapacity;
            }

            // Mid-row depletion strategy: refill exactly when water hits the 10% buffer
            generatedSegments.forEach((segment) => {
                const isSpraying = segment.type === "work";
                const pts = segment.points;
                if (!pts || pts.length < 2) return;

                for (let i = 0; i < pts.length - 1; i++) {
                    const ptA = pts[i];
                    const ptB = pts[i + 1];
                    const latA = ptA[0] ?? ptA.lat;
                    const lngA = ptA[1] ?? ptA.lng;
                    const latB = ptB[0] ?? ptB.lat;
                    const lngB = ptB[1] ?? ptB.lng;

                    const stepDist = getLatLngDistance(latA, lngA, latB, lngB);

                    if (!isSpraying || K === 0) {
                        continue;
                    }

                    let remainingStepDist = stepDist;
                    let currentPos = [latA, lngA];

                    while (remainingStepDist > 0) {
                        const waterNeeded = remainingStepDist * K;
                        const usableWater = currentWater - minWater;

                        if (usableWater >= waterNeeded) {
                            currentWater -= waterNeeded;
                            remainingStepDist = 0;
                        } else {
                            const travelFraction = Math.max(0, usableWater / waterNeeded);
                            const distToEmpty = remainingStepDist * travelFraction;

                            const lastLat = currentPos[0];
                            const lastLng = currentPos[1];
                            const latEmpty = lastLat + travelFraction * (latB - lastLat);
                            const lngEmpty = lastLng + travelFraction * (lngB - lastLng);

                            refills.push({
                                lat: latEmpty,
                                lng: lngEmpty,
                                index: refills.length + 1,
                                refillAmount: parseFloat((tankCapacity - minWater).toFixed(1)), // Refilled from 10% back to full
                                isHeadland: false
                            });

                            currentWater = tankCapacity;
                            remainingStepDist -= distToEmpty;
                            currentPos = [latEmpty, lngEmpty];
                        }
                    }
                }
            });
        } else {
            // Headland lookahead strategy (only on starting side, respecting 10% buffer)
            const workSegments = generatedSegments.filter(s => s.type === "work");
            if (workSegments.length === 0) {
                setRefillPoints([]);
                return;
            }

            const rows = workSegments.map((segment) => {
                const pts = segment.points;
                let len = 0;
                if (pts && pts.length >= 2) {
                    for (let i = 0; i < pts.length - 1; i++) {
                        len += getLatLngDistance(
                            pts[i][0] ?? pts[i].lat, pts[i][1] ?? pts[i].lng,
                            pts[i + 1][0] ?? pts[i + 1].lat, pts[i + 1][1] ?? pts[i + 1].lng
                        );
                    }
                }
                return {
                    points: pts,
                    waterNeeded: len * K
                };
            });

            // Add initial refill at the start of first row
            const firstRow = rows[0];
            const firstPts = firstRow.points;
            if (firstPts && firstPts.length >= 2) {
                refills.push({
                    lat: firstPts[0][0] ?? firstPts[0].lat,
                    lng: firstPts[0][1] ?? firstPts[0].lng,
                    index: 1,
                    refillAmount: tankCapacity,
                    isHeadland: true,
                    isStartPoint: true
                });
                currentWater = tankCapacity;
            }

            for (let j = 0; j < rows.length; j++) {
                const row = rows[j];
                const pts = row.points;
                if (!pts || pts.length < 2) continue;

                const isStartOnStartingSide = (j % 2 === 0);

                // Only check starting side refill for j > 0 (since j = 0 is handled by the initial fill)
                if (isStartOnStartingSide && j > 0) {
                    const nextRowWater = (j + 1 < rows.length) ? rows[j + 1].waterNeeded : 0;
                    const waterNeededToNextVisit = row.waterNeeded + nextRowWater;

                    // Refill if usable water drops below the water needed to return
                    if (currentWater - minWater < waterNeededToNextVisit) {
                        const startPt = pts[0];
                        const refillAmount = tankCapacity - currentWater;
                        refills.push({
                            lat: startPt[0] ?? startPt.lat,
                            lng: startPt[1] ?? startPt.lng,
                            index: refills.length + 1,
                            refillAmount: parseFloat(refillAmount.toFixed(1)),
                            isHeadland: true
                        });
                        currentWater = tankCapacity;
                    }
                }

                currentWater = Math.max(minWater, currentWater - row.waterNeeded);

                const isEndOnStartingSide = (j % 2 !== 0);

                if (isEndOnStartingSide) {
                    const nextRowWater = (j + 1 < rows.length) ? rows[j + 1].waterNeeded : 0;
                    const nextNextRowWater = (j + 2 < rows.length) ? rows[j + 2].waterNeeded : 0;
                    const waterNeededToNextVisit = nextRowWater + nextNextRowWater;

                    if (currentWater - minWater < waterNeededToNextVisit && nextRowWater > 0) {
                        const endPt = pts[pts.length - 1];
                        const refillAmount = tankCapacity - currentWater;
                        refills.push({
                            lat: endPt[0] ?? endPt.lat,
                            lng: endPt[1] ?? endPt.lng,
                            index: refills.length + 1,
                            refillAmount: parseFloat(refillAmount.toFixed(1)),
                            isHeadland: true
                        });
                        currentWater = tankCapacity;
                    }
                }
            }
        }

        setRefillPoints(refills);
    }, [generatedSegments, tankCapacity, speedMin, sprayRate, refillStrategy]);

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

    const getBoundaryBounds = (vertices) => {
        const lats = vertices.map(([lat]) => lat);
        const lngs = vertices.map(([, lng]) => lng);
        return {
            north: Math.max(...lats),
            south: Math.min(...lats),
            east: Math.max(...lngs),
            west: Math.min(...lngs)
        };
    };

    const handleAnalyzeMap = async () => {
        if (boundaryVertices.length < 3) {
            alert("กรุณาวาดขอบเขตแปลงอย่างน้อย 3 จุดก่อนวิเคราะห์");
            return;
        }

        setIsAnalyzingMap(true);
        setMapAnalysis(null);
        setDetectedRows([]);

        try {
            const payload = {
                boundary: boundaryVertices,
                obstacles,
                bounds: getBoundaryBounds(boundaryVertices),
                zoom: Math.min(21, Math.max(17, mapRef?.getZoom?.() ?? 19))
            };

            const response = await fetch("/api/vision/analyze-field", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });


            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }
            if (!Number.isFinite(result.angle)) {
                throw new Error("Server ไม่ได้ส่งค่า angle ที่ถูกต้องกลับมา");
            }

            const normalizedAngle = ((Math.round(result.angle) % 180) + 180) % 180;
            setMapAnalysis({ ...result, angle: normalizedAngle });
            setDetectedRows(Array.isArray(result.rows) ? result.rows : []);
            setAngle(normalizedAngle);

            if (Number.isFinite(result.spacing) && result.spacing >= 0.5) {
                setSpacing(Number(result.spacing.toFixed(1)));
            }

            const confidencePct = Math.round((result.confidence ?? 0) * 100);
            if (confidencePct < 35) {
                alert(`ตรวจพบแนวประมาณ ${normalizedAngle}° แต่ความมั่นใจต่ำ (${confidencePct}%) กรุณาตรวจสอบเส้นสีม่วงก่อนใช้งาน`);
            }
        } catch (error) {
            console.error("Map analysis failed", error);
            alert("วิเคราะห์ภาพดาวเทียมไม่สำเร็จ: " + error.message);
        } finally {
            setIsAnalyzingMap(false);
        }
    };

    // Boustrophedon Sweep coverage path algorithm
    const generatePathWaypoints = () => {
        if (boundaryVertices.length < 3) {
            alert("กรุณาวาดขอบเขตแปลงอย่างน้อย 3 จุด!");
            setGeneratedPath([]);
            setPathLength(0);
            return;
        }
        const result = generatePathPlan(boundaryVertices, obstacles, {
            boundaryInset: inset,
            obstacleClearance,
            spacing,
            angle
        });
        if (result.error) {
            alert(result.error);
            setGeneratedPath([]);
            setGeneratedSegments([]);
            setWaypointModes([]);
            setPathLength(0);
            setWorkLength(0);
            setTransitLength(0);
            return;
        }
        setGeneratedPath(result.path);
        setGeneratedSegments(result.segments || []);
        setWaypointModes(result.waypointModes || []);
        setPathLength(result.length || 0);
        setWorkLength(result.workLength || 0);
        setTransitLength(result.transitLength || 0);
    };

    const handleSetStartPoint = (clickedIdx) => {
        if (generatedPath.length < 2) return;
        const result = reorderPathStartPoint(
            generatedPath,
            waypointModes,
            boundaryVertices,
            obstacles,
            inset,
            obstacleClearance,
            clickedIdx
        );
        if (result) {
            setGeneratedPath(result.path);
            setWaypointModes(result.waypointModes);
            setGeneratedSegments(result.segments);
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
            obstacleClearance,
            spacing,
            angle,
            pattern,
            path: generatedPath,
            segments: generatedSegments,
            waypointModes,
            pathLength,
            workLength,
            transitLength
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
        setObstacleClearance(job.obstacleClearance ?? 1.1);
        setSpacing(job.spacing);
        setAngle(job.angle);
        setPattern(job.pattern || "sweep");
        setGeneratedPath(job.path || []);
        setGeneratedSegments(job.segments || []);
        setWaypointModes(job.waypointModes || []);
        setPathLength(job.pathLength || 0);
        setWorkLength(job.workLength || 0);
        setTransitLength(job.transitLength || 0);
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
        const stampSecs = Math.floor(Date.now() / 1000);
        const poses = generatedPath.map((pt, idx) => {
            const mode = waypointModes[idx] || { type: "transit", spray: false };
            return {
                header: {
                    seq: idx,
                    stamp: { secs: stampSecs, nsecs: 0 },
                    frame_id: "wgs84"
                },
                pose: {
                    // Current robot bridge convention: x=latitude, y=longitude.
                    position: { x: pt[0], y: pt[1], z: 0 },
                    orientation: { x: 0, y: 0, z: 0, w: 1 }
                },
                mode: mode.type.toUpperCase(),
                spray: Boolean(mode.spray)
            };
        });

        const pathMessage = {
            type: "path",
            coordinate_system: "WGS84",
            job_name: jobName,
            poses,
            segments: generatedSegments.map(segment => ({
                type: segment.type,
                spray: segment.spray,
                length: segment.length,
                points: segment.points.map(point => ({
                    latitude: point[0],
                    longitude: point[1]
                }))
            })),
            summary: {
                total_length_m: pathLength,
                work_length_m: workLength,
                transit_length_m: transitLength
            }
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
        setGeneratedSegments([]);
        setWaypointModes([]);
        setPathLength(0);
        setWorkLength(0);
        setTransitLength(0);
        setDrawingMode("none");
        setMapAnalysis(null);
        setDetectedRows([]);
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
                        <span style={{ fontSize: "14px" }}>ระยะหลบสิ่งกีดขวาง</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <button
                                onClick={() => setObstacleClearance(prev => Math.max(0, parseFloat((prev - 0.1).toFixed(1))))}
                                style={{ width: "28px", height: "28px", background: "#374151", border: "none", borderRadius: "4px", color: "white", cursor: "pointer", fontSize: "16px", fontWeight: "bold" }}
                            >-</button>
                            <span style={{ width: "50px", textAlign: "center", fontFamily: "monospace", fontSize: "15px" }}>{obstacleClearance} m</span>
                            <button
                                onClick={() => setObstacleClearance(prev => parseFloat((prev + 0.1).toFixed(1)))}
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

                        <button
                            onClick={handleAnalyzeMap}
                            disabled={isAnalyzingMap || boundaryVertices.length < 3}
                            style={{
                                width: "100%", marginTop: "8px", padding: "8px 10px", borderRadius: "6px",
                                border: "1px solid #8b5cf6",
                                background: isAnalyzingMap ? "#374151" : "rgba(139,92,246,0.12)",
                                color: boundaryVertices.length >= 3 ? "#c4b5fd" : "#6b7280",
                                fontSize: "12px", fontWeight: "bold",
                                cursor: isAnalyzingMap ? "wait" : boundaryVertices.length >= 3 ? "pointer" : "not-allowed"
                            }}
                        >
                            {isAnalyzingMap ? "⏳ กำลังวิเคราะห์ภาพดาวเทียม..." : "🤖 วิเคราะห์แนวแถวจากขอบเขตแปลง"}
                        </button>

                        {mapAnalysis && (
                            <div style={{
                                marginTop: "8px", padding: "8px", borderRadius: "6px",
                                background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.45)",
                                fontSize: "11px", lineHeight: 1.5
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                    <span style={{ color: "#c4b5fd" }}>แนวที่ตรวจพบ:</span>
                                    <strong>{mapAnalysis.angle}°</strong>
                                </div>
                                {Number.isFinite(mapAnalysis.spacing) && (
                                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                                        <span style={{ color: "#c4b5fd" }}>ระยะแถวโดยประมาณ:</span>
                                        <strong>{mapAnalysis.spacing.toFixed(1)} m</strong>
                                    </div>
                                )}
                                {Number.isFinite(mapAnalysis.treeCount) && (
                                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                                        <span style={{ color: "#c4b5fd" }}>จำนวนต้นไม้ที่พบ:</span>
                                        <strong style={{ color: "#60a5fa" }}>{mapAnalysis.treeCount} ต้น</strong>
                                    </div>
                                )}
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                    <span style={{ color: "#c4b5fd" }}>ความมั่นใจ:</span>
                                    <strong style={{ color: (mapAnalysis.confidence ?? 0) >= 0.55 ? "#34d399" : "#fbbf24" }}>
                                        {Math.round((mapAnalysis.confidence ?? 0) * 100)}%
                                    </strong>
                                </div>
                                <div style={{ color: "#9ca3af", marginTop: "3px" }}>
                                    เส้นสีแดงทึบคือแนวต้นไม้ที่ระบบตรวจพบ กรุณาตรวจสอบก่อนสร้างภารกิจจริง
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", paddingTop: "6px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                                    <input
                                        type="checkbox"
                                        id="toggle-row-blocks"
                                        checked={showRowBlocks}
                                        onChange={(e) => setShowRowBlocks(e.target.checked)}
                                        style={{ width: "14px", height: "14px", cursor: "pointer" }}
                                    />
                                    <label htmlFor="toggle-row-blocks" style={{ fontSize: "11px", color: "#c4b5fd", cursor: "pointer", userSelect: "none" }}>
                                        🌳 แสดงแนวต้นไม้ที่ตรวจพบ
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>

                </div>

                {/* Refill Calculation Parameters */}
                <div style={{ background: "#111827", padding: "12px", borderRadius: "8px", fontSize: "13px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontWeight: "bold", fontSize: "13px", color: "#38bdf8", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "4px" }}>
                        💧 ตั้งค่าการพ่นยาและเติมน้ำ
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "#9ca3af" }}>ความจุน้ำยา (Tank):</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <input
                                type="number"
                                min="10"
                                max="1000"
                                value={tankCapacity}
                                onChange={(e) => setTankCapacity(Math.max(10, parseInt(e.target.value) || 0))}
                                style={{ width: "60px", background: "#374151", border: "1px solid #4b5563", borderRadius: "4px", color: "white", padding: "2px 4px", fontSize: "12px", textAlign: "right" }}
                            />
                            <span style={{ color: "#9ca3af" }}>ลิตร</span>
                        </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "#9ca3af" }}>อัตราฉีดพ่น (Flow Rate):</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                max="50"
                                value={sprayRate}
                                onChange={(e) => setSprayRate(Math.max(0.5, parseFloat(e.target.value) || 0))}
                                style={{ width: "60px", background: "#374151", border: "1px solid #4b5563", borderRadius: "4px", color: "white", padding: "2px 4px", fontSize: "12px", textAlign: "right" }}
                            />
                            <span style={{ color: "#9ca3af" }}>L/นาที</span>
                        </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "#9ca3af" }}>ความเร็วรถ (Speed):</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <input
                                type="number"
                                min="5"
                                max="200"
                                value={speedMin}
                                onChange={(e) => setSpeedMin(Math.max(5, parseInt(e.target.value) || 0))}
                                style={{ width: "60px", background: "#374151", border: "1px solid #4b5563", borderRadius: "4px", color: "white", padding: "2px 4px", fontSize: "12px", textAlign: "right" }}
                            />
                            <span style={{ color: "#9ca3af" }}>ม./นาที</span>
                        </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "#9ca3af" }}>รูปแบบการเติม:</span>
                        <select
                            value={refillStrategy}
                            onChange={(e) => setRefillStrategy(e.target.value)}
                            style={{ background: "#374151", border: "1px solid #4b5563", borderRadius: "4px", color: "white", padding: "2px 4px", fontSize: "12px", width: "120px" }}
                        >
                            <option value="headland">เติมที่หัวแปลง (สตาร์ท)</option>
                            <option value="midrow">เติมระหว่างทาง (เมื่อหมด)</option>
                        </select>
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
                        <span style={{ color: "#9ca3af" }}>ระยะทำงาน/พ่นยา:</span>
                        <strong style={{ color: "#f59e0b" }}>{workLength.toFixed(1)} เมตร</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#9ca3af" }}>ระยะเดินทาง/ปิดพ่น:</span>
                        <strong style={{ color: "#38bdf8" }}>{transitLength.toFixed(1)} เมตร</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#9ca3af" }}>จำนวนจุดเลี้ยว:</span>
                        <strong>{generatedPath.length} จุด</strong>
                    </div>

                    {/* Water Consumption Metrics */}
                    {workLength > 0 && (
                        <>
                            <div style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "4px 0" }}></div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "#9ca3af" }}>ปริมาณน้ำยารวม:</span>
                                <strong style={{ color: "#60a5fa" }}>{((workLength * sprayRate) / speedMin).toFixed(1)} ลิตร</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "#9ca3af" }}>จำนวนครั้งที่ต้องเติม:</span>
                                <strong style={{ color: refillPoints.length > 0 ? "#f87171" : "#34d399" }}>
                                    {refillPoints.length} ครั้ง
                                </strong>
                            </div>
                            {hasWaterDeficitWarning && (
                                <div style={{ color: "#f87171", fontSize: "11px", marginTop: "6px", paddingTop: "6px", borderTop: "1px dashed rgba(248, 113, 113, 0.3)", lineHeight: 1.4 }}>
                                    ⚠️ <strong>น้ำยาไม่พอในแถว:</strong> มีแถวที่ต้องการสูงสุด {maxRowWaterNeeded.toFixed(1)} ลิตร เกินความจุใช้งานถังยา ({parseFloat((tankCapacity * 0.90).toFixed(1))} ลิตร) <strong>แนะนำปรับลดอัตราพ่นลงเหลือไม่เกิน {recommendedSprayRate ? recommendedSprayRate.toFixed(1) : 0} L/นาที</strong> (หรือเพิ่มความเร็วรถ UGV)
                                </div>
                            )}
                        </>
                    )}
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
                            {generatedSegments.length > 0 ? generatedSegments.map((segment, segmentIndex) => (
                                <Polyline
                                    key={`generated-segment-${segmentIndex}`}
                                    positions={segment.points}
                                    pathOptions={segment.type === "work"
                                        ? { color: "#f59e0b", weight: 4, lineCap: "round", lineJoin: "round" }
                                        : { color: "#38bdf8", weight: 3, dashArray: "8, 8", lineCap: "round", lineJoin: "round" }
                                    }
                                />
                            )) : (
                                <Polyline
                                    positions={generatedPath}
                                    pathOptions={{ color: "#f59e0b", weight: 4, lineCap: "round", lineJoin: "round" }}
                                />
                            )}
                            {/* Intermediate Waypoint Markers showing path numbers */}
                            {generatedPath.slice(1, -1).map((pt, idx) => {
                                const realIdx = idx + 1;
                                return (
                                    <Marker
                                        key={`path-wp-${idx}`}
                                        position={pt}
                                        icon={L.divIcon({
                                            className: "path-wp-marker",
                                            html: `<div style="background-color: #f59e0b; color: #111827; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 9px; box-shadow: 0 1px 3px rgba(0,0,0,0.4);">${realIdx + 1}</div>`,
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

                    {/* Water Refill Points Markers */}
                    {refillPoints.map((pt, index) => (
                        <Marker
                            key={`refill-point-${index}`}
                            position={[pt.lat, pt.lng]}
                            icon={L.divIcon({
                                className: "refill-marker",
                                html: `<div style="background-color: #2563eb; color: white; width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid white; display: flex; align-items: center; justify-content: center; font-size: 11px; box-shadow: 0 2px 4px rgba(0,0,0,0.5); z-index: 500;">💧</div>`,
                                iconSize: [22, 22],
                                iconAnchor: [11, 11]
                            })}
                        >
                            <Popup>
                                <div style={{ fontSize: "12px", lineHeight: 1.4 }}>
                                    {pt.isStartPoint ? (
                                        <>
                                            <strong style={{ color: "#10b981" }}>💧 จุดเริ่มต้นพ่นยา (เตรียมน้ำยาเต็มถัง)</strong><br />
                                            <span>ปริมาณที่ต้องใส่: <strong style={{ color: "#10b981" }}>{tankCapacity} ลิตร</strong></span>
                                        </>
                                    ) : (
                                        <>
                                            <strong style={{ color: "#2563eb" }}>💧 จุดเติมน้ำยาที่ {pt.index} {pt.isHeadland ? "(หัวแปลง)" : "(ระหว่างทาง)"}</strong><br />
                                            <span>ปริมาณที่ต้องเติมเพิ่ม: <strong style={{ color: "#2563eb" }}>{pt.refillAmount} ลิตร</strong></span><br />
                                            <span style={{ color: "#9ca3af", fontSize: "11px" }}>(เติมเพิ่มเพื่อกลับสู่ความจุเต็มถัง {tankCapacity} ลิตร)</span>
                                        </>
                                    )}
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    {/* AI-detected Trees (Row Lines) */}
                    {showRowBlocks && mapAnalysis && Array.isArray(mapAnalysis.rows) && mapAnalysis.rows.map((row, index) => (
                        <Polyline
                            key={`detected-row-line-${index}`}
                            positions={row}
                            pathOptions={{
                                color: "#ef4444",      // solid red line
                                weight: 2.5,
                                opacity: 0.8
                            }}
                        >
                            <Popup>
                                <div style={{ fontSize: "12px", lineHeight: 1.4 }}>
                                    <strong>🚜 แนวต้นไม้แถวที่ {index + 1}</strong><br />
                                    <span>องศาแนวแถว: {mapAnalysis.angle}°</span>
                                </div>
                            </Popup>
                        </Polyline>
                    ))}

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



                {generatedPath.length > 0 && (
                    <div style={{
                        position: "absolute",
                        top: "12px",
                        left: "12px",
                        background: "rgba(17, 24, 39, 0.88)",
                        color: "white",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        zIndex: 1000,
                        border: "1px solid rgba(255,255,255,0.15)"
                    }}>
                        <div><span style={{ color: "#f59e0b", fontWeight: "bold" }}>━━</span> แนวทำงาน / เปิดพ่นยา</div>
                        <div><span style={{ color: "#38bdf8", fontWeight: "bold" }}>┄┄</span> เส้นเดินทาง / ปิดพ่นยา</div>
                    </div>
                )}

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