import React from "react";
import CameraStream from "./CameraStream";
import GpsMap from "./GpsMap";
import MapCanvas from "./MapCanvas";
import NavigationPanel from "./NavigationPanel";
import RobotControl from "./RobotControl";

export default function Dashboard({
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
  setControlMode
}) {
  return (
    <>
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
          port={8080}
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
            onClearGoal={() => setNavigationGoal(null)}
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
