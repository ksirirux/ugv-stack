from __future__ import annotations

import io
import math
import os
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field, field_validator


TILE_SIZE = 256
EARTH_RADIUS_M = 6_378_137.0
MAX_TILE_COUNT = int(os.getenv("MAX_TILE_COUNT", "64"))
REQUEST_TIMEOUT_SEC = float(os.getenv("TILE_REQUEST_TIMEOUT_SEC", "12"))
TILE_URL_TEMPLATE = os.getenv(
    "MAP_TILE_URL",
    "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
)
TILE_USER_AGENT = os.getenv(
    "MAP_TILE_USER_AGENT",
    "UGV-FieldPlanner/1.0",
)


class Bounds(BaseModel):
    north: float
    south: float
    east: float
    west: float

    @field_validator("north", "south")
    @classmethod
    def validate_latitude(cls, value: float) -> float:
        if not -85.05112878 <= value <= 85.05112878:
            raise ValueError("latitude is outside Web Mercator limits")
        return value

    @field_validator("east", "west")
    @classmethod
    def validate_longitude(cls, value: float) -> float:
        if not -180 <= value <= 180:
            raise ValueError("longitude must be between -180 and 180")
        return value


class AnalyzeFieldRequest(BaseModel):
    boundary: List[Tuple[float, float]] = Field(min_length=3)
    obstacles: List[List[Tuple[float, float]]] = Field(default_factory=list)
    bounds: Bounds
    zoom: int = Field(default=19, ge=1, le=22)

    @field_validator("boundary")
    @classmethod
    def validate_boundary(cls, vertices: List[Tuple[float, float]]):
        if len(vertices) < 3:
            raise ValueError("boundary requires at least three points")
        return vertices


@dataclass(frozen=True)
class TileLayout:
    zoom: int
    x_min: int
    x_max: int
    y_min: int
    y_max: int

    @property
    def width(self) -> int:
        return (self.x_max - self.x_min + 1) * TILE_SIZE

    @property
    def height(self) -> int:
        return (self.y_max - self.y_min + 1) * TILE_SIZE

    @property
    def count(self) -> int:
        return (self.x_max - self.x_min + 1) * (self.y_max - self.y_min + 1)


app = FastAPI(title="UGV Field Vision API", version="1.0.0")

allowed_origins = [
    item.strip()
    for item in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if item.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})


@app.exception_handler(Exception)
async def unhandled_exception_handler(_, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": f"vision backend error: {exc}"},
    )


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def latlng_to_world_pixel(lat: float, lng: float, zoom: int) -> Tuple[float, float]:
    """Convert WGS84 latitude/longitude to XYZ global pixel coordinates."""
    lat = clamp(lat, -85.05112878, 85.05112878)
    scale = TILE_SIZE * (2 ** zoom)
    x = (lng + 180.0) / 360.0 * scale

    sin_lat = math.sin(math.radians(lat))
    y = (
        0.5
        - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)
    ) * scale
    return x, y


def world_pixel_to_latlng(x: float, y: float, zoom: int) -> Tuple[float, float]:
    scale = TILE_SIZE * (2 ** zoom)
    lng = x / scale * 360.0 - 180.0
    mercator_y = math.pi * (1.0 - 2.0 * y / scale)
    lat = math.degrees(math.atan(math.sinh(mercator_y)))
    return lat, lng


def choose_tile_layout(bounds: Bounds, requested_zoom: int) -> TileLayout:
    """Reduce zoom automatically when the selected polygon would require too many tiles."""
    for zoom in range(requested_zoom, 13, -1):
        west_x, north_y = latlng_to_world_pixel(bounds.north, bounds.west, zoom)
        east_x, south_y = latlng_to_world_pixel(bounds.south, bounds.east, zoom)

        x_min = int(math.floor(min(west_x, east_x) / TILE_SIZE))
        x_max = int(math.floor(max(west_x, east_x) / TILE_SIZE))
        y_min = int(math.floor(min(north_y, south_y) / TILE_SIZE))
        y_max = int(math.floor(max(north_y, south_y) / TILE_SIZE))

        layout = TileLayout(zoom, x_min, x_max, y_min, y_max)
        if layout.count <= MAX_TILE_COUNT:
            return layout

    raise HTTPException(
        status_code=413,
        detail=f"selected field is too large; more than {MAX_TILE_COUNT} map tiles are required",
    )


def fetch_tile(x: int, y: int, zoom: int) -> Image.Image:
    url = TILE_URL_TEMPLATE.format(x=x, y=y, z=zoom)
    response = requests.get(
        url,
        timeout=REQUEST_TIMEOUT_SEC,
        headers={"User-Agent": TILE_USER_AGENT},
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"map tile provider returned HTTP {response.status_code}",
        )

    try:
        return Image.open(io.BytesIO(response.content)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"invalid map tile image: {exc}") from exc


def build_tile_mosaic(layout: TileLayout) -> np.ndarray:
    canvas = Image.new("RGB", (layout.width, layout.height))
    for tile_y in range(layout.y_min, layout.y_max + 1):
        for tile_x in range(layout.x_min, layout.x_max + 1):
            tile = fetch_tile(tile_x, tile_y, layout.zoom)
            px = (tile_x - layout.x_min) * TILE_SIZE
            py = (tile_y - layout.y_min) * TILE_SIZE
            canvas.paste(tile, (px, py))
    return cv2.cvtColor(np.asarray(canvas), cv2.COLOR_RGB2BGR)


def latlng_to_local_pixel(
    lat: float,
    lng: float,
    layout: TileLayout,
) -> Tuple[int, int]:
    world_x, world_y = latlng_to_world_pixel(lat, lng, layout.zoom)
    local_x = int(round(world_x - layout.x_min * TILE_SIZE))
    local_y = int(round(world_y - layout.y_min * TILE_SIZE))
    return local_x, local_y


def local_pixel_to_latlng(
    x: float,
    y: float,
    layout: TileLayout,
) -> Tuple[float, float]:
    world_x = x + layout.x_min * TILE_SIZE
    world_y = y + layout.y_min * TILE_SIZE
    return world_pixel_to_latlng(world_x, world_y, layout.zoom)


def polygon_to_cv(vertices: Sequence[Tuple[float, float]], layout: TileLayout) -> np.ndarray:
    points = [latlng_to_local_pixel(lat, lng, layout) for lat, lng in vertices]
    return np.asarray(points, dtype=np.int32).reshape((-1, 1, 2))


def build_analysis_mask(
    shape: Tuple[int, int],
    boundary: Sequence[Tuple[float, float]],
    obstacles: Sequence[Sequence[Tuple[float, float]]],
    layout: TileLayout,
) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillPoly(mask, [polygon_to_cv(boundary, layout)], 255)

    for obstacle in obstacles:
        if len(obstacle) >= 3:
            cv2.fillPoly(mask, [polygon_to_cv(obstacle, layout)], 0)

    # Remove a narrow border so the polygon outline does not dominate line detection.
    kernel = np.ones((5, 5), dtype=np.uint8)
    return cv2.erode(mask, kernel, iterations=1)


def normalize_angle_180(angle_deg: float) -> float:
    return angle_deg % 180.0


def circular_angle_distance_180(a: float, b: float) -> float:
    diff = abs((a - b) % 180.0)
    return min(diff, 180.0 - diff)


def detect_dominant_rows(
    image_bgr: np.ndarray,
    mask: np.ndarray,
) -> Tuple[float, float, List[Tuple[int, int, int, int, float]]]:
    """
    Return:
      dominant geographic angle in degrees (east=0, north=90),
      confidence in [0,1],
      accepted Hough segments with weights.
    """
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    masked_gray = cv2.bitwise_and(gray, gray, mask=mask)
    edges = cv2.Canny(masked_gray, 45, 135)
    edges = cv2.bitwise_and(edges, edges, mask=mask)

    min_dimension = min(image_bgr.shape[:2])
    min_line_length = max(18, int(min_dimension * 0.025))
    max_line_gap = max(8, int(min_dimension * 0.012))

    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 360.0,
        threshold=max(20, int(min_dimension * 0.018)),
        minLineLength=min_line_length,
        maxLineGap=max_line_gap,
    )

    if lines is None or len(lines) < 3:
        raise HTTPException(
            status_code=422,
            detail="ไม่พบแนวแถวที่ชัดเจนในพื้นที่ที่เลือก",
        )

    samples: List[Tuple[float, float, Tuple[int, int, int, int]]] = []
    for item in lines[:, 0]:
        x1, y1, x2, y2 = map(int, item)
        dx = x2 - x1
        dy_pixel = y2 - y1
        length = math.hypot(dx, dy_pixel)
        if length < min_line_length:
            continue

        # Pixel Y grows downward. Geographic north therefore uses -dy_pixel.
        geographic_angle = normalize_angle_180(
            math.degrees(math.atan2(-dy_pixel, dx))
        )
        weight = length * length
        samples.append((geographic_angle, weight, (x1, y1, x2, y2)))

    if len(samples) < 3:
        raise HTTPException(status_code=422, detail="ข้อมูลเส้นไม่เพียงพอสำหรับวิเคราะห์")

    bin_size = 2.0
    bin_count = int(180 / bin_size)
    histogram = np.zeros(bin_count, dtype=np.float64)

    for angle, weight, _ in samples:
        histogram[int(angle // bin_size) % bin_count] += weight

    # Circular smoothing avoids a false split around 0°/180°.
    padded = np.concatenate([histogram[-3:], histogram, histogram[:3]])
    kernel = np.asarray([1, 2, 3, 4, 3, 2, 1], dtype=np.float64)
    smoothed = np.convolve(padded, kernel / kernel.sum(), mode="same")[3:-3]

    peak_index = int(np.argmax(smoothed))
    coarse_angle = (peak_index + 0.5) * bin_size

    accepted = [
        (angle, weight, segment)
        for angle, weight, segment in samples
        if circular_angle_distance_180(angle, coarse_angle) <= 10.0
    ]

    if not accepted:
        raise HTTPException(status_code=422, detail="ไม่สามารถรวมกลุ่มแนวแถวได้")

    # Axial circular mean: line direction repeats every 180°, hence double angles.
    sum_cos = sum(weight * math.cos(math.radians(2 * angle)) for angle, weight, _ in accepted)
    sum_sin = sum(weight * math.sin(math.radians(2 * angle)) for angle, weight, _ in accepted)
    dominant = normalize_angle_180(
        0.5 * math.degrees(math.atan2(sum_sin, sum_cos))
    )

    total_weight = sum(weight for _, weight, _ in samples)
    accepted_weight = sum(weight for _, weight, _ in accepted)
    concentration = math.hypot(sum_cos, sum_sin) / max(accepted_weight, 1e-9)
    support = accepted_weight / max(total_weight, 1e-9)
    confidence = clamp(0.65 * concentration + 0.35 * support, 0.0, 1.0)

    accepted_segments = [
        (*segment, weight)
        for _, weight, segment in sorted(accepted, key=lambda item: item[1], reverse=True)
    ]
    return dominant, confidence, accepted_segments


def meters_per_pixel(latitude: float, zoom: int) -> float:
    return (
        math.cos(math.radians(latitude))
        * 2.0
        * math.pi
        * EARTH_RADIUS_M
        / (TILE_SIZE * (2 ** zoom))
    )


def estimate_row_spacing(
    image_bgr: np.ndarray,
    mask: np.ndarray,
    dominant_geo_angle: float,
    center_latitude: float,
    zoom: int,
) -> Optional[float]:
    """
    Estimate repeated row spacing using the autocorrelation of an image projection
    perpendicular to the detected row direction.
    """
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    h, w = gray.shape
    center = (w / 2.0, h / 2.0)

    # Rotating by the geographic angle makes the detected rows approximately horizontal.
    matrix = cv2.getRotationMatrix2D(center, dominant_geo_angle, 1.0)
    rotated_gray = cv2.warpAffine(
        gray,
        matrix,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    rotated_mask = cv2.warpAffine(
        mask,
        matrix,
        (w, h),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )

    valid_counts = np.count_nonzero(rotated_mask, axis=1).astype(np.float64)
    intensity_sums = np.sum(
        np.where(rotated_mask > 0, rotated_gray.astype(np.float64), 0.0),
        axis=1,
    )
    profile = np.divide(
        intensity_sums,
        valid_counts,
        out=np.zeros_like(intensity_sums),
        where=valid_counts > max(8, 0.02 * w),
    )

    valid_rows = valid_counts > max(8, 0.02 * w)
    if np.count_nonzero(valid_rows) < 30:
        return None

    indices = np.flatnonzero(valid_rows)
    start, stop = indices[0], indices[-1] + 1
    profile = profile[start:stop]
    profile = profile - cv2.GaussianBlur(profile.reshape(-1, 1), (1, 0), 9).ravel()

    std = float(np.std(profile))
    if std < 1e-6:
        return None
    profile /= std

    autocorr = np.correlate(profile, profile, mode="full")[len(profile) - 1 :]
    if autocorr[0] <= 0:
        return None
    autocorr /= autocorr[0]

    mpp = meters_per_pixel(center_latitude, zoom)
    min_spacing_m = float(os.getenv("MIN_ROW_SPACING_M", "0.8"))
    max_spacing_m = float(os.getenv("MAX_ROW_SPACING_M", "12.0"))
    min_lag = max(2, int(round(min_spacing_m / mpp)))
    max_lag = min(len(autocorr) - 2, int(round(max_spacing_m / mpp)))

    if max_lag <= min_lag:
        return None

    search = autocorr[min_lag : max_lag + 1]
    peaks = []
    for idx in range(1, len(search) - 1):
        if search[idx] > search[idx - 1] and search[idx] >= search[idx + 1]:
            peaks.append((float(search[idx]), idx + min_lag))

    if not peaks:
        return None

    peak_value, lag = max(peaks, key=lambda item: item[0])
    if peak_value < 0.12:
        return None

    spacing = lag * mpp
    if not min_spacing_m <= spacing <= max_spacing_m:
        return None
    return float(spacing)



def angle_difference_180(a: float, b: float) -> float:
    diff = abs((a - b) % 180.0)
    return min(diff, 180.0 - diff)


def otsu_threshold_1d(values: np.ndarray) -> int:
    if values.size == 0:
        return 127
    hist, _ = np.histogram(values, bins=256, range=(0, 256))
    hist = hist.astype(float)
    
    total = hist.sum()
    sum_all = np.dot(np.arange(256), hist)
    
    sum_b = 0.0
    w_b = 0.0
    
    max_var = 0.0
    threshold = 127
    
    for i in range(256):
        w_b += hist[i]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
            
        sum_b += i * hist[i]
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        
        var_between = w_b * w_f * (m_b - m_f) ** 2
        if var_between > max_var:
            max_var = var_between
            threshold = i
            
    return threshold


def detect_tree_centers(
    image_bgr: np.ndarray,
    mask: np.ndarray,
    layout: TileLayout,
    center_latitude: float,
) -> List[dict]:
    """
    Detect individual tree crowns using vegetation contrast plus distance-transform peaks.

    This is intended for orchard/plantation imagery where crowns appear as repeated,
    separated blobs. The result remains a planning suggestion and must be reviewed.
    """
    b, g, r = cv2.split(image_bgr.astype(np.float32))
    excess_green = 2.0 * g - r - b

    valid_values = excess_green[mask > 0]
    if valid_values.size < 100:
        return []

    # Normalize only from pixels inside the selected field.
    low = float(np.percentile(valid_values, 20))
    high = float(np.percentile(valid_values, 95))
    scale = max(high - low, 1.0)
    exg_u8 = np.clip((excess_green - low) * 255.0 / scale, 0, 255).astype(np.uint8)

    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]

    # Calculate Otsu threshold only on pixels inside the mask to prevent background bias.
    valid_exg = exg_u8[mask > 0]
    exg_thresh = otsu_threshold_1d(valid_exg)
    exg_binary = np.where((exg_u8 >= exg_thresh) & (mask > 0), 255, 0).astype(np.uint8)

    valid_sat = saturation[mask > 0]
    sat_thresh = otsu_threshold_1d(valid_sat)
    sat_binary = np.where((saturation >= sat_thresh) & (mask > 0), 255, 0).astype(np.uint8)

    vegetation = cv2.bitwise_and(exg_binary, sat_binary)
    vegetation = cv2.bitwise_and(vegetation, mask)

    # Remove tiny texture and join pixels within one crown.
    vegetation = cv2.morphologyEx(
        vegetation,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
        iterations=1,
    )
    # Reduced CLOSE size to keep distinct trees from merging into long solid stripes
    vegetation = cv2.morphologyEx(
        vegetation,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
        iterations=1,
    )

    distance = cv2.distanceTransform(vegetation, cv2.DIST_L2, 5)
    positive = distance[distance > 0]
    if positive.size == 0:
        return []

    mpp = meters_per_pixel(center_latitude, layout.zoom)
    min_crown_radius_m = float(os.getenv("MIN_TREE_CROWN_RADIUS_M", "0.7"))
    max_crown_radius_m = float(os.getenv("MAX_TREE_CROWN_RADIUS_M", "6.0"))
    min_peak_px = max(1.5, min_crown_radius_m / max(mpp, 1e-6))

    # Local maxima in the distance transform are approximate crown centers.
    local_max = distance >= cv2.dilate(
        distance,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)),
    ) - 1e-5
    peak_mask = np.where(
        local_max & (distance >= min_peak_px) & (mask > 0),
        255,
        0,
    ).astype(np.uint8)

    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        peak_mask,
        connectivity=8,
    )

    candidates = []
    max_radius_px = max_crown_radius_m / max(mpp, 1e-6)
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area <= 0:
            continue

        component = labels == label
        ys, xs = np.nonzero(component)
        if xs.size == 0:
            continue

        values = distance[ys, xs]
        best = int(np.argmax(values))
        x = float(xs[best])
        y = float(ys[best])
        radius_px = float(values[best])

        if radius_px < min_peak_px or radius_px > max_radius_px:
            continue

        candidates.append(
            {
                "x": x,
                "y": y,
                "radiusPx": radius_px,
                "score": radius_px,
            }
        )

    # Non-maximum suppression prevents multiple centers inside one broad crown.
    candidates.sort(key=lambda item: item["score"], reverse=True)
    accepted = []
    minimum_center_gap_m = float(os.getenv("MIN_TREE_CENTER_GAP_M", "2.0"))
    minimum_center_gap_px = minimum_center_gap_m / max(mpp, 1e-6)

    for candidate in candidates:
        duplicate = False
        for chosen in accepted:
            gap = math.hypot(
                candidate["x"] - chosen["x"],
                candidate["y"] - chosen["y"],
            )
            adaptive_gap = max(
                minimum_center_gap_px,
                0.65 * min(candidate["radiusPx"], chosen["radiusPx"]),
            )
            if gap < adaptive_gap:
                duplicate = True
                break
        if not duplicate:
            accepted.append(candidate)

    max_tree_count = int(os.getenv("MAX_DETECTED_TREES", "1500"))
    accepted = accepted[:max_tree_count]

    trees = []
    for item in accepted:
        lat, lng = local_pixel_to_latlng(item["x"], item["y"], layout)
        crown_radius_m = float(item["radiusPx"] * mpp)
        trees.append(
            {
                "latitude": round(lat, 8),
                "longitude": round(lng, 8),
                "crownRadius": round(crown_radius_m, 2),
                # A first-pass safety radius. Frontend may add a user margin later.
                "suggestedRadius": round(crown_radius_m + 0.6, 2),
                "confidence": round(
                    clamp(
                        (item["radiusPx"] - min_peak_px)
                        / max(max_radius_px - min_peak_px, 1.0),
                        0.25,
                        0.98,
                    ),
                    3,
                ),
                "_x": item["x"],
                "_y": item["y"],
            }
        )

    return trees


def estimate_tree_grid_spacing(
    trees: Sequence[dict],
    dominant_geo_angle: float,
    center_latitude: float,
    zoom: int,
) -> dict:
    """
    Estimate tree-to-tree spacing along rows and row-to-row spacing.

    Pair vectors are classified relative to the dominant row direction.
    Medians are used to reduce the effect of missed or duplicate detections.
    """
    if len(trees) < 4:
        return {
            "alongRow": None,
            "betweenRows": None,
            "recommendedPathSpacing": None,
        }

    mpp = meters_per_pixel(center_latitude, zoom)
    points = np.asarray(
        [[float(tree["_x"]) * mpp, -float(tree["_y"]) * mpp] for tree in trees],
        dtype=np.float64,
    )

    row_angle = math.radians(dominant_geo_angle)
    row_axis = np.asarray([math.cos(row_angle), math.sin(row_angle)])
    cross_axis = np.asarray([-math.sin(row_angle), math.cos(row_angle)])

    along_candidates = []
    cross_candidates = []
    max_neighbor_m = float(os.getenv("MAX_TREE_NEIGHBOR_DISTANCE_M", "25.0"))
    angle_tolerance = float(os.getenv("TREE_GRID_ANGLE_TOLERANCE_DEG", "18.0"))

    # For each tree, retain only its nearest plausible neighbor in each direction.
    for i in range(len(points)):
        nearest_along = math.inf
        nearest_cross = math.inf

        for j in range(len(points)):
            if i == j:
                continue

            vector = points[j] - points[i]
            distance_m = float(np.linalg.norm(vector))
            if distance_m < 1.0 or distance_m > max_neighbor_m:
                continue

            angle = normalize_angle_180(
                math.degrees(math.atan2(vector[1], vector[0]))
            )
            row_diff = angle_difference_180(angle, dominant_geo_angle)
            cross_diff = angle_difference_180(
                angle,
                normalize_angle_180(dominant_geo_angle + 90.0),
            )

            along_projection = abs(float(vector @ row_axis))
            cross_projection = abs(float(vector @ cross_axis))

            if row_diff <= angle_tolerance and along_projection < nearest_along:
                nearest_along = along_projection

            if cross_diff <= angle_tolerance and cross_projection < nearest_cross:
                nearest_cross = cross_projection

        if math.isfinite(nearest_along):
            along_candidates.append(nearest_along)
        if math.isfinite(nearest_cross):
            cross_candidates.append(nearest_cross)

    def robust_median(values: Sequence[float]) -> Optional[float]:
        if len(values) < 3:
            return None
        array = np.asarray(values, dtype=np.float64)
        median = float(np.median(array))
        absolute_deviation = np.abs(array - median)
        mad = float(np.median(absolute_deviation))
        if mad > 1e-6:
            array = array[absolute_deviation <= 3.5 * mad]
        if array.size < 3:
            return None
        return float(np.median(array))

    along = robust_median(along_candidates)
    between = robust_median(cross_candidates)

    min_spacing = float(os.getenv("MIN_ORCHARD_SPACING_M", "2.0"))
    max_spacing = float(os.getenv("MAX_ORCHARD_SPACING_M", "20.0"))

    if along is not None and not min_spacing <= along <= max_spacing:
        along = None
    if between is not None and not min_spacing <= between <= max_spacing:
        between = None

    return {
        "alongRow": round(along, 2) if along is not None else None,
        "betweenRows": round(between, 2) if between is not None else None,
        "recommendedPathSpacing": round(between, 2) if between is not None else None,
    }


def public_tree_payload(trees: Sequence[dict]) -> List[dict]:
    return [
        {
            key: value
            for key, value in tree.items()
            if not key.startswith("_")
        }
        for tree in trees
    ]

def merge_segments_to_rows(
    segments: Sequence[Tuple[int, int, int, int, float]],
    dominant_angle_deg: float,
    layout: TileLayout,
    center_latitude: float,
) -> List[List[List[float]]]:
    if not segments:
        return []
        
    mpp = meters_per_pixel(center_latitude, layout.zoom)
    
    # Project geographic angle to image coordinates (y grows downward)
    rad = math.radians(-dominant_angle_deg)
    cos_val = math.cos(rad)
    sin_val = math.sin(rad)
    
    # Normal axis vector (perpendicular to row direction)
    nx = -sin_val
    ny = cos_val
    
    # Row direction vector
    rx = cos_val
    ry = sin_val
    
    projected = []
    for x1, y1, x2, y2, weight in segments:
        mx = (x1 + x2) / 2.0
        my = (y1 + y2) / 2.0
        
        dist_normal = mx * nx + my * ny
        
        p1_along = x1 * rx + y1 * ry
        p2_along = x2 * rx + y2 * ry
        
        projected.append({
            "x1": x1, "y1": y1,
            "x2": x2, "y2": y2,
            "dist_normal": dist_normal,
            "along_min": min(p1_along, p2_along),
            "along_max": max(p1_along, p2_along),
            "weight": weight
        })
        
    projected.sort(key=lambda item: item["dist_normal"])
    
    # Cluster lines that are closer than 2.8 meters on the normal axis
    threshold_px = 2.8 / max(mpp, 1e-6)
    
    groups = []
    current_group = []
    for item in projected:
        if not current_group:
            current_group.append(item)
        else:
            group_avg = sum(g["dist_normal"] for g in current_group) / len(current_group)
            if abs(item["dist_normal"] - group_avg) < threshold_px:
                current_group.append(item)
            else:
                groups.append(current_group)
                current_group = [item]
    if current_group:
        groups.append(current_group)
        
    merged_rows = []
    for gp in groups:
        total_w = sum(g["weight"] for g in gp)
        # Filter out short noise segments (under 20 meters equivalent length)
        if total_w < (20.0 / mpp) ** 2:
            continue
            
        if total_w < 1e-9:
            avg_normal = sum(g["dist_normal"] for g in gp) / len(gp)
        else:
            avg_normal = sum(g["dist_normal"] * g["weight"] for g in gp) / total_w
            
        min_along = min(g["along_min"] for g in gp)
        max_along = max(g["along_max"] for g in gp)
        
        x1_m = min_along * rx + avg_normal * nx
        y1_m = min_along * ry + avg_normal * ny
        
        x2_m = max_along * rx + avg_normal * nx
        y2_m = max_along * ry + avg_normal * ny
        
        lat1, lng1 = local_pixel_to_latlng(x1_m, y1_m, layout)
        lat2, lng2 = local_pixel_to_latlng(x2_m, y2_m, layout)
        merged_rows.append([[lat1, lng1], [lat2, lng2]])
        
    return merged_rows



@app.get("/api/vision/health")
def health():
    return {
        "status": "ok",
        "tileProviderConfigured": bool(TILE_URL_TEMPLATE),
    }


@app.post("/api/vision/analyze-field")
def analyze_field(payload: AnalyzeFieldRequest):
    layout = choose_tile_layout(payload.bounds, payload.zoom)
    image_bgr = build_tile_mosaic(layout)
    mask = build_analysis_mask(
        image_bgr.shape[:2],
        payload.boundary,
        payload.obstacles,
        layout,
    )

    mask_area = int(np.count_nonzero(mask))
    if mask_area < 2_000:
        raise HTTPException(
            status_code=422,
            detail="พื้นที่ที่วาดมีขนาดเล็กเกินไปสำหรับการวิเคราะห์ภาพ",
        )

    angle, confidence, segments = detect_dominant_rows(image_bgr, mask)
    center_lat = (payload.bounds.north + payload.bounds.south) / 2.0
    texture_spacing = estimate_row_spacing(
        image_bgr,
        mask,
        angle,
        center_lat,
        layout.zoom,
    )

    trees = detect_tree_centers(
        image_bgr,
        mask,
        layout,
        center_lat,
    )
    tree_spacing = estimate_tree_grid_spacing(
        trees,
        angle,
        center_lat,
        layout.zoom,
    )

    # Prefer orchard center-to-center row spacing when enough trees were detected.
    recommended_spacing = tree_spacing["recommendedPathSpacing"]
    if recommended_spacing is None:
        recommended_spacing = (
            round(texture_spacing, 2)
            if texture_spacing is not None
            else None
        )

    return {
        "angle": round(angle, 2),
        "spacing": recommended_spacing,
        "textureSpacing": (
            round(texture_spacing, 2)
            if texture_spacing is not None
            else None
        ),
        "treeSpacing": tree_spacing,
        "treeCount": len(trees),
        "treeCenters": public_tree_payload(trees),
        "confidence": round(confidence, 3),
        "rows": merge_segments_to_rows(segments, angle, layout, center_lat),
        "analysisZoom": layout.zoom,
        "tileCount": layout.count,
        "imageSize": {
            "width": layout.width,
            "height": layout.height,
        },
    }
