import type { Point, Wall } from './types';

export function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function wallLength(wall: Wall): number {
  return dist(wall.a, wall.b);
}

export function wallAngle(wall: Wall): number {
  return Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
}

export function pointAlongWall(wall: Wall, offsetMm: number): Point {
  const len = wallLength(wall);
  if (len === 0) return { ...wall.a };
  const t = offsetMm / len;
  return {
    x: wall.a.x + (wall.b.x - wall.a.x) * t,
    y: wall.a.y + (wall.b.y - wall.a.y) * t,
  };
}

export function snapPoint(p: Point, grid = 100): Point {
  return {
    x: Math.round(p.x / grid) * grid,
    y: Math.round(p.y / grid) * grid,
  };
}

/** Endpoint magnet — large so corners tip-to-tip even when clicking thick stroke. */
export const WALL_MAGNET_MM = 520;
/** Mid-span T-junction magnet (perpendicular to centerline). */
export const SEGMENT_MAGNET_MM = 160;
/**
 * Prefer endpoint over segment unless segment is this much closer.
 * Large bias: corners must win over "into the wall" projections.
 */
export const ENDPOINT_BIAS_MM = 480;
/** Along-wall distance from tip: segment hits here become endpoint snaps. */
export const END_PROMOTE_MM = 750;
/** After place/move: merge tips within this distance to one shared point. */
export const ENDPOINT_WELD_MM = 150;
/** Soft axis lock while drafting a wall from draftStart. */
export const ORTHO_SNAP_MM = 140;

export type MagnetHit = {
  point: Point;
  kind: 'endpoint' | 'segment' | 'grid';
  wallId?: string;
  strength: number; // distance before snap
};

/**
 * Soft ortho: if nearly horizontal/vertical from `from`, lock that axis.
 */
export function orthoSnapFrom(from: Point, to: Point, thresholdMm = ORTHO_SNAP_MM): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) <= thresholdMm && Math.abs(dy) > thresholdMm) {
    return { x: from.x, y: to.y };
  }
  if (Math.abs(dy) <= thresholdMm && Math.abs(dx) > thresholdMm) {
    return { x: to.x, y: from.y };
  }
  return { x: to.x, y: to.y };
}

/**
 * Magnetic snap for wall endpoints (centerline model):
 * 1) other wall endpoints — preferred for corners (butt / tip-to-tip)
 * 2) projection onto segments — only mid-span T-junctions
 * 3) grid / free
 */
export function magnetSnapPoint(
  p: Point,
  walls: Wall[],
  opts: {
    ignoreWallId?: string;
    magnetMm?: number;
    segmentMagnetMm?: number;
    grid?: number;
    freeWhenFar?: boolean;
    endpointBiasMm?: number;
    from?: Point;
  } = {},
): MagnetHit {
  const endpointMagnet = opts.magnetMm ?? WALL_MAGNET_MM;
  const segmentMagnet = opts.segmentMagnetMm ?? SEGMENT_MAGNET_MM;
  const grid = opts.grid ?? 100;
  const endpointBias = opts.endpointBiasMm ?? ENDPOINT_BIAS_MM;

  let cursor = { x: p.x, y: p.y };
  if (opts.from) cursor = orthoSnapFrom(opts.from, cursor);

  const best = {
    end: null as MagnetHit | null,
    seg: null as MagnetHit | null,
  };

  for (const wall of walls) {
    if (opts.ignoreWallId && wall.id === opts.ignoreWallId) continue;

    for (const end of [wall.a, wall.b]) {
      const d = dist(cursor, end);
      if (d <= endpointMagnet && (!best.end || d < best.end.strength)) {
        best.end = { point: { x: end.x, y: end.y }, kind: 'endpoint', wallId: wall.id, strength: d };
      }
    }

    const hit = projectPointOnSegment(cursor, wall.a, wall.b);
    const len = wallLength(wall);
    if (len < 1) continue;
    const alongFromA = hit.t * len;
    const alongFromB = (1 - hit.t) * len;
    const promote = Math.min(END_PROMOTE_MM, Math.max(endpointMagnet, len * 0.12));

    // Close to a tip along the wall → always tip-to-tip, never nest into body
    if (hit.dist <= endpointMagnet && alongFromA <= promote) {
      const d = dist(cursor, wall.a);
      const strength = Math.min(d, hit.dist);
      if (!best.end || strength < best.end.strength) {
        best.end = {
          point: { x: wall.a.x, y: wall.a.y },
          kind: 'endpoint',
          wallId: wall.id,
          strength,
        };
      }
      continue;
    }
    if (hit.dist <= endpointMagnet && alongFromB <= promote) {
      const d = dist(cursor, wall.b);
      const strength = Math.min(d, hit.dist);
      if (!best.end || strength < best.end.strength) {
        best.end = {
          point: { x: wall.b.x, y: wall.b.y },
          kind: 'endpoint',
          wallId: wall.id,
          strength,
        };
      }
      continue;
    }

    // True mid-span T only with tighter perpendicular magnet
    if (hit.dist <= segmentMagnet && (!best.seg || hit.dist < best.seg.strength)) {
      best.seg = {
        point: { x: hit.point.x, y: hit.point.y },
        kind: 'segment',
        wallId: wall.id,
        strength: hit.dist,
      };
    }
  }

  if (best.end && (!best.seg || best.end.strength <= best.seg.strength + endpointBias)) {
    return best.end;
  }
  if (best.seg) return best.seg;

  if (opts.freeWhenFar) {
    return { point: cursor, kind: 'grid', strength: Infinity };
  }
  return { point: snapPoint(cursor, grid), kind: 'grid', strength: Infinity };
}

/**
 * Weld nearby tips on the same floor to identical coordinates so corner
 * nodes (California) see a shared point.
 */
export function weldWallEndpoints(
  walls: Wall[],
  floor: number,
  weldMm = ENDPOINT_WELD_MM,
): Wall[] {
  type Tip = { wallId: string; end: 'a' | 'b'; x: number; y: number };
  const tips: Tip[] = [];
  for (const w of walls) {
    if (w.floor !== floor) continue;
    tips.push({ wallId: w.id, end: 'a', x: w.a.x, y: w.a.y });
    tips.push({ wallId: w.id, end: 'b', x: w.b.x, y: w.b.y });
  }

  const parent = tips.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const unite = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };

  for (let i = 0; i < tips.length; i++) {
    for (let j = i + 1; j < tips.length; j++) {
      if (tips[i].wallId === tips[j].wallId) continue;
      if (dist(tips[i], tips[j]) <= weldMm) unite(i, j);
    }
  }

  const clusterPoint = new Map<number, Point>();
  for (let i = 0; i < tips.length; i++) {
    const root = find(i);
    if (!clusterPoint.has(root)) {
      clusterPoint.set(root, { x: tips[i].x, y: tips[i].y });
    }
  }

  const next = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  for (let i = 0; i < tips.length; i++) {
    const root = find(i);
    const members = tips.filter((_, k) => find(k) === root);
    if (members.length < 2) continue;
    const pt = clusterPoint.get(root)!;
    const tip = tips[i];
    const wall = next.find((w) => w.id === tip.wallId);
    if (!wall) continue;
    wall[tip.end] = { x: pt.x, y: pt.y };
  }
  return next;
}

/**
 * Draw endpoints inset at shared corners so thick strokes butt tip-to-face
 * instead of crossing through each other. Logical wall.a/b stay at the
 * shared centerline tip for framing nodes.
 */
export function wallRenderEndpoints(
  wall: Wall,
  all: Wall[],
  eps = 2,
): { a: Point; b: Point } {
  const insetTip = (tip: Point, other: Point): Point => {
    const mates = all.filter(
      (w) =>
        w.id !== wall.id &&
        w.floor === wall.floor &&
        (dist(w.a, tip) <= eps || dist(w.b, tip) <= eps),
    );
    if (!mates.length) return tip;
    const inset = Math.max(...mates.map((m) => m.thickness)) / 2;
    const len = dist(tip, other);
    if (len < inset + 80) return tip;
    const ux = (other.x - tip.x) / len;
    const uy = (other.y - tip.y) / len;
    return { x: tip.x + ux * inset, y: tip.y + uy * inset };
  };
  return {
    a: insetTip(wall.a, wall.b),
    b: insetTip(wall.b, wall.a),
  };
}

export function projectPointOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { point: { ...a }, t: 0, dist: Math.hypot(p.x - a.x, p.y - a.y) };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

function nearlySame(a: Point, b: Point, eps = 12): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

/**
 * True only for a proper mid-span crossing (X).
 * Shared endpoints / T-junction (end lies on other segment) are allowed.
 */
export function segmentsCrossProper(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
  eps = 12,
): boolean {
  // Shared corner — connection, not collision
  if (
    nearlySame(a1, b1, eps) ||
    nearlySame(a1, b2, eps) ||
    nearlySame(a2, b1, eps) ||
    nearlySame(a2, b2, eps)
  ) {
    return false;
  }

  // T-junction: endpoint of one lies on the other segment
  const a1onB = projectPointOnSegment(a1, b1, b2);
  const a2onB = projectPointOnSegment(a2, b1, b2);
  const b1onA = projectPointOnSegment(b1, a1, a2);
  const b2onA = projectPointOnSegment(b2, a1, a2);
  if (a1onB.dist <= eps || a2onB.dist <= eps || b1onA.dist <= eps || b2onA.dist <= eps) {
    return false;
  }

  const ax = a2.x - a1.x;
  const ay = a2.y - a1.y;
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;
  const den = ax * by - ay * bx;
  if (Math.abs(den) < 1e-9) return false; // parallel / colinear — allow (no X)

  const t = ((b1.x - a1.x) * by - (b1.y - a1.y) * bx) / den;
  const u = ((b1.x - a1.x) * ay - (b1.y - a1.y) * ax) / den;
  const margin = 0.02; // ignore tiny endpoint grazes
  return t > margin && t < 1 - margin && u > margin && u < 1 - margin;
}

/** Proposed wall segment collides with existing walls (X-cross). */
export function wallSegmentCollides(
  a: Point,
  b: Point,
  walls: Wall[],
  ignoreWallId?: string,
): boolean {
  for (const w of walls) {
    if (ignoreWallId && w.id === ignoreWallId) continue;
    if (segmentsCrossProper(a, b, w.a, w.b)) return true;
  }
  return false;
}

/** Shoelace polygon area from wall graph (exterior loop approximation via bounding polygon of exterior walls). */
export function footprintFromWalls(walls: Wall[]): { areaM2: number; perimeterM: number; bounds: { minX: number; minY: number; maxX: number; maxY: number } } {
  const exterior = walls.filter((w) => w.kind === 'exterior');
  const pts = exterior.flatMap((w) => [w.a, w.b]);
  if (pts.length === 0) {
    return { areaM2: 0, perimeterM: 0, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  const areaM2 = ((maxX - minX) * (maxY - minY)) / 1_000_000;
  const perimeterM = exterior.reduce((s, w) => s + wallLength(w), 0) / 1000;
  return { areaM2, perimeterM, bounds: { minX, minY, maxX, maxY } };
}

/** Better footprint: try to order exterior walls into a closed polygon. */
export function polygonAreaFromExterior(walls: Wall[]): number {
  const exterior = walls.filter((w) => w.kind === 'exterior');
  if (exterior.length < 3) return footprintFromWalls(walls).areaM2;

  const remaining = [...exterior];
  const ordered: Point[] = [];
  let current = remaining.shift()!;
  ordered.push(current.a, current.b);
  let guard = 0;
  while (remaining.length && guard++ < 200) {
    const tip = ordered[ordered.length - 1];
    const idx = remaining.findIndex(
      (w) =>
        Math.hypot(w.a.x - tip.x, w.a.y - tip.y) < 1 ||
        Math.hypot(w.b.x - tip.x, w.b.y - tip.y) < 1,
    );
    if (idx < 0) break;
    const w = remaining.splice(idx, 1)[0];
    const next =
      Math.hypot(w.a.x - tip.x, w.a.y - tip.y) < 1 ? w.b : w.a;
    ordered.push(next);
  }

  if (ordered.length < 3) return footprintFromWalls(walls).areaM2;

  let sum = 0;
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    const q = ordered[(i + 1) % ordered.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2 / 1_000_000;
}

export function mmToM(mm: number): number {
  return mm / 1000;
}

export function volumeM3(section: { width: number; depth: number }, lengthMm: number, qty = 1): number {
  return (section.width / 1000) * (section.depth / 1000) * (lengthMm / 1000) * qty;
}

export function formatMm(mm: number): string {
  if (mm >= 1000 && mm % 10 === 0) return `${(mm / 1000).toFixed(mm % 100 === 0 ? 1 : 2)} м`;
  return `${Math.round(mm)} мм`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
