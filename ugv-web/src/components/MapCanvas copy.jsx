import {
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

export default function MapCanvas({ map, robotPose, laserScan }) {
    const canvasRef = useRef(null);

    const [zoom, setZoom] = useState(1);
    const [renderError, setRenderError] =
        useState("");

    const decodedData = useMemo(() => {
        if (!map) {
            return null;
        }

        try {
            return decodeMapData(map);
        } catch (error) {
            console.error(error);
            return null;
        }
    }, [map]);

    useEffect(() => {
        if (
            !map ||
            !decodedData ||
            !canvasRef.current
        ) {
            return;
        }

        const width = Number(map.width);
        const height = Number(map.height);

        if (
            decodedData.length !==
            width * height
        ) {
            setRenderError(
                `Map data ไม่ครบ: ` +
                `${decodedData.length}/` +
                `${width * height}`
            );
            return;
        }

        setRenderError("");

        const canvas = canvasRef.current;
        const context = canvas.getContext(
            "2d",
            {
                alpha: false,
            }
        );

        canvas.width = width;
        canvas.height = height;

        const imageData =
            context.createImageData(
                width,
                height
            );

        for (
            let mapY = 0;
            mapY < height;
            mapY += 1
        ) {
            for (
                let mapX = 0;
                mapX < width;
                mapX += 1
            ) {
                const mapIndex =
                    mapX + mapY * width;

                // พลิกแกน Y เพราะ Canvas เริ่มจากด้านบน
                const screenY =
                    height - 1 - mapY;

                const pixelIndex =
                    (
                        mapX +
                        screenY * width
                    ) * 4;

                const occupancy =
                    decodedData[mapIndex];

                const gray =
                    occupancyToGray(occupancy);

                imageData.data[pixelIndex] =
                    gray;

                imageData.data[
                    pixelIndex + 1
                ] = gray;

                imageData.data[
                    pixelIndex + 2
                ] = gray;

                imageData.data[
                    pixelIndex + 3
                ] = 255;
            }
        }

        context.putImageData(
            imageData,
            0,
            0
        );

        if (robotPose) {
            console.log("get Robot pose");
            drawRadiusGrid(
                context,
                map,
                robotPose,
                [1, 2, 3, 5, 10]
            )
        }
        if (robotPose && laserScan) {
            drawLaserScanOnMap(context, map, robotPose, laserScan);
        }

        if (robotPose) {
            drawRobotPose(context, map, robotPose);
        }
    }, [map, decodedData, robotPose, laserScan]);

    return (
        <section className="map-card">
            <div className="map-header">
                <div>
                    <h2>SLAM Map</h2>

                    <p>
                        {map
                            ? `${map.width} × ${map.height} cells`
                            : "กำลังรอ /map"}

                        {" · "}

                        {laserScan
                            ? `${laserScan.ranges.length} lidar points`
                            : "กำลังรอ /scan"}
                    </p>
                </div>

                <span
                    className={
                        map
                            ? "status-badge online"
                            : "status-badge offline"
                    }
                >
                    {map ? "LIVE" : "WAITING"}
                </span>
            </div>

            <div className="map-toolbar">
                <button
                    type="button"
                    onClick={() => {
                        setZoom((current) =>
                            Math.max(
                                0.25,
                                current / 1.25
                            )
                        );
                    }}
                >
                    −
                </button>

                <span>
                    {Math.round(zoom * 100)}%
                </span>

                <button
                    type="button"
                    onClick={() => {
                        setZoom((current) =>
                            Math.min(
                                8,
                                current * 1.25
                            )
                        );
                    }}
                >
                    +
                </button>

                <button
                    type="button"
                    onClick={() => setZoom(1)}
                >
                    Reset
                </button>
            </div>

            {renderError && (
                <p className="map-error">
                    {renderError}
                </p>
            )}

            <div className="map-viewport">
                <canvas
                    ref={canvasRef}
                    className="map-canvas"
                    style={{
                        //transform: `scale(${zoom})`,
                        width: `${zoom * 50}%`,
                        height: "auto",
                    }}
                />
            </div>

            {map && (
                <div className="map-details">
                    <span>
                        Frame: {map.frame_id || "--"}
                    </span>

                    <span>
                        กว้างจริง:{" "}
                        {(
                            map.width *
                            map.resolution
                        ).toFixed(1)}{" "}
                        m
                    </span>

                    <span>
                        สูงจริง:{" "}
                        {(
                            map.height *
                            map.resolution
                        ).toFixed(1)}{" "}
                        m
                    </span>

                    <span>
                        Origin:{" "}
                        {Number(
                            map.origin?.position?.x ?? 0
                        ).toFixed(2)}
                        ,{" "}
                        {Number(
                            map.origin?.position?.y ?? 0
                        ).toFixed(2)}
                    </span>
                </div>
            )}
            {robotPose && (
                <div className="robot-pose-details">
                    <strong>Robot pose</strong>

                    <span>
                        X:{" "}
                        {Number(
                            robotPose.position?.x ?? 0
                        ).toFixed(2)} m
                    </span>

                    <span>
                        Y:{" "}
                        {Number(
                            robotPose.position?.y ?? 0
                        ).toFixed(2)} m
                    </span>

                    <span>
                        Heading:{" "}
                        {Number(
                            robotPose.yaw_deg ?? 0
                        ).toFixed(1)}°
                    </span>
                </div>
            )}
        </section>
    );
}

function decodeMapData(map) {
    if (!Array.isArray(map.data)) {
        throw new Error(
            "Map data is not an array"
        );
    }

    if (map.encoding !== "rle") {
        return map.data.map(Number);
    }

    const expectedSize =
        Number(map.width) *
        Number(map.height);

    const decoded =
        new Int8Array(expectedSize);

    let offset = 0;

    for (const group of map.data) {
        if (
            !Array.isArray(group) ||
            group.length !== 2
        ) {
            continue;
        }

        const value = Number(group[0]);
        const count = Number(group[1]);

        if (
            !Number.isInteger(count) ||
            count <= 0
        ) {
            continue;
        }

        const end = Math.min(
            offset + count,
            expectedSize
        );

        decoded.fill(
            value,
            offset,
            end
        );

        offset = end;

        if (offset >= expectedSize) {
            break;
        }
    }

    if (offset !== expectedSize) {
        throw new Error(
            `Decoded ${offset} cells, ` +
            `expected ${expectedSize}`
        );
    }

    return decoded;
}

function occupancyToGray(value) {
    if (value < 0) {
        // unknown
        return 150;
    }

    if (value === 0) {
        // free
        return 255;
    }

    if (value >= 100) {
        // occupied
        return 0;
    }

    return Math.round(
        255 -
        (value / 100) * 255
    );
}



function drawRobotPose(
    context,
    map,
    robotPose,
) {
    const worldX = Number(
        robotPose.position?.x
    );

    const worldY = Number(
        robotPose.position?.y
    );

    const yaw = Number(
        robotPose.yaw ?? 0
    );

    if (
        !Number.isFinite(worldX) ||
        !Number.isFinite(worldY) ||
        !Number.isFinite(yaw)
    ) {
        return;
    }

    const point = worldToMapPixel(
        map,
        worldX,
        worldY,
    );

    context.save();

    context.translate(
        point.x,
        point.y,
    );

    // Canvas พลิกแกน Y เมื่อเทียบกับ ROS
    // Canvas มีแกน Y กลับด้านจาก ROS
    context.rotate(-yaw);

    context.fillStyle = "#2563eb";
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;

    context.beginPath();

    context.moveTo(10, 0);
    context.lineTo(-7, -6);
    context.lineTo(-7, 6);

    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = "#ef4444";

    context.beginPath();
    context.arc(
        0,
        0,
        2,
        0,
        Math.PI * 2
    );
    context.fill();

    context.restore();
}

function drawRadiusGrid(
    context,
    map,
    robotPose,
    radiusesMeters
) {
    const worldX = Number(
        robotPose.position?.x
    );

    const worldY = Number(
        robotPose.position?.y
    );

    const resolution = Number(
        map.resolution
    );

    if (
        !Number.isFinite(worldX) ||
        !Number.isFinite(worldY) ||
        !Number.isFinite(resolution) ||
        resolution <= 0
    ) {
        return;
    }

    const center = worldToMapPixel(
        map,
        worldX,
        worldY
    );

    context.save();

    context.strokeStyle =
        "rgba(37, 99, 235, 0.35)";

    context.fillStyle =
        "rgba(30, 64, 175, 0.75)";

    context.lineWidth = 0.7;
    context.font = "8px sans-serif";
    context.textAlign = "left";
    context.textBaseline = "bottom";

    radiusesMeters.forEach(
        (radiusMeters) => {
            const radiusPixels =
                radiusMeters / resolution;

            context.beginPath();

            context.arc(
                center.x,
                center.y,
                radiusPixels,
                0,
                Math.PI * 2
            );

            context.stroke();

            context.fillText(
                `${radiusMeters} m`,
                center.x + radiusPixels + 2,
                center.y - 2
            );
        }
    );

    // เส้นแนวแกนบาง ๆ ผ่านตำแหน่งรถ
    context.strokeStyle =
        "rgba(37, 99, 235, 0.22)";

    context.lineWidth = 0.5;

    context.beginPath();
    context.moveTo(0, center.y);
    context.lineTo(
        Number(map.width),
        center.y
    );
    context.stroke();

    context.beginPath();
    context.moveTo(center.x, 0);
    context.lineTo(
        center.x,
        Number(map.height)
    );
    context.stroke();

    context.restore();
}

function drawLaserScanOnMap(
    context,
    map,
    robotPose,
    scan
) {
    if (!Array.isArray(scan.ranges)) {
        return;
    }

    const robotX = Number(
        robotPose.position?.x
    );

    const robotY = Number(
        robotPose.position?.y
    );

    const robotYaw = Number(
        robotPose.yaw ?? 0
    );

    const angleMin = Number(
        scan.angle_min
    );

    const angleIncrement = Number(
        scan.angle_increment
    );

    const rangeMin = Number(
        scan.range_min ?? 0
    );

    const rangeMax = Number(
        scan.range_max ?? Infinity
    );

    if (
        !Number.isFinite(robotX) ||
        !Number.isFinite(robotY) ||
        !Number.isFinite(robotYaw) ||
        !Number.isFinite(angleMin) ||
        !Number.isFinite(angleIncrement)
    ) {
        return;
    }

    const cosYaw = Math.cos(robotYaw);
    const sinYaw = Math.sin(robotYaw);

    context.save();

    context.fillStyle =
        "rgba(22, 163, 74, 0.9)";

    scan.ranges.forEach(
        (rawRange, index) => {
            if (
                rawRange === null ||
                rawRange === undefined
            ) {
                return;
            }

            const range = Number(rawRange);

            if (
                !Number.isFinite(range) ||
                range < rangeMin ||
                range > rangeMax
            ) {
                return;
            }

            const scanAngle =
                angleMin +
                index * angleIncrement;

            // จุด Lidar ในพิกัดตัวรถ
            const localX =
                range * Math.cos(scanAngle);

            const localY =
                range * Math.sin(scanAngle);

            // หมุนจากพิกัดตัวรถไปพิกัด map
            const worldX =
                robotX +
                cosYaw * localX -
                sinYaw * localY;

            const worldY =
                robotY +
                sinYaw * localX +
                cosYaw * localY;

            const pixel = worldToMapPixel(
                map,
                worldX,
                worldY
            );

            if (
                pixel.x < 0 ||
                pixel.x >= Number(map.width) ||
                pixel.y < 0 ||
                pixel.y >= Number(map.height)
            ) {
                return;
            }

            context.fillRect(
                pixel.x - 0.8,
                pixel.y - 0.8,
                1.6,
                1.6
            );
        }
    );

    context.restore();
}

function worldToMapPixel(
    map,
    worldX,
    worldY
) {
    const resolution = Number(
        map.resolution
    );

    const originX = Number(
        map.origin?.position?.x ?? 0
    );

    const originY = Number(
        map.origin?.position?.y ?? 0
    );

    const mapX =
        (worldX - originX) /
        resolution;

    const mapY =
        (worldY - originY) /
        resolution;

    return {
        x: mapX,
        y:
            Number(map.height) -
            1 -
            mapY,
    };
}