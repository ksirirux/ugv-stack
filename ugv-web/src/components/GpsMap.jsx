import React, { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline, Circle, CircleMarker, LayerGroup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix for default marker icon in react-leaflet
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


const redIcon = L.divIcon({
  className: "custom-div-icon",
  html: "<div style='background-color: #ef4444; width: 24px; height: 24px; border-radius: 50%; border: 4px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.6);'></div>",
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

// Component to handle map clicks
function MapClickHandler({ onGoalSelected, disabled }) {
  useMapEvents({
    click(e) {
      if (disabled) return;
      onGoalSelected({
        frame_id: "wgs84", // Indicate this is a GPS coordinate
        x: e.latlng.lat, // Maps to x for backend compatibility
        y: e.latlng.lng, // Maps to y for backend compatibility
        latitude: e.latlng.lat,
        longitude: e.latlng.lng,
        yaw: 0
      });
    }
  });
  return null;
}

// Component to recenter map when GPS changes
function MapUpdater({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] !== undefined && center[1] !== undefined && center[0] !== null) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

const getRTK = (rtk_status) => {
  switch (rtk_status) {
    case "RTK_FIXED":
      return "Fixed"
      break;
    case "RTK_FLOAT":
      return "Float"
      break;
    default:
      rtk_status = "No Fix"
      break;

  }


}

export default function GpsMap({ gps, robotPose, path, laserScan, navigationGoal, onGoalSelected, goalSelectionDisabled, gpsHistory }) {
  // Default to Bangkok if no GPS
  const defaultCenter = [13.7563, 100.5018];

  const hasGps = gps && gps.latitude !== null && gps.longitude !== null;
  const center = hasGps ? [gps.latitude, gps.longitude] : defaultCenter;

  const isRtkFixed = gps?.rtk_status === "RTK_FIXED";
  const markerColor = isRtkFixed ? '#22c55e' : '#eab308';

  const yaw = robotPose?.yaw ?? 0;
  // Convert ROS yaw to Leaflet CSS rotation
  // Adding 90 degrees from the previous state (which makes it +180 offset in total if we compare to 0)
  const headingDeg = -(yaw * 180 / Math.PI) + 90;

  const markerIcon = React.useMemo(() => {
    return L.divIcon({
      className: "custom-div-icon",
      html: `<div style="transform: rotate(${headingDeg}deg); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));">
               <svg width="32" height="32" viewBox="0 0 24 24" fill="${markerColor}" stroke="white" stroke-width="2" stroke-linejoin="round">
                 <path d="M12 2 L22 21 L12 17 L2 21 Z" />
               </svg>
             </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }, [markerColor, headingDeg]);

  const polylinePositions = React.useMemo(() => {
    if (!path || !Array.isArray(path.poses)) return [];

    return path.poses
      .map(pose => {
        const x = Number(pose.pose?.position?.x);
        const y = Number(pose.pose?.position?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          return [x, y]; // Assuming x is Lat and y is Lng
        }
        return null;
      })
      .filter(p => p !== null);
  }, [path]);

  const radarRadiuses = [1, 2, 3, 5]; // meters

  const scanPoints = React.useMemo(() => {
    if (!hasGps || !laserScan || !Array.isArray(laserScan.ranges)) return [];
    
    const points = [];
    const robotYaw = robotPose?.yaw ?? 0;
    const cosYaw = Math.cos(robotYaw);
    const sinYaw = Math.sin(robotYaw);
    const angleMin = Number(laserScan.angle_min);
    const angleInc = Number(laserScan.angle_increment);
    const rangeMin = Number(laserScan.range_min ?? 0);
    const rangeMax = Number(laserScan.range_max ?? Infinity);
    
    const latRad = gps.latitude * (Math.PI / 180.0);
    const metersPerLat = 111320;
    const metersPerLng = 111320 * Math.cos(latRad);

    laserScan.ranges.forEach((rawRange, index) => {
      const range = Number(rawRange);
      if (!Number.isFinite(range) || range < rangeMin || range > rangeMax) return;
      
      const scanAngle = angleMin + index * angleInc;
      
      // พิกัด local ของตัวรถ (X=หน้า, Y=ซ้าย)
      const localX = range * Math.cos(scanAngle);
      const localY = range * Math.sin(scanAngle);
      
      // หมุนไปตามหัวรถ
      const worldX = cosYaw * localX - sinYaw * localY;
      const worldY = sinYaw * localX + cosYaw * localY;
      
      // แปลง offset เมตร เป็นค่า lat/lng (สมมติ X = แกน Lat เหนือ-ใต้, Y = แกน Lng ออก-ตก)
      const pointLat = gps.latitude + (worldX / metersPerLat);
      const pointLng = gps.longitude + (worldY / metersPerLng);
      
      points.push([pointLat, pointLng]);
    });
    
    return points;
  }, [hasGps, laserScan, robotPose, gps]);

  return (
    <div className="map-card" style={{ background: '#1f2937', padding: '10px', borderRadius: '8px' }}>
      <div className="map-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2>Outdoor GPS Map</h2>
        <span style={{ color: isRtkFixed ? '#22c55e' : '#eab308', fontWeight: 'bold' }}>
          RTK: {getRTK(gps?.rtk_status)}
        </span>
      </div>

      <div style={{ height: "650px", width: "100%", position: "relative" }}>
        <MapContainer 
          center={center} 
          zoom={19} 
          scrollWheelZoom={true} 
          style={{ height: "100%", width: "100%", borderRadius: '6px' }}
        >
          <TileLayer
            url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
            attribution="&copy; Google Maps"
            maxNativeZoom={21}
            maxZoom={30}
          />

          {hasGps && (
            <Marker position={center} icon={markerIcon}>
              <Popup>
                <strong>UGV Location</strong><br />
                Lat: {gps.latitude.toFixed(6)}<br />
                Lng: {gps.longitude.toFixed(6)}<br />
                RTK: {getRTK(gps.rtk_status)}
              </Popup>
            </Marker>
          )}

          {hasGps && (
            <LayerGroup>
              {/* Radar Rings */}
              {radarRadiuses.map(r => (
                <Circle 
                  key={`radar-${r}`} 
                  center={center} 
                  radius={r} 
                  pathOptions={{ color: '#2563eb', weight: 1, fill: false, opacity: 0.5, dashArray: '4 4' }} 
                />
              ))}

              {/* Lidar Scan Points */}
              {scanPoints.map((pos, i) => (
                <CircleMarker 
                  key={`scan-${i}`} 
                  center={pos} 
                  radius={2} 
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }} 
                  stroke={false} 
                />
              ))}
            </LayerGroup>
          )}

          {navigationGoal && navigationGoal.latitude && navigationGoal.longitude && (
            <Marker position={[navigationGoal.latitude, navigationGoal.longitude]} icon={redIcon}>
              <Popup>
                <strong>Target Goal</strong><br />
                Lat: {navigationGoal.latitude.toFixed(6)}<br />
                Lng: {navigationGoal.longitude.toFixed(6)}
              </Popup>
            </Marker>
          )}

          {polylinePositions.length > 0 && (
            <Polyline
              positions={polylinePositions}
              pathOptions={{ color: '#eab308', weight: 4, dashArray: '8, 8' }}
            />
          )}

          {gpsHistory && gpsHistory.length > 0 && (
            <Polyline
              positions={gpsHistory}
              pathOptions={{ color: '#ec4899', weight: 3, opacity: 0.8 }}
            />
          )}

          <MapClickHandler onGoalSelected={onGoalSelected} disabled={goalSelectionDisabled} />
          <MapUpdater center={center} />
        </MapContainer>

        {!hasGps && (
          <div style={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.6)",
            color: "white",
            padding: "8px 16px",
            borderRadius: "20px",
            zIndex: 1000
          }}>
            Waiting for GPS Signal...
          </div>
        )}
      </div>
    </div>
  );
}
