// Constants for Coordinate Projections (WGS84 flat approximation)
export const METERS_PER_LAT = 111320;

export function toLocalXY(lat, lng, refLat, refLng) {
  const latRad = refLat * (Math.PI / 180.0);
  const metersPerLng = METERS_PER_LAT * Math.cos(latRad);
  return {
    x: (lng - refLng) * metersPerLng,
    y: (lat - refLat) * METERS_PER_LAT
  };
}

export function toLatLng(x, y, refLat, refLng) {
  const latRad = refLat * (Math.PI / 180.0);
  const metersPerLng = METERS_PER_LAT * Math.cos(latRad);
  return [
    refLat + y / METERS_PER_LAT,
    refLng + x / metersPerLng
  ];
}

export function getDistance(lat1, lng1, lat2, lng2) {
  const dy = (lat2 - lat1) * METERS_PER_LAT;
  const latRad = lat1 * (Math.PI / 180.0);
  const dx = (lng2 - lng1) * METERS_PER_LAT * Math.cos(latRad);
  return Math.hypot(dx, dy);
}

export function calculateArea(vertices) {
  if (vertices.length < 3) return 0;
  const ref = vertices[0];
  const points = vertices.map(v => toLocalXY(v[0], v[1], ref[0], ref[1]));
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(area) * 0.5;
}

// Positive offset shrinks the polygon. Negative offset grows it.
export function offsetPolygon(poly, offset) {
  const n = poly.length;
  if (n < 3) return poly;

  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    signedArea += p1.x * p2.y - p2.x * p1.y;
  }
  const isCCW = signedArea > 0;

  const lines = [];
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);

    if (len < 1e-6) {
      lines.push({ valid: false });
      continue;
    }

    const nx = isCCW ? -dy / len : dy / len;
    const ny = isCCW ? dx / len : -dx / len;
    lines.push({
      A: nx,
      B: ny,
      C: nx * p1.x + ny * p1.y + offset,
      valid: true
    });
  }

  const result = [];
  for (let i = 0; i < n; i++) {
    const previous = lines[(i - 1 + n) % n];
    const current = lines[i];
    const original = poly[i];

    if (!previous.valid || !current.valid) {
      result.push(original);
      continue;
    }

    const det = previous.A * current.B - current.A * previous.B;
    if (Math.abs(det) > 1e-6) {
      result.push({
        x: (previous.C * current.B - current.C * previous.B) / det,
        y: (previous.A * current.C - current.A * previous.C) / det
      });
    } else {
      result.push({
        x: original.x + (previous.A + current.A) * 0.5 * offset,
        y: original.y + (previous.B + current.B) * 0.5 * offset
      });
    }
  }
  return result;
}

export function segmentsIntersectStrict(a, b, c, d) {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(det) < 1e-9) return false;

  const u = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det;
  const v = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det;
  return u > 1e-5 && u < 1 - 1e-5 && v > 1e-5 && v < 1 - 1e-5;
}

function pointOnSegment(pt, a, b, tolerance = 1e-6) {
  const cross = (pt.x - a.x) * (b.y - a.y) - (pt.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > tolerance) return false;
  const dot = (pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y);
  if (dot < -tolerance) return false;
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= lengthSq + tolerance;
}

export function isPointOnSegment(pt, a, b, epsilon = 1e-4) {
  const cross =
    (pt.y - a.y) * (b.x - a.x) -
    (pt.x - a.x) * (b.y - a.y);

  if (Math.abs(cross) > epsilon) {
    return false;
  }

  const dot =
    (pt.x - a.x) * (b.x - a.x) +
    (pt.y - a.y) * (b.y - a.y);

  if (dot < -epsilon) {
    return false;
  }

  const lengthSquared =
    (b.x - a.x) ** 2 +
    (b.y - a.y) ** 2;

  return dot <= lengthSquared + epsilon;
}

export function isPointInOrOnPolygon(pt, poly) {
  if (!poly || poly.length < 3) {
    return false;
  }

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];

    if (isPointOnSegment(pt, a, b)) {
      return true;
    }
  }

  return isPointInPolygon(pt, poly);
}

export function isPointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    if (
      (p1.y > pt.y) !== (p2.y > pt.y) &&
      pt.x < ((p2.x - p1.x) * (pt.y - p1.y)) / (p2.y - p1.y) + p1.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// function isPointInOrOnPolygon(pt, poly) {
//   if (isPointInPolygon(pt, poly)) return true;
//   for (let i = 0; i < poly.length; i++) {
//     if (pointOnSegment(pt, poly[i], poly[(i + 1) % poly.length])) return true;
//   }
//   return false;
// }

// A safe transition must remain inside the working boundary and outside every obstacle.
export function isSegmentSafe(a, b, obstacles, boundary) {
  // สำหรับ boundary:
  // จุดที่อยู่บนขอบถือว่าใช้งานได้
  if (boundary && boundary.length >= 3) {
    if (
      !isPointInOrOnPolygon(a, boundary) ||
      !isPointInOrOnPolygon(b, boundary)
    ) {
      return false;
    }
  }

  // ห้ามจุดอยู่ภายใน obstacle
  // แต่อนุญาตให้จุด visibility graph อยู่บนขอบ obstacle ที่ขยายแล้ว
  for (const obs of obstacles) {
    if (
      isPointInPolygon(a, obs) ||
      isPointInPolygon(b, obs)
    ) {
      return false;
    }

    for (let i = 0; i < obs.length; i++) {
      const o1 = obs[i];
      const o2 = obs[(i + 1) % obs.length];

      if (segmentsIntersectStrict(a, b, o1, o2)) {
        return false;
      }
    }
  }

  if (boundary && boundary.length >= 3) {
    for (let i = 0; i < boundary.length; i++) {
      const b1 = boundary[i];
      const b2 = boundary[(i + 1) % boundary.length];

      if (segmentsIntersectStrict(a, b, b1, b2)) {
        return false;
      }
    }
  }

  // ตรวจจุดตลอดแนวเส้น
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const samples = Math.max(10, Math.ceil(distance / 0.5));

  for (let i = 1; i < samples; i++) {
    const t = i / samples;

    const pt = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    };

    if (
      boundary &&
      boundary.length >= 3 &&
      !isPointInOrOnPolygon(pt, boundary)
    ) {
      return false;
    }

    for (const obs of obstacles) {
      if (isPointInPolygon(pt, obs)) {
        return false;
      }
    }
  }

  return true;
}
// Dijkstra shortest path on a visibility graph. Never falls back to an unsafe direct line.
export function findSafePath(start, end, obstacles, boundary) {
  if (isSegmentSafe(start, end, obstacles, boundary)) {
    return { path: [start, end], distance: Math.hypot(end.x - start.x, end.y - start.y) };
  }

//   const nodes = [start, end];
//   obstacles.forEach(obstacle => obstacle.forEach(point => nodes.push(point)));

  const nodes = [start, end];

// เพิ่มมุมสิ่งกีดขวาง
obstacles.forEach(obs => {
  obs.forEach(pt => {
    nodes.push(pt);
  });
});

// เพิ่มมุม boundary เพื่อให้หาเส้นอ้อมพื้นที่เว้าได้
if (boundary && boundary.length >= 3) {
  boundary.forEach(pt => {
    nodes.push(pt);
  });
}

  const adjacency = Array.from({ length: nodes.length }, () => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (!isSegmentSafe(nodes[i], nodes[j], obstacles, boundary)) continue;
      const weight = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      adjacency[i].push({ to: j, weight });
      adjacency[j].push({ to: i, weight });
    }
  }

  const distances = Array(nodes.length).fill(Infinity);
  const previous = Array(nodes.length).fill(null);
  const visited = Array(nodes.length).fill(false);
  distances[0] = 0;

  for (let iteration = 0; iteration < nodes.length; iteration++) {
    let current = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      if (!visited[i] && distances[i] < bestDistance) {
        current = i;
        bestDistance = distances[i];
      }
    }
    if (current === -1 || current === 1) break;
    visited[current] = true;

    for (const edge of adjacency[current]) {
      const alternative = distances[current] + edge.weight;
      if (alternative < distances[edge.to]) {
        distances[edge.to] = alternative;
        previous[edge.to] = current;
      }
    }
  }

  if (!Number.isFinite(distances[1])) {
    return { path: [], distance: Infinity, error: "No safe transition path" };
  }

  const path = [];
  for (let current = 1; current !== null; current = previous[current]) {
    path.push(nodes[current]);
  }
  return { path: path.reverse(), distance: distances[1] };
}

export function subtractInterval(source, subtractions) {
  let current = [source];
  for (const subtraction of subtractions) {
    const next = [];
    for (const candidate of current) {
      const [start, end] = candidate;
      const [subStart, subEnd] = subtraction;
      if (subEnd <= start || subStart >= end) {
        next.push(candidate);
      } else {
        if (subStart > start) next.push([start, subStart]);
        if (subEnd < end) next.push([subEnd, end]);
      }
    }
    current = next;
  }
  return current;
}

export function getPolygonIntersections(poly, y) {
  const intersections = [];
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    if (y > minY && y <= maxY) {
      const t = (y - p1.y) / (p2.y - p1.y);
      intersections.push(p1.x + t * (p2.x - p1.x));
    }
  }
  return intersections.sort((a, b) => a - b);
}

function localPathLength(points) {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return length;
}

function reverseWorkSegments(workSegments) {
  return [...workSegments].reverse().map(segment => ({
    start: segment.end,
    end: segment.start
  }));
}

function appendSegment(routeSegments, type, points) {
  if (!points || points.length < 2) return;
  routeSegments.push({
    type,
    spray: type === "work",
    points
  });
}

// Supports both the new options object and the old positional arguments.
export function generatePathPlan(
  boundaryVertices,
  obstacles = [],
  optionsOrInset = {},
  legacySpacing,
  legacyAngle
) {
  if (boundaryVertices.length < 3) {
    return { path: [], segments: [], length: 0, workLength: 0, transitLength: 0 };
  }

  const options = typeof optionsOrInset === "object"
    ? optionsOrInset
    : {
        boundaryInset: optionsOrInset,
        obstacleClearance: optionsOrInset,
        spacing: legacySpacing,
        angle: legacyAngle
      };

  const boundaryInset = Math.max(0, Number(options.boundaryInset ?? options.inset ?? 5.5));
  const obstacleClearance = Math.max(0, Number(options.obstacleClearance ?? 1.1));
  const spacing = Math.max(0.5, Number(options.spacing ?? 3.5));
  const angle = Number(options.angle ?? 57);

  const ref = boundaryVertices[0];
  const angleRad = angle * Math.PI / 180;
  const bXY = boundaryVertices.map(v => toLocalXY(v[0], v[1], ref[0], ref[1]));
  const obsXY = obstacles
    .filter(obstacle => obstacle.length >= 3)
    .map(obstacle => obstacle.map(v => toLocalXY(v[0], v[1], ref[0], ref[1])));

  const cosA = Math.cos(-angleRad);
  const sinA = Math.sin(-angleRad);
  const rotate = p => ({ x: p.x * cosA - p.y * sinA, y: p.x * sinA + p.y * cosA });
  const rotateBack = p => ({
    x: p.x * Math.cos(angleRad) - p.y * Math.sin(angleRad),
    y: p.x * Math.sin(angleRad) + p.y * Math.cos(angleRad)
  });

  const rotatedBoundary = bXY.map(rotate);
  const rotatedObstacles = obsXY.map(obstacle => obstacle.map(rotate));
  const workingBoundary = offsetPolygon(rotatedBoundary, boundaryInset);
  const safetyObstacles = rotatedObstacles.map(obstacle => offsetPolygon(obstacle, -obstacleClearance));

  if (workingBoundary.length < 3) {
    return { path: [], segments: [], length: 0, error: "Inset is too large for this boundary!" };
  }

  const xs = workingBoundary.map(p => p.x);
  const ys = workingBoundary.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (!(minX < maxX && minY < maxY)) {
    return { path: [], segments: [], length: 0, error: "Inset is too large for this boundary!" };
  }

  const rawSegments = [];
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    const boundaryXs = getPolygonIntersections(workingBoundary, y);
    const boundaryIntervals = [];
    for (let i = 0; i < boundaryXs.length - 1; i += 2) {
      boundaryIntervals.push([boundaryXs[i], boundaryXs[i + 1]]);
    }

    const obstacleIntervals = [];
    for (const obstacle of safetyObstacles) {
      const obstacleXs = getPolygonIntersections(obstacle, y);
      for (let i = 0; i < obstacleXs.length - 1; i += 2) {
        obstacleIntervals.push([obstacleXs[i], obstacleXs[i + 1]]);
      }
    }

    for (const boundaryInterval of boundaryIntervals) {
      const validIntervals = subtractInterval(boundaryInterval, obstacleIntervals);
      for (const [startX, endX] of validIntervals) {
        if (endX - startX > 0.05) {
          rawSegments.push([{ x: startX, y }, { x: endX, y }]);
        }
      }
    }
  }

  if (rawSegments.length === 0) {
    return { path: [], segments: [], length: 0, error: "No usable coverage rows were generated." };
  }

  // Group vertically connected row pieces into cells/columns.
  const columns = [];
  const sortedSegments = [...rawSegments].sort((a, b) => a[0].y - b[0].y);
  for (const segment of sortedSegments) {
    const y = segment[0].y;
    const minSegmentX = Math.min(segment[0].x, segment[1].x);
    const maxSegmentX = Math.max(segment[0].x, segment[1].x);
    let bestColumn = -1;
    let bestOverlap = 0;

    for (let c = 0; c < columns.length; c++) {
      const previous = columns[c][columns[c].length - 1];
      const yDifference = y - previous[0].y;
      if (yDifference <= 0.1 || yDifference >= spacing * 1.5) continue;
      const previousMinX = Math.min(previous[0].x, previous[1].x);
      const previousMaxX = Math.max(previous[0].x, previous[1].x);
      const overlap = Math.min(maxSegmentX, previousMaxX) - Math.max(minSegmentX, previousMinX);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestColumn = c;
      }
    }

    if (bestColumn >= 0 && bestOverlap > 0) columns[bestColumn].push(segment);
    else columns.push([segment]);
  }

  const columnWorkSegments = columns.map(column => {
    column.sort((a, b) => a[0].y - b[0].y);
    return column.map((segment, index) => index % 2 === 0
      ? { start: segment[0], end: segment[1] }
      : { start: segment[1], end: segment[0] }
    );
  });

  const routeSegments = [];
  const remaining = columnWorkSegments.map((segments, index) => ({ index, segments }));
  let currentPoint = null;

  while (remaining.length > 0) {
    let chosenIndex = 0;
    let chosenSegments = remaining[0].segments;
    let connector = null;

    if (currentPoint) {
      let bestDistance = Infinity;
      chosenIndex = -1;

      for (let i = 0; i < remaining.length; i++) {
        const forward = remaining[i].segments;
        const reverse = reverseWorkSegments(forward);
        for (const candidate of [forward, reverse]) {
          const result = findSafePath(currentPoint, candidate[0].start, safetyObstacles, workingBoundary);
          if (result.path.length > 0 && result.distance < bestDistance) {
            bestDistance = result.distance;
            chosenIndex = i;
            chosenSegments = candidate;
            connector = result.path;
          }
        }
      }

      if (chosenIndex < 0 || !connector) {
        return {
          path: [],
          segments: [],
          length: 0,
          error: "ไม่พบเส้นทางเชื่อมที่ปลอดภัยระหว่างกลุ่มแถว กรุณาปรับ Inset, ระยะหลบสิ่งกีดขวาง หรือรูปทรงสิ่งกีดขวาง"
        };
      }
      appendSegment(routeSegments, "transit", connector);
    }

    for (let i = 0; i < chosenSegments.length; i++) {
      const work = chosenSegments[i];
      if (currentPoint && (Math.abs(currentPoint.x - work.start.x) > 1e-6 || Math.abs(currentPoint.y - work.start.y) > 1e-6)) {
        const transition = findSafePath(currentPoint, work.start, safetyObstacles, workingBoundary);
        if (!transition.path.length) {
          return {
                path: [],
                segments: [],
                length: 0,
                workLength: 0,
                transitLength: 0,
                error:
                "ไม่สามารถเชื่อมแถวถัดไปภายในพื้นที่ปลอดภัยได้ " +
                "ขอบเขตอาจเว้าเกินไป หรือปลายแถวอยู่บนขอบเขตพอดี"
            };
        }
        appendSegment(routeSegments, "transit", transition.path);
      }
      appendSegment(routeSegments, "work", [work.start, work.end]);
      currentPoint = work.end;
    }

    remaining.splice(chosenIndex, 1);
  }

  const convertedSegments = routeSegments.map(segment => ({
    type: segment.type,
    spray: segment.spray,
    points: segment.points.map(point => {
      const unrotated = rotateBack(point);
      return toLatLng(unrotated.x, unrotated.y, ref[0], ref[1]);
    }),
    length: localPathLength(segment.points)
  }));

  const flatPath = [];
  const waypointModes = [];
  for (const segment of convertedSegments) {
    segment.points.forEach((point, index) => {
      const previous = flatPath[flatPath.length - 1];
      const duplicate = previous && Math.abs(previous[0] - point[0]) < 1e-12 && Math.abs(previous[1] - point[1]) < 1e-12;
      if (!duplicate) {
        flatPath.push(point);
        waypointModes.push({ type: segment.type, spray: segment.spray });
      } else if (index === segment.points.length - 1) {
        waypointModes[waypointModes.length - 1] = { type: segment.type, spray: segment.spray };
      }
    });
  }

  const workLength = convertedSegments
    .filter(segment => segment.type === "work")
    .reduce((sum, segment) => sum + segment.length, 0);
  const transitLength = convertedSegments
    .filter(segment => segment.type === "transit")
    .reduce((sum, segment) => sum + segment.length, 0);

  return {
    path: flatPath,
    waypointModes,
    segments: convertedSegments,
    length: workLength + transitLength,
    workLength,
    transitLength,
    settings: { boundaryInset, obstacleClearance, spacing, angle }
  };
}


// Analyze dominant agricultural row direction from an uploaded map/satellite image.
// Returns an angle compatible with generatePathPlan(): 0° = east-west, 90° = north-south.
// This is a browser-side computer-vision helper; no external AI service is required.
export function analyzeRowDirectionFromImageData(imageData, options = {}) {
  const {
    maxSize = 640,
    minGradient = 18,
    histogramBins = 180,
    centerCropRatio = 0.92
  } = options;

  if (!imageData || !imageData.data || imageData.width < 16 || imageData.height < 16) {
    return { error: "ข้อมูลภาพไม่ถูกต้อง" };
  }

  const srcW = imageData.width;
  const srcH = imageData.height;
  const scale = Math.min(1, maxSize / Math.max(srcW, srcH));
  const width = Math.max(16, Math.round(srcW * scale));
  const height = Math.max(16, Math.round(srcH * scale));
  const gray = new Float32Array(width * height);

  // Bilinear-like nearest resampling is sufficient for orientation analysis.
  for (let y = 0; y < height; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x / scale));
      const idx = (sy * srcW + sx) * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      gray[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  const hist = new Float64Array(histogramBins);
  let totalWeight = 0;
  let edgeCount = 0;
  const cropX = Math.floor(width * (1 - centerCropRatio) * 0.5);
  const cropY = Math.floor(height * (1 - centerCropRatio) * 0.5);
  const xEnd = width - cropX - 1;
  const yEnd = height - cropY - 1;

  // Sobel gradient. The row direction is perpendicular to the image gradient.
  for (let y = Math.max(1, cropY); y < Math.min(height - 1, yEnd); y++) {
    for (let x = Math.max(1, cropX); x < Math.min(width - 1, xEnd); x++) {
      const p00 = gray[(y - 1) * width + (x - 1)];
      const p01 = gray[(y - 1) * width + x];
      const p02 = gray[(y - 1) * width + (x + 1)];
      const p10 = gray[y * width + (x - 1)];
      const p12 = gray[y * width + (x + 1)];
      const p20 = gray[(y + 1) * width + (x - 1)];
      const p21 = gray[(y + 1) * width + x];
      const p22 = gray[(y + 1) * width + (x + 1)];

      const gx = -p00 + p02 - 2 * p10 + 2 * p12 - p20 + p22;
      const gy = -p00 - 2 * p01 - p02 + p20 + 2 * p21 + p22;
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < minGradient) continue;

      // Image y grows downward. Convert line angle to map convention (y/north grows upward).
      const gradientDeg = Math.atan2(-gy, gx) * 180 / Math.PI;
      let lineDeg = gradientDeg + 90;
      lineDeg = ((lineDeg % 180) + 180) % 180;

      const bin = Math.min(histogramBins - 1, Math.floor(lineDeg / 180 * histogramBins));
      const weight = magnitude * magnitude;
      hist[bin] += weight;
      totalWeight += weight;
      edgeCount++;
    }
  }

  if (edgeCount < 100 || totalWeight <= 0) {
    return { error: "ภาพไม่มีรายละเอียดแนวแถวเพียงพอ", confidence: 0 };
  }

  // Circular smoothing over 180° because 0° and 180° describe the same line.
  const smooth = new Float64Array(histogramBins);
  const radius = Math.max(2, Math.round(histogramBins / 90 * 3));
  for (let i = 0; i < histogramBins; i++) {
    let sum = 0;
    let weightSum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = (i + k + histogramBins) % histogramBins;
      const w = radius + 1 - Math.abs(k);
      sum += hist[j] * w;
      weightSum += w;
    }
    smooth[i] = sum / weightSum;
  }

  let bestBin = 0;
  for (let i = 1; i < histogramBins; i++) {
    if (smooth[i] > smooth[bestBin]) bestBin = i;
  }

  const exclusion = Math.max(8, Math.round(histogramBins * 10 / 180));
  let secondPeak = 0;
  for (let i = 0; i < histogramBins; i++) {
    const circularDistance = Math.min(
      Math.abs(i - bestBin),
      histogramBins - Math.abs(i - bestBin)
    );
    if (circularDistance > exclusion) secondPeak = Math.max(secondPeak, smooth[i]);
  }

  const peak = smooth[bestBin];
  const dominance = peak > 0 ? Math.max(0, Math.min(1, (peak - secondPeak) / peak)) : 0;
  const concentration = Math.max(0, Math.min(1, peak * histogramBins / totalWeight));
  const confidence = Math.max(0, Math.min(1, 0.65 * dominance + 0.35 * concentration));
  const angle = ((bestBin + 0.5) * 180 / histogramBins) % 180;

  return {
    angle: Math.round(angle),
    rawAngle: angle,
    confidence,
    edgeCount,
    imageSize: { width: srcW, height: srcH }
  };
}


export function reorderPathStartPoint(flatPath, waypointModes, boundaryVertices, obstacles, inset, obstacleClearance, clickedIdx) {
  if (flatPath.length < 2 || clickedIdx <= 0 || clickedIdx >= flatPath.length) {
    return null;
  }

  // Part A: clickedIdx to end
  const partAPath = flatPath.slice(clickedIdx);
  const partAModes = waypointModes.slice(clickedIdx);

  // Part B: 0 to clickedIdx - 1
  const partBPath = flatPath.slice(0, clickedIdx);
  const partBModes = waypointModes.slice(0, clickedIdx);

  const endPt = partAPath[partAPath.length - 1];
  const startPt = partBPath[0];

  let transitionPoints = [];
  let transitionModes = [];

  const dist = getDistance(endPt[0], endPt[1], startPt[0], startPt[1]);
  if (dist > 0.15) {
    try {
      const ref = boundaryVertices[0];
      const endPtXY = toLocalXY(endPt[0], endPt[1], ref[0], ref[1]);
      const startPtXY = toLocalXY(startPt[0], startPt[1], ref[0], ref[1]);

      const bXY = boundaryVertices.map(v => toLocalXY(v[0], v[1], ref[0], ref[1]));
      const obsXY = obstacles
        .filter(obstacle => obstacle.length >= 3)
        .map(obstacle => obstacle.map(v => toLocalXY(v[0], v[1], ref[0], ref[1])));

      const workingBoundary = offsetPolygon(bXY, inset);
      const safetyObstacles = obsXY.map(obstacle => offsetPolygon(obstacle, -obstacleClearance));

      const transition = findSafePath(endPtXY, startPtXY, safetyObstacles, workingBoundary);
      if (transition.path && transition.path.length >= 2) {
        const converted = transition.path.map(pt => toLatLng(pt.x, pt.y, ref[0], ref[1]));
        
        // Remove start and end duplicates
        transitionPoints = converted.slice(1, -1);
        transitionModes = transitionPoints.map(() => ({ type: "transit", spray: false }));
      }
    } catch (e) {
      console.error("Failed to compute transition", e);
    }
  }

  // Build new flatPath and waypointModes
  const newPath = [...partAPath, ...transitionPoints, ...partBPath];
  const newModes = [...partAModes, ...transitionModes, ...partBModes];

  // Copy modes types to coordinate array .type property for backwards-compatibility
  newPath.forEach((pt, i) => {
    pt.type = newModes[i]?.type || "work";
  });

  // Re-chunk newPath into segments based on newModes
  const newSegments = [];
  if (newPath.length > 0) {
    let currentSegmentPoints = [newPath[0]];
    let currentType = newModes[0]?.type || "work";
    let currentSpray = Boolean(newModes[0]?.spray);

    for (let i = 1; i < newPath.length; i++) {
      const pt = newPath[i];
      const mode = newModes[i];
      
      currentSegmentPoints.push(pt);

      if (mode.type !== currentType || mode.spray !== currentSpray || i === newPath.length - 1) {
        // Calculate segment length
        let segmentLen = 0;
        for (let j = 0; j < currentSegmentPoints.length - 1; j++) {
          segmentLen += getDistance(
            currentSegmentPoints[j][0], currentSegmentPoints[j][1],
            currentSegmentPoints[j + 1][0], currentSegmentPoints[j + 1][1]
          );
        }

        newSegments.push({
          type: currentType,
          spray: currentSpray,
          points: currentSegmentPoints,
          length: segmentLen
        });

        currentSegmentPoints = [pt];
        currentType = mode.type;
        currentSpray = Boolean(mode.spray);
      }
    }
  }

  return {
    path: newPath,
    waypointModes: newModes,
    segments: newSegments
  };
}
