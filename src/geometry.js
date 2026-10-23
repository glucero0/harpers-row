// Every story of a location is this tall. A wall, a prop, or a chest is tagged with the story it
// stands on, so a floor-two player is never stopped by the walls of the room under their feet.
export const STORY_HEIGHT = 10;
// A body whose feet are within this of the next story already counts as standing on it. This is what
// lets the top of a stair belong to the upper story while the ramp is still rising under the player.
const STORY_SLACK = 0.75;

// The story a height belongs to: 0 is the ground floor.
export function storyAt(y) {
  const height = Number.isFinite(y) ? y : 0;
  return Math.floor((height + STORY_SLACK) / STORY_HEIGHT);
}

// A collider with no `story` is always solid. A query with no height sees every story.
function onStory(collider, story) {
  return story === undefined || collider.story === undefined || collider.story === story;
}

export function closestOnSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, z: az + abz * t, t };
}

// How close the straight path from A to B comes to the point P, in 3D. `t` (0..1) is where along
// the path that closest point lies.
export function closestApproach3(ax, ay, az, bx, by, bz, px, py, pz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { distance: Math.hypot(px - (ax + abx * t), py - (ay + aby * t), pz - (az + abz * t)), t };
}

export function pointInPolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const zi = polygon[i][1];
    const xj = polygon[j][0];
    const zj = polygon[j][1];
    const crosses = zi > z !== zj > z;
    if (crosses && x < ((xj - xi) * (z - zi)) / (zj - zi + 0.0) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function distanceToEdges(x, z, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const closest = closestOnSegment(x, z, a[0], a[1], b[0], b[1]);
    best = Math.min(best, Math.hypot(x - closest.x, z - closest.z));
  }
  return best;
}

export function clearance(x, z, polygon) {
  const distance = distanceToEdges(x, z, polygon);
  return pointInPolygon(x, z, polygon) ? distance : -distance;
}

export function distanceToPolygon(x, z, polygon) {
  const roomClearance = clearance(x, z, polygon);
  return roomClearance >= 0 ? 0 : -roomClearance;
}

export function rectGap(a, b) {
  const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
  const gapZ = Math.max(a.z - (b.z + b.d), b.z - (a.z + a.d));
  if (gapX < -0.05 && gapZ < -0.05) return -1;
  const sx = Math.max(gapX, 0);
  const sz = Math.max(gapZ, 0);
  if (sx === 0 && sz === 0) return 0;
  if (sx > 0 && sz > 0) return Math.hypot(sx, sz);
  return sx + sz;
}

export function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

export function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1x = bx - ax;
  const d1z = bz - az;
  const d2x = dx - cx;
  const d2z = dz - cz;
  const cross = d1x * d2z - d1z * d2x;
  if (Math.abs(cross) < 1e-8) return false;
  const t = ((cx - ax) * d2z - (cz - az) * d2x) / cross;
  const u = ((cx - ax) * d1z - (cz - az) * d1x) / cross;
  const eps = 0.04;
  return t > eps && t < 1 - eps && u >= -eps && u <= 1 + eps;
}

// `y` (optional) is the height the sight line travels at. Walls on another story do not block it.
export function lineOfSight(x1, z1, x2, z2, colliders, y) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);
  const story = y === undefined ? undefined : storyAt(y);
  for (const wall of colliders) {
    if (wall.radius) continue;
    if (!onStory(wall, story)) continue;
    const wallMinX = wall.minX ?? Math.min(wall.ax, wall.bx);
    const wallMaxX = wall.maxX ?? Math.max(wall.ax, wall.bx);
    const wallMinZ = wall.minZ ?? Math.min(wall.az, wall.bz);
    const wallMaxZ = wall.maxZ ?? Math.max(wall.az, wall.bz);
    if (wallMaxX < minX || wallMinX > maxX || wallMaxZ < minZ || wallMinZ > maxZ) continue;
    if (segmentsIntersect(x1, z1, x2, z2, wall.ax, wall.az, wall.bx, wall.bz)) return false;
  }
  return true;
}

// `y` (optional) is the height of the body's feet. Colliders on another story are ignored.
export function resolveBody(x, z, radius, colliders, y) {
  let px = x;
  let pz = z;
  const story = y === undefined ? undefined : storyAt(y);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const collider of colliders) {
      if (!onStory(collider, story)) continue;
      if (collider.radius) {
        const dx = px - collider.x;
        const dz = pz - collider.z;
        const min = radius + collider.radius;
        if (Math.abs(dx) >= min || Math.abs(dz) >= min) continue;
        const dist2 = dx * dx + dz * dz;
        if (dist2 >= min * min) continue;
        const dist = Math.sqrt(dist2) || 0.0001;
        const push = min - dist;
        px += (dx / dist) * push;
        pz += (dz / dist) * push;
        continue;
      }
      const minX = collider.minX ?? Math.min(collider.ax, collider.bx);
      const maxX = collider.maxX ?? Math.max(collider.ax, collider.bx);
      const minZ = collider.minZ ?? Math.min(collider.az, collider.bz);
      const maxZ = collider.maxZ ?? Math.max(collider.az, collider.bz);
      if (px < minX - radius || px > maxX + radius || pz < minZ - radius || pz > maxZ + radius) continue;
      const closest = closestOnSegment(px, pz, collider.ax, collider.az, collider.bx, collider.bz);
      const dx = px - closest.x;
      const dz = pz - closest.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 >= radius * radius) continue;
      if (dist2 > 1e-8) {
        const dist = Math.sqrt(dist2);
        const push = radius - dist;
        px += (dx / dist) * push;
        pz += (dz / dist) * push;
      } else {
        const nx = collider.nx || 0;
        const nz = collider.nz || 1;
        px += nx * radius;
        pz += nz * radius;
      }
    }
  }
  return { x: px, z: pz };
}

export function segmentOnBoundary(ax, az, bx, bz, polygon, epsilon = 0.15) {
  const distanceA = distanceToEdges(ax, az, polygon);
  const distanceB = distanceToEdges(bx, bz, polygon);
  if (distanceA > epsilon || distanceB > epsilon) return false;
  const midX = (ax + bx) / 2;
  const midZ = (az + bz) / 2;
  return distanceToEdges(midX, midZ, polygon) <= epsilon;
}

export function randomPointInPolygon(polygon, margin, random = Math.random) {
  const xs = polygon.map((point) => point[0]);
  const zs = polygon.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const x = minX + random() * (maxX - minX);
    const z = minZ + random() * (maxZ - minZ);
    if (clearance(x, z, polygon) >= margin) return { x, z };
  }
  let best = null;
  let bestClear = -Infinity;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const x = minX + random() * (maxX - minX);
    const z = minZ + random() * (maxZ - minZ);
    const roomClearance = clearance(x, z, polygon);
    if (roomClearance > bestClear) {
      bestClear = roomClearance;
      best = { x, z };
    }
  }
  return best;
}
