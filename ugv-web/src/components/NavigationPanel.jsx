export default function NavigationPanel({
    goal,
    navigation,
    serverConnected,
    robotConnected,
    onStart,
    onCancel,
    navigationBusy,
    onEmergencyStop,
    onClearGoal,
    disabled,
}) {
    const canStart =
        Boolean(goal) &&
        serverConnected &&
        robotConnected &&
        !navigationBusy;

    return (
        <section className="navigation-panel">
            <div className="map-header">
                <div>
                    <h2>Navigation</h2>
                    <p>
                        Status: <strong>{navigation.status}</strong>
                    </p>
                </div>

                <span
                    className={
                        navigationBusy
                            ? "status-badge online"
                            : "status-badge offline"
                    }
                >
                    {navigationBusy ? "AUTO" : "IDLE"}
                </span>
            </div>

            <div className="robot-pose-details">
                <strong>Selected goal</strong>
                <span>X: {goal ? Number(goal.x).toFixed(2) : "--"} m</span>
                <span>Y: {goal ? Number(goal.y).toFixed(2) : "--"} m</span>
                <span>
                    Yaw: {goal ? Number(goal.yaw ?? 0).toFixed(2) : "--"} rad
                </span>
            </div>

            <div className="robot-pose-details">
                <strong>Navigation feedback</strong>
                <span>
                    Remaining: {formatNumber(navigation.distanceRemaining, 2)} m
                </span>
                <span>
                    ETA: {formatNumber(navigation.estimatedTimeRemainingSec, 1)} s
                </span>
                <span>
                    Elapsed: {formatNumber(navigation.navigationTimeSec, 1)} s
                </span>
                <span>
                    Recoveries: {navigation.recoveries ?? "--"}
                </span>
            </div>

            {navigation.message && (
                <p className="map-error">{navigation.message}</p>
            )}

            <div className="map-toolbar">
                <button type="button" disabled={!canStart} onClick={onStart}>
                    Start navigation
                </button>

                <button
                    type="button"
                    disabled={!navigationBusy}
                    onClick={onCancel}
                >
                    Cancel
                </button>

                <button
                    type="button"
                    disabled={navigationBusy}
                    onClick={onClearGoal}
                >
                    Clear goal
                </button>

                <button
                    type="button"
                    className="emergency-button"
                    disabled={!serverConnected}
                    onClick={onEmergencyStop}
                >
                    EMERGENCY STOP
                </button>
            </div>
        </section>
    );
}

function formatNumber(value, digits) {
    if (value === null || value === undefined) {
        return "--";
    }

    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : "--";
}