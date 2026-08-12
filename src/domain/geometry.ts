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

/** Default magnet radius in mm — endpoint snaps when within this distance. */
export const WALL_MAGNET_MM = 250;

/**
 * How much closer a segment hit must be than an endpoint to beat it.
 * Without this bias, approaching a corner perpendicularly snaps "into" the
 * wall body (segment projection) instead of butt-joining tip-to-tip.
 */
export const ENDPOINT_BIAS_MM = 220;

/** Along-wall distance from a segment hit to an end → promote to that endpoint. */
export const END_PROMOTE_MM = 300;

export type MagnetHit = {
  point: Point;
  kind: 'endpoint' | 'segment' | 'grid';
  wallId?: string;
  strength: number; // distance before snap
};

/**
 * Magnetic snap for wall endpoints (centerline model):
 * 1) other wall endpoints — preferred for corners (butt / tip-to-tip)
 * 2) projection onto other wall segments — mid-span T-junctions only
 * 3) grid (weakest)
 *
 * Near-end segment projections are promoted to endpoints so corners join
 * tip-to-tip and California-corner nodes can detect shared points.
 */
export function magnetSnapPoint(
  p: Point,
  walls: Wall[],
  opts: {
    ignoreWallId?: string;
    magnetMm?: number;
    grid?: number;
    /** Prefer free movement — only magnet, no forced grid when far */
    freeWhenFar?: boolean;
    /** Extra preference for endpoints over segments (mm) */
    endpointBiasMm?: number;
  } = {},
): MagnetHit {
  const magnetMm = opts.magnetMm ?? WALL_MAGNET_MM;
  const grid = opts.grid ?? 100;
  const endpointBias = opts.endpointBiasMm ?? ENDPOINT_BIAS_MM;

  let bestEnd: MagnetHit | null = null;
  let bestSeg: MagnetHit | null = null;

  const considerEndpoint = (point: Point, wallId: string, d: number, withinMagnet: boolean) => {
    if (withinMagnet && d > magnetMm) return;
    if (!bestEnd || d < bestEnd.strength) {
      bestEnd = { point: { ...point }, kind: 'endpoint', wallId, strength: d };
    }
  };

  for (const wall of walls) {
    if (opts.ignoreWallId && wall.id === opts.ignoreWallId) continue;

    considerEndpoint(wall.a, wall.id, dist(p, wall.a), true);
    considerEndpoint(wall.b, wall.id, dist(p, wall.b), true);

    const hit = projectPointOnSegment(p, wall.a, wall.b);
    if (hit.dist > magnetMm) continue;

    const len = wallLength(wall);
    if (len < 1) continue;
    const alongFromA = hit.t * len;
    const alongFromB = (1 - hit.t) * len;
    const promote = Math.min(END_PROMOTE_MM, Math.max(magnetMm, len * 0.08));

    // Near a tip → butt join to that endpoint (even if tip itself is slightly
    // farther than magnetMm — cursor is already on the wall near the corner).
    if (alongFromA <= promote) {
      considerEndpoint(wall.a, wall.id, Math.min(dist(p, wall.a), hit.dist), false);
      continue;
    }
    if (alongFromB <= promote) {
      considerEndpoint(wall.b, wall.id, Math.min(dist(p, wall.b), hit.dist), false);
      continue;
    }

    if (!bestSeg || hit.dist < bestSeg.strength) {
      bestSeg = {
        point: { ...hit.point },
        kind: 'segment',
        wallId: wall.id,
        strength: hit.dist,
      };
    }
  }

  if (bestEnd && (!bestSeg || bestEnd.strength <= bestSeg.strength + endpointBias)) {
    return bestEnd;
  }
  if (bestSeg) return bestSeg;

  if (opts.freeWhenFar) {
    return { point: { x: p.x, y: p.y }, kind: 'grid', strength: Infinity };
  }
  return { point: snapPoint(p, grid), kind: 'grid', strength: Infinity };
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
