import { useEffect, useRef } from "react";

export default function LidarCanvas({ scan }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas || !scan || !Array.isArray(scan.ranges)) {
            return;
        }

        const ctx = canvas.getContext("2d");
        const width = canvas.width;
        const height = canvas.height;

        const centerX = width / 2;
        const centerY = height / 2;

        const maximumRange = Math.max(
            1,
            Math.min(Number(scan.range_max ?? 20), 20)
        );

        const scale =
            Math.min(width, height) /
            2 /
            maximumRange;

        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, width, height);

        drawGrid(
            ctx,
            centerX,
            centerY,
            maximumRange,
            scale
        );

        drawRobot(
            ctx,
            centerX,
            centerY
        );

        drawScan(
            ctx,
            scan,
            centerX,
            centerY,
            scale
        );
    }, [scan]);

    return (
        <section className="lidar-card">
            <div className="lidar-header">
                <div>
                    <h2>Lidar Scan</h2>

                    <p>
                        {scan
                            ? `${scan.ranges.length} points · ${scan.frame_id || "--"}`
                            : "กำลังรอข้อมูล /scan"}
                    </p>
                </div>

                <span
                    className={
                        scan
                            ? "status-badge online"
                            : "status-badge offline"
                    }
                >
                    {scan ? "LIVE" : "WAITING"}
                </span>
            </div>

            <canvas
                ref={canvasRef}
                width={700}
                height={700}
                className="lidar-canvas"
            />
        </section>
    );
}

function drawGrid(
    ctx,
    centerX,
    centerY,
    maximumRange,
    scale
) {
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;

    for (
        let meter = 1;
        meter <= maximumRange;
        meter += 1
    ) {
        ctx.beginPath();
        ctx.arc(
            centerX,
            centerY,
            meter * scale,
            0,
            Math.PI * 2
        );
        ctx.stroke();
    }

    ctx.strokeStyle = "#475569";

    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, centerY * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(centerX * 2, centerY);
    ctx.stroke();
}

function drawRobot(
    ctx,
    centerX,
    centerY
) {
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath();
    ctx.arc(
        centerX,
        centerY,
        7,
        0,
        Math.PI * 2
    );
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX, centerY - 40);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("หน้า", centerX, 24);
}

function drawScan(
    ctx,
    scan,
    centerX,
    centerY,
    scale
) {
    const angleMin = Number(scan.angle_min);
    const angleIncrement = Number(
        scan.angle_increment
    );

    ctx.fillStyle = "#22c55e";

    scan.ranges.forEach((range, index) => {
        if (
            range === null ||
            range === undefined
        ) {
            return;
        }

        const numericRange = Number(range);

        if (!Number.isFinite(numericRange)) {
            return;
        }

        const angle =
            angleMin +
            index * angleIncrement;

        const rosX =
            numericRange * Math.cos(angle);

        const rosY =
            numericRange * Math.sin(angle);

        const screenX =
            centerX - rosY * scale;

        const screenY =
            centerY - rosX * scale;

        ctx.fillRect(
            screenX - 1.5,
            screenY - 1.5,
            3,
            3
        );
    });
}