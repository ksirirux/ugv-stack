import { useCallback, useEffect, useRef, useState } from "react";

export default function RobotControl({
    socketRef,
    robotId,
    enabled,
    controlMode,
}) {
    const commandTimerRef = useRef(null);
    const commandActiveRef = useRef(false);

    const [linearSpeed, setLinearSpeed] = useState(0.25);
    const [angularSpeed, setAngularSpeed] = useState(0.5);
    const [activeCommand, setActiveCommand] = useState("STOP");

    const manualEnabled = enabled && controlMode === "manual"

    const sendCommand = useCallback(
        (linearX, angularZ) => {

            if (controlMode !== "manual") {
                console.log("[MANUAL] cmd_vel is blocked in AUTO mode")
                return false;
            }

            const socket = socketRef.current;

            if (
                !socket ||
                socket.readyState !== WebSocket.OPEN
            ) {
                return false;
            }

            socket.send(
                JSON.stringify({
                    type: "cmd_vel",
                    robot_id: robotId,
                    linear_x: Number(linearX),
                    angular_z: Number(angularZ),
                    timestamp: Date.now(),
                })
            );

            return true;
        },
        [robotId, socketRef, controlMode]
    );

    const clearCommandTimer = useCallback(() => {
        if (commandTimerRef.current !== null) {
            window.clearInterval(commandTimerRef.current);
            commandTimerRef.current = null;
        }
    }, []);

    const stopRobot = useCallback(
        (force = false) => {
            clearCommandTimer();
            const wasMoving = commandActiveRef.current;
            commandActiveRef.current = false;
            setActiveCommand("STOP");
            if (controlMode === "manual" && (wasMoving || force)) {
                sendCommand(0, 0);
            }


        }, [clearCommandTimer, sendCommand, controlMode]);

    const startCommand = useCallback(
        (name, linearX, angularZ) => {
            if (!enabled) {
                stopRobot();
                return;
            }

            clearCommandTimer();
            commandActiveRef.current = true;

            setActiveCommand(name);
            sendCommand(linearX, angularZ);

            // ส่งซ้ำ 10 Hz ขณะผู้ใช้กดปุ่ม
            commandTimerRef.current = window.setInterval(() => {
                sendCommand(linearX, angularZ);
            }, 100);
        },
        [
            clearCommandTimer,
            manualEnabled,
            sendCommand,

        ]
    );

    useEffect(() => {
        function handleWindowBlur() {
            if (manualEnabled) {
                stopRobot();
            }

        }

        function handleVisibilityChange() {
            if (document.hidden && manualEnabled) {
                stopRobot();
            }
        }

        function handleKeyDown(event) {
            if (event.repeat || !manualEnabled) {
                return;
            }

            switch (event.key.toLowerCase()) {
                case "w":
                case "arrowup":
                    event.preventDefault();
                    startCommand(
                        "FORWARD",
                        linearSpeed,
                        0
                    );
                    break;

                case "s":
                case "arrowdown":
                    event.preventDefault();
                    startCommand(
                        "REVERSE",
                        -linearSpeed,
                        0
                    );
                    break;

                case "a":
                case "arrowleft":
                    event.preventDefault();
                    startCommand(
                        "LEFT",
                        0,
                        angularSpeed
                    );
                    break;

                case "d":
                case "arrowright":
                    event.preventDefault();
                    startCommand(
                        "RIGHT",
                        0,
                        -angularSpeed
                    );
                    break;

                case " ":
                    event.preventDefault();
                    stopRobot();
                    break;

                default:
                    break;
            }
        }

        function handleKeyUp(event) {
            if (!manualEnabled) {
                return;
            }
            const controlKeys = [
                "w",
                "a",
                "s",
                "d",
                "arrowup",
                "arrowdown",
                "arrowleft",
                "arrowright",
            ];

            if (
                controlKeys.includes(
                    event.key.toLowerCase()
                )
            ) {
                event.preventDefault();
                stopRobot();
            }
        }

        window.addEventListener(
            "blur",
            handleWindowBlur
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        window.addEventListener(
            "keydown",
            handleKeyDown
        );

        window.addEventListener(
            "keyup",
            handleKeyUp
        );

        return () => {
            //stopRobot();
            clearCommandTimer();

            window.removeEventListener(
                "blur",
                handleWindowBlur
            );

            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            );

            window.removeEventListener(
                "keydown",
                handleKeyDown
            );

            window.removeEventListener(
                "keyup",
                handleKeyUp
            );
        };
    }, [
        angularSpeed,
        enabled,
        linearSpeed,
        startCommand,
        stopRobot,
    ]);

    useEffect(() => {
        if (!manualEnabled) {
            clearCommandTimer();
            commandActiveRef.current = false;
            setActiveCommand("STOP");

            // ห้ามส่ง 0,0 ตอนเปลี่ยนเข้า AUTO
        }
    }, [
        manualEnabled,
        clearCommandTimer,
    ]);

    return (
        <section className="control-card">
            <div className="control-header">
                <div>
                    <h2>Manual Control</h2>

                    <p>
                        ใช้ปุ่มบนหน้าจอ หรือ W A S D /
                        Arrow keys
                    </p>
                </div>

                <span
                    className={
                        enabled
                            ? "status-badge online"
                            : "status-badge offline"
                    }
                >
                    {enabled ? "READY" : "DISABLED"}
                </span>
            </div>

            <div className="speed-settings">
                <label>
                    <span>
                        ความเร็วเดินหน้า{" "}
                        {linearSpeed.toFixed(2)} m/s
                    </span>

                    <input
                        type="range"
                        min="0.05"
                        max="0.80"
                        step="0.05"
                        value={linearSpeed}
                        disabled={!manualEnabled}
                        onChange={(event) => {
                            stopRobot();

                            setLinearSpeed(
                                Number(event.target.value)
                            );
                        }}
                    />
                </label>

                <label>
                    <span>
                        ความเร็วเลี้ยว{" "}
                        {angularSpeed.toFixed(2)} rad/s
                    </span>

                    <input
                        type="range"
                        min="0.10"
                        max="1.50"
                        step="0.10"
                        value={angularSpeed}
                        disabled={!manualEnabled}
                        onChange={(event) => {
                            stopRobot();

                            setAngularSpeed(
                                Number(event.target.value)
                            );
                        }}
                    />
                </label>
            </div>

            <div className="command-status">
                คำสั่งปัจจุบัน:
                <strong>{activeCommand}</strong>
            </div>

            <div className="robot-control-pad">
                <div />

                <HoldButton
                    label="เดินหน้า"
                    icon="▲"
                    disabled={!manualEnabled}
                    onStart={() =>
                        startCommand(
                            "FORWARD",
                            linearSpeed,
                            0
                        )
                    }
                    onStop={stopRobot}
                />

                <div />

                <HoldButton
                    label="ซ้าย"
                    icon="◀"
                    disabled={!manualEnabled}
                    onStart={() =>
                        startCommand(
                            "LEFT",
                            0,
                            angularSpeed
                        )
                    }
                    onStop={stopRobot}
                />

                <button
                    type="button"
                    className="emergency-stop-button"
                    onClick={stopRobot}
                >
                    <strong>STOP</strong>
                    <span>หยุดทันที</span>
                </button>

                <HoldButton
                    label="ขวา"
                    icon="▶"
                    disabled={!manualEnabled}
                    onStart={() =>
                        startCommand(
                            "RIGHT",
                            0,
                            -angularSpeed
                        )
                    }
                    onStop={stopRobot}
                />

                <div />

                <HoldButton
                    label="ถอยหลัง"
                    icon="▼"
                    disabled={!manualEnabled}
                    onStart={() =>
                        startCommand(
                            "REVERSE",
                            -linearSpeed,
                            0
                        )
                    }
                    onStop={stopRobot}
                />

                <div />
            </div>

            <p className="control-safety-note">
                ปล่อยปุ่มหรือเปลี่ยนหน้าเว็บ ระบบจะส่งคำสั่งหยุดทันที
            </p>
        </section>
    );


    function HoldButton({
        label,
        icon,
        disabled,
        onStart,
        onStop,
    }) {
        return (
            <button
                type="button"
                className="control-button"
                disabled={!manualEnabled}
                onPointerDown={(event) => {
                    event.preventDefault();

                    event.currentTarget.setPointerCapture?.(
                        event.pointerId
                    );

                    onStart();
                }}
                onPointerUp={(event) => {
                    event.preventDefault();
                    onStop();
                }}
                onPointerCancel={onStop}
                onPointerLeave={(event) => {
                    if (event.buttons !== 0) {
                        onStop();
                    }
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                }}
            >
                <strong>{icon}</strong>
                <span>{label}</span>
            </button>
        );
    }
}