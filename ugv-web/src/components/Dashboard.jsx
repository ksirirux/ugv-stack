import React from "react";
import CameraStream from "./CameraStream";
import GpsMap from "./GpsMap";
import MapCanvas from "./MapCanvas";
import NavigationPanel from "./NavigationPanel";
import RobotControl from "./RobotControl";

export default function Dashboard({
  nodeStatuses,
  battery,
  gps,
  robotPose,
  path,
  laserScan,
  navigationGoal,
  setNavigationGoal,
  navigationBusy,
  mapMode,
  setMapMode,
  occupancyGrid,
  navigation,
  serverConnected,
  robotConnected,
  startNavigation,
  cancelNavigation,
  emergencyStop,
  socketRef,
  ROBOT_ID,
  controlMode,
  setControlMode,
  onClearGoal,
  gpsHistory
}) {
  return (
    <>
      <section className="node-status-bar" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: '12px',
        marginBottom: '20px'
      }}>
        {Object.entries(nodeStatuses || {}).map(([nodeName, status]) => {
          let statusColor = '#64748b'; // gray (offline)
          let bgColor = '#ffffff';
          let borderStyle = '1px solid #e2e8f0';

          if (status === 'OK') {
            statusColor = '#10b981'; // green
            bgColor = '#f0fdf4';
            borderStyle = '1px solid #bbf7d0';
          } else if (status === 'Error') {
            statusColor = '#ef4444'; // red
            bgColor = '#fef2f2';
            borderStyle = '1px solid #fecaca';
          }

          return (
            <div key={nodeName} style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '12px 14px',
              borderRadius: '12px',
              background: bgColor,
              border: borderStyle,
              boxShadow: '0 2px 8px rgb(15 23 42 / 4%)',
              alignItems: 'center',
              justifyContent: 'center',
              textTransform: 'uppercase',
              transition: 'all 0.3s ease'
            }}>
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '700', marginBottom: '4px', letterSpacing: '0.05em' }}>
                {nodeName === 'esp32' ? 'ESP32 (MOTORS)' : nodeName}
              </span>
              <strong style={{ fontSize: '15px', color: statusColor, fontWeight: '800' }}>
                {status}
              </strong>
            </div>
          );
        })}
      </section>

      <section className="telemetry-grid">
        <TelemetryCard
          title="Battery"
          value={
            battery === null || battery === undefined
              ? "--"
              : `${Number(battery).toFixed(2)} V`
          }
        />

        <TelemetryCard
          title="Latitude"
          value={
            gps?.latitude === null || gps?.latitude === undefined
              ? "--"
              : Number(gps.latitude).toFixed(7)
          }
        />

        <TelemetryCard
          title="Longitude"
          value={
            gps?.longitude === null || gps?.longitude === undefined
              ? "--"
              : Number(gps.longitude).toFixed(7)
          }
        />

        <TelemetryCard
          title="GPS Status"
          value={
            gps?.status === null || gps?.status === undefined
              ? "--"
              : String(gps.status)
          }
        />
      </section>

      <section className="camera-grid">
        <CameraStream
          label="Color Camera"
          topic="/camera/camera/color/image_raw"
          ip="192.168.1.184"
          port={8081}
        />
        <CameraStream
          label="Depth Camera"
          topic="/camera/camera/depth/image_rect_raw"
          ip="192.168.1.129"
          port={8081}
        />
      </section>

      <section className="main-control-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setMapMode('outdoor')}
              style={{
                padding: '8px 16px', borderRadius: '4px',
                background: mapMode === 'outdoor' ? '#2563eb' : '#374151',
                color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold'
              }}
            >
              🌍 Outdoor (Google Map)
            </button>
            <button
              onClick={() => setMapMode('indoor')}
              style={{
                padding: '8px 16px', borderRadius: '4px',
                background: mapMode === 'indoor' ? '#2563eb' : '#374151',
                color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold'
              }}
            >
              🏢 Indoor (SLAM Map)
            </button>
          </div>

          {mapMode === 'outdoor' ? (
            <GpsMap
              gps={gps}
              robotPose={robotPose}
              path={path}
              laserScan={laserScan}
              navigationGoal={navigationGoal}
              onGoalSelected={setNavigationGoal}
              goalSelectionDisabled={navigationBusy}
              gpsHistory={gpsHistory}
            />
          ) : (
            <div className="map-card" style={{ minHeight: '650px', background: '#1f2937', padding: '10px', borderRadius: '8px' }}>
              <div className="map-header" style={{ marginBottom: '10px' }}>
                <h2>Indoor SLAM Map</h2>
              </div>
              <MapCanvas
                map={occupancyGrid}
                robotPose={robotPose}
                laserScan={laserScan}
                navigationGoal={navigationGoal}
                path={path}
                onGoalSelected={setNavigationGoal}
                goalSelectionDisabled={navigationBusy}
              />
            </div>
          )}
        </div>

        <div>
          <NavigationPanel
            goal={navigationGoal}
            navigation={navigation}
            serverConnected={serverConnected}
            robotConnected={robotConnected}
            navigationBusy={navigationBusy}
            onStart={startNavigation}
            onCancel={cancelNavigation}
            onEmergencyStop={emergencyStop}
            onClearGoal={onClearGoal}
          />

          <RobotControl
            socketRef={socketRef}
            robotId={ROBOT_ID}
            enabled={
              serverConnected &&
              robotConnected &&
              !navigationBusy
            }
            controlMode={controlMode}
            setControlMode={setControlMode}
          />
        </div>
      </section>
    </>
  );
}

function TelemetryCard({ title, value }) {
  return (
    <article className="telemetry-card">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}
