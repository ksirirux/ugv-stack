// Constants for Coordinate Projections (WGS84 flat approximation)
export const METERS_PER_LAT = 111320;

// Helper to convert LatLng to local meters relative to a reference LatLng
export function toLocalXY(lat, lng, refLat, refLng) {
  const latRad = refLat * (Math.PI / 180.0);
  const metersPerLng = METERS_PER_LAT * Math.cos(latRad);
  const dy = (lat - refLat) * METERS_PER_LAT;
  const dx = (lng - refLng) * metersPerLng;
  return { x: dx, y: dy };
}

// Helper to convert local meters back to LatLng
export function toLatLng(x, y, refLat, refLng) {
  const latRad = refLat * (Math.PI / 180.0);
  const metersPerLng = METERS_PER_LAT * Math.cos(latRad);
  const lat = refLat + (y / METERS_PER_LAT);
  const lng = refLng + (x / metersPerLng);
  return [lat, lng];
}

// Calculate distance between two points in meters
export function getDistance(lat1, lng1, lat2, lng2) {
  const dy = (lat2 - lat1) * METERS_PER_LAT;
  const latRad = lat1 * (Math.PI / 180.0);
  const dx = (lng2 - lng1) * METERS_PER_LAT * Math.cos(latRad);
  return Math.sqrt(dx * dx + dy * dy);
}

// Shoelace Formula to calculate polygon area in square meters
export function calculateArea(vertices) {
  if (vertices.length < 3) return 0;

  const ref = vertices[0];
  const points = vertices.map(v => toLocalXY(v[0], v[1], ref[0], ref[1]));

  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const next = points[(i + 1) % n];
    area += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(area) * 0.5;
}

// Offsets/shrinks a polygon in local XY coordinates.
// Positive offset shrinks the polygon.
// Negative offset grows the polygon.
export function offsetPolygon(poly, offset) {
  const n = poly.length;
  if (n < 3) return poly;

  // 1. Determine winding order (CCW)
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    signedArea += p1.x * p2.y - p2.x * p1.y;
  }
  const isCCW = signedArea > 0;

  // 2. Compute edge lines shifted by offset
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 1e-6) {
      lines.push({ A: 0, B: 0, C: 0, valid: false });
      continue;
    }

    const nx = isCCW ? -dy / len : dy / len;
    const ny = isCCW ? dx / len : -dx / len;

    const A = nx;
    const B = ny;
    const C = nx * p1.x + ny * p1.y + offset;
    lines.push({ A, B, C, valid: true });
  }

  // 3. Intersect shifted lines to find new vertices
  const newPoly = [];
  for (let i = 0; i < n; i++) {
    const prevIdx = (i - 1 + n) % n;
    const l1 = lines[prevIdx];
    const l2 = lines[i];
    const p = poly[i];

    if (!l1.valid || !l2.valid) {
      newPoly.push(p);
      continue;
    }

    const det = l1.A * l2.B - l2.A * l1.B;
    if (Math.abs(det) > 1e-6) {
      const x = (l1.C * l2.B - l2.C * l1.B) / det;
      const y = (l1.A * l2.C - l2.A * l1.C) / det;
      newPoly.push({ x, y });
    } else {
      const shiftX = (l1.A + l2.A) * 0.5 * offset;
      const shiftY = (l1.B + l2.B) * 0.5 * offset;
      newPoly.push({ x: p.x + shiftX, y: p.y + shiftY });
    }
  }

  return newPoly;
}

// Do two segments intersect strictly (excluding sharing endpoints)?
export function segmentsIntersectStrict(a, b, c, d) {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(det) < 1e-9) return false;

  const u = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det;
  const v = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det;

  return u > 1e-5 && u < 1 - 1e-5 && v > 1e-5 && v < 1 - 1e-5;
}

// Ray-casting point-in-polygon check
export function isPointInPolygon(pt, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    if ((p1.y > pt.y) !== (p2.y > pt.y) &&
        pt.x < (p2.x - p1.x) * (pt.y - p1.y) / (p2.y - p1.y) + p1.x) {
      inside = !inside;
    }
  }
  return inside;
}

// Check if a line segment between a and b is safe (collision-free)
export function isSegmentSafe(a, b, obstacles, boundary) {
  for (const obs of obstacles) {
    const m = obs.length;
    for (let i = 0; i < m; i++) {
      const o1 = obs[i];
      const o2 = obs[(i + 1) % m];
      if (segmentsIntersectStrict(a, b, o1, o2)) {
        return false;
      }
    }
  }

  if (boundary && boundary.length >= 3) {
    const m = boundary.length;
    for (let i = 0; i < m; i++) {
      const b1 = boundary[i];
      const b2 = boundary[(i + 1) % m];
      if (segmentsIntersectStrict(a, b, b1, b2)) {
        return false;
      }
    }
  }

  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  for (const obs of obstacles) {
    if (isPointInPolygon(mid, obs)) {
      return false;
    }
  }

  return true;
}

// Dijkstra shortest path on visibility graph of vertices
export function findSafePath(start, end, obstacles, boundary) {
  const nodes = [start, end];
  obstacles.forEach(obs => {
    obs.forEach(pt => {
      nodes.push(pt);
    });
  });

  const N = nodes.length;
  const adj = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (isSegmentSafe(nodes[i], nodes[j], obstacles, boundary)) {
        const dist = Math.sqrt(
          (nodes[i].x - nodes[j].x) ** 2 +
          (nodes[i].y - nodes[j].y) ** 2
        );
        adj[i].push({ to: j, weight: dist });
        adj[j].push({ to: i, weight: dist });
      }
    }
  }

  const dists = Array(N).fill(Infinity);
  const prev = Array(N).fill(null);
  dists[0] = 0;

  const visited = Array(N).fill(false);

  for (let iter = 0; iter < N; iter++) {
    let u = -1;
    let minDist = Infinity;
    for (let i = 0; i < N; i++) {
      if (!visited[i] && dists[i] < minDist) {
        minDist = dists[i];
        u = i;
      }
    }

    if (u === -1 || u === 1) break;
    visited[u] = true;

    adj[u].forEach(edge => {
      const v = edge.to;
      const alt = dists[u] + edge.weight;
      if (alt < dists[v]) {
        dists[v] = alt;
        prev[v] = u;
      }
    });
  }
  //อันนี้ มันคืนเป็นเส้นตรงใช้ไม่ได้
  // if (dists[1] === Infinity) {
  //   const directDist = Math.sqrt((start.x - end.x) ** 2 + (start.y - end.y) ** 2);
  //   return { path: [start, end], distance: directDist };
  // }
  // เปลี่ยนเป็น หยุด ไม่คืน path ดีกว่า

  if (dists[1] === Infinity) {
    return {
      path: [],
      distance: Infinity,
      error: "No safe transition path"
    };
  }

  const path = [];
  let curr = 1;
  while (curr !== null) {
    path.push(nodes[curr]);
    curr = prev[curr];
  }
  return { path: path.reverse(), distance: dists[1] };
}

// Subtraction helper of interval segments
export function subtractInterval(src, subs) {
  let current = [src];
  subs.forEach(sub => {
    let next = [];
    current.forEach(c => {
      const [sMin, sMax] = c;
      const [subMin, subMax] = sub;

      if (subMax <= sMin || subMin >= sMax) {
        next.push(c);
      } else {
        if (subMin > sMin) next.push([sMin, subMin]);
        if (subMax < sMax) next.push([subMax, sMax]);
      }
    });
    current = next;
  });
  return current;
}

// Ray-crossing horizontal polygon intersection finder
export function getPolygonIntersections(poly, Y) {
  const intersections = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const yMin = Math.min(p1.y, p2.y);
    const yMax = Math.max(p1.y, p2.y);

    if (Y > yMin && Y <= yMax) {
      const t = (Y - p1.y) / (p2.y - p1.y);
      const x = p1.x + t * (p2.x - p1.x);
      intersections.push(x);
    }
  }
  return intersections.sort((a, b) => a - b);
}

// Full path planning generator logic
export function generatePathPlan(boundaryVertices, obstacles, inset=5.5, spacing=3.5, angle=57) {
  if (boundaryVertices.length < 3) {
    return { path: [], length: 0 };
  }

  const ref = boundaryVertices[0];
  const angleRad = (angle * Math.PI) / 180.0;

  // 1. Transform WGS84 vertices to Local XY
  const bXY = boundaryVertices.map(v => toLocalXY(v[0], v[1], ref[0], ref[1]));
  const obsXYs = obstacles.map(obs => obs.map(v => toLocalXY(v[0], v[1], ref[0], ref[1])));

  // 2. Rotate points by -angle
  const cosA = Math.cos(-angleRad);
  const sinA = Math.sin(-angleRad);
  const rotatePt = (p) => ({
    x: p.x * cosA - p.y * sinA,
    y: p.x * sinA + p.y * cosA
  });

  const rotateBack = (x, y) => {
    const cosR = Math.cos(angleRad);
    const sinR = Math.sin(angleRad);
    return {
      x: x * cosR - y * sinR,
      y: x * sinR + y * cosR
    };
  };

  const rotB = bXY.map(rotatePt);
  const rotObs = obsXYs.map(obs => obs.map(rotatePt));

  // 3. Offset/shrink boundary and obstacles
  const shrunkenRotB = offsetPolygon(rotB, inset);
  const grownRotObs = rotObs.map(obs => offsetPolygon(obs, -inset));

  if (shrunkenRotB.length < 3) {
    return { path: [], length: 0, error: "Inset is too large for this boundary!" };
  }

  // 4. Compute rotated bounding box range
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  shrunkenRotB.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  if (minX >= maxX || minY >= maxY) {
    return { path: [], length: 0, error: "Inset is too large for this boundary!" };
  }

  // 5. Generate parallel sweep rows along rotated Y axis
  const rawRows = [];
  const step = Math.max(0.5, spacing);

  for (let Y = minY + step / 2; Y < maxY; Y += step) {
    const boundaryIntervals = [];
    const bInts = getPolygonIntersections(shrunkenRotB, Y);
    for (let i = 0; i < bInts.length - 1; i += 2) {
      boundaryIntervals.push([bInts[i], bInts[i + 1]]);
    }

    const obstacleIntervals = [];
    grownRotObs.forEach(obs => {
      const obsInts = getPolygonIntersections(obs, Y);
      for (let i = 0; i < obsInts.length - 1; i += 2) {
        obstacleIntervals.push([obsInts[i], obsInts[i + 1]]);
      }
    });

    let validRowSegments = [];
    boundaryIntervals.forEach(bInterval => {
      const subbed = subtractInterval(bInterval, obstacleIntervals);
      validRowSegments.push(...subbed);
    });

    const rowSegments = validRowSegments.filter(([sMin, sMax]) => sMin < sMax);
    if (rowSegments.length > 0) {
      rawRows.push({
        y: Y,
        segments: rowSegments
      });
    }
  }

  // 6. Collect all raw segments
  const rawSegments = [];
  rawRows.forEach((row) => {
    const Y = row.y;
    row.segments.forEach(([sMin, sMax]) => {
      rawSegments.push([{ x: sMin, y: Y }, { x: sMax, y: Y }]);
    });
  });

  // 7. Group segments into columns by vertical connectivity
  const columns = [];
  const sortedSegs = [...rawSegments].sort((a, b) => a[0].y - b[0].y);

  sortedSegs.forEach(seg => {
    const segY = seg[0].y;
    const segMinX = Math.min(seg[0].x, seg[1].x);
    const segMaxX = Math.max(seg[0].x, seg[1].x);
    
    let bestColIdx = -1;
    let maxOverlap = 0;
    
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const lastSeg = col[col.length - 1];
      
      const yDiff = segY - lastSeg[0].y;
      if (yDiff > 0.1 && yDiff < step * 1.5) {
        const lastMinX = Math.min(lastSeg[0].x, lastSeg[1].x);
        const lastMaxX = Math.max(lastSeg[0].x, lastSeg[1].x);
        
        const overlap = Math.min(segMaxX, lastMaxX) - Math.max(segMinX, lastMinX);
        if (overlap > maxOverlap) {
          maxOverlap = overlap;
          bestColIdx = c;
        }
      }
    }
    
    if (bestColIdx !== -1 && maxOverlap > 0) {
      columns[bestColIdx].push(seg);
    } else {
      columns.push([seg]);
    }
  });

  // 8. Generate serpentine paths for each column
  const columnPaths = [];
  columns.forEach(col => {
    col.sort((a, b) => a[0].y - b[0].y);
    
    const colPath = [];
    let leftToRight = true;
    col.forEach(seg => {
      if (leftToRight) {
        colPath.push(seg[0], seg[1]);
      } else {
        colPath.push(seg[1], seg[0]);
      }
      leftToRight = !leftToRight;
    });
    columnPaths.push(colPath);
  });

  // 9. Connect column paths using Greedy Dijkstra search and tag types
  const localPathPoints = [];
  if (columnPaths.length > 0) {
    const unvisitedCols = [...columnPaths];

    // Start with column 0
    let currentCol = unvisitedCols[0];
    localPathPoints.push({ x: currentCol[0].x, y: currentCol[0].y, type: "work" });
    for (let i = 1; i < currentCol.length; i++) {
      const type = i % 2 === 1 ? "work" : "turn";
      localPathPoints.push({ x: currentCol[i].x, y: currentCol[i].y, type });
    }
    let currentPoint = localPathPoints[localPathPoints.length - 1];
    unvisitedCols.splice(0, 1);

    while (unvisitedCols.length > 0) {
      let bestIdx = -1;
      let bestDir = 0; // 0 for forward, 1 for reverse
      let minSafeDist = Infinity;
      let bestSafePath = null;

      for (let i = 0; i < unvisitedCols.length; i++) {
        const colPath = unvisitedCols[i];
        
        // Check direction 1: currentPoint -> colPath[0] -> colPath[end]
        const r1 = findSafePath(currentPoint, colPath[0], grownRotObs, shrunkenRotB);
        if (r1.distance < minSafeDist) {
          minSafeDist = r1.distance;
          bestIdx = i;
          bestDir = 0;
          bestSafePath = r1.path;
        }

        // Check direction 2: currentPoint -> colPath[end] -> colPath[0]
        const r2 = findSafePath(currentPoint, colPath[colPath.length - 1], grownRotObs, shrunkenRotB);
        if (r2.distance < minSafeDist) {
          minSafeDist = r2.distance;
          bestIdx = i;
          bestDir = 1;
          bestSafePath = r2.path;
        }
      }

      if (bestIdx === -1) break;

      const chosenCol = unvisitedCols[bestIdx];
      
      // Add transition path (excluding first point which is currentPoint)
      for (let j = 1; j < bestSafePath.length; j++) {
        localPathPoints.push({ x: bestSafePath[j].x, y: bestSafePath[j].y, type: "transit" });
      }
      
      // Add column path in chosen direction
      if (bestDir === 0) {
        for (let j = 1; j < chosenCol.length; j++) {
          const type = j % 2 === 1 ? "work" : "turn";
          localPathPoints.push({ x: chosenCol[j].x, y: chosenCol[j].y, type });
        }
        currentPoint = chosenCol[chosenCol.length - 1];
      } else {
        for (let j = chosenCol.length - 2; j >= 0; j--) {
          const diff = chosenCol.length - 1 - j;
          const type = diff % 2 === 1 ? "work" : "turn";
          localPathPoints.push({ x: chosenCol[j].x, y: chosenCol[j].y, type });
        }
        currentPoint = chosenCol[0];
      }

      unvisitedCols.splice(bestIdx, 1);
    }
  }

  // 10. Convert local XY path back to LatLng coordinates
  const wgs84Path = localPathPoints.map(p => {
    const rotPt = rotateBack(p.x, p.y);
    const latlng = toLatLng(rotPt.x, rotPt.y, ref[0], ref[1]);
    latlng.type = p.type;
    return latlng;
  });

  // 11. Calculate Path length
  let totalLength = 0;
  for (let i = 0; i < wgs84Path.length - 1; i++) {
    totalLength += getDistance(
      wgs84Path[i][0],
      wgs84Path[i][1],
      wgs84Path[i + 1][0],
      wgs84Path[i + 1][1]
    );
  }

  return { path: wgs84Path, length: totalLength };
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
