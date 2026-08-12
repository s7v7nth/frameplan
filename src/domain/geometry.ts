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

/** Plan grid step (mm) — always used when not locked to a wall magnet. */
export const GRID_MM = 100;

export function snapPoint(p: Point, grid = GRID_MM): Point {
  return {
    x: Math.round(p.x / grid) * grid,
    y: Math.round(p.y / grid) * grid,
  };
}

/** Tip magnet — enough for thick stroke, not so huge it steals grid drawing. */
export const WALL_MAGNET_MM = 300;
/** Mid-span face (T) magnet. */
export const SEGMENT_MAGNET_MM = 140;
/** Along-wall promote to tip (avoid nesting into body). */
export const END_PROMOTE_MM = 400;
/** Weld shared tips after place. */
export const ENDPOINT_WELD_MM = 120;
/** Soft H/V lock while drafting. */
export const ORTHO_SNAP_MM = 100;

export type MagnetHit = {
  point: Point;
  kind: 'endpoint' | 'segment' | 'grid';
  wallId?: string;
  strength: number;
};

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

function unitAndNormal(a: Point, b: Point): { u: Point; n: Point; len: number } | null {
  const len = dist(a, b);
  if (len < 1) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  return { u, n: { x: -u.y, y: u.x }, len };
}

function lineIntersect(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-8) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}

/**
 * Draft snap: grid is always the baseline; wall magnets override when close.
 * This restores "кратность" so walls can be drawn square/even.
 */
export function resolveDraftSnap(
  p: Point,
  walls: Wall[],
  opts: {
    ignoreWallId?: string;
    from?: Point;
    grid?: number;
  } = {},
): MagnetHit {
  const grid = opts.grid ?? GRID_MM;
  let cursor = { x: p.x, y: p.y };
  if (opts.from) cursor = orthoSnapFrom(opts.from, cursor);
  const gridPt = snapPoint(cursor, grid);

  const best = {
    end: null as MagnetHit | null,
    seg: null as MagnetHit | null,
  };

  for (const wall of walls) {
    if (opts.ignoreWallId && wall.id === opts.ignoreWallId) continue;

    for (const end of [wall.a, wall.b]) {
      const d = dist(cursor, end);
      if (d <= WALL_MAGNET_MM && (!best.end || d < best.end.strength)) {
        best.end = { point: { x: end.x, y: end.y }, kind: 'endpoint', wallId: wall.id, strength: d };
      }
    }

    const hit = projectPointOnSegment(cursor, wall.a, wall.b);
    const len = wallLength(wall);
    if (len < 1) continue;
    const alongA = hit.t * len;
    const alongB = (1 - hit.t) * len;
    const promote = Math.min(END_PROMOTE_MM, len * 0.15);

    // Near tip along wall → tip (for corner nodes), not into the body
    if (hit.dist <= WALL_MAGNET_MM && alongA <= promote) {
      const strength = Math.min(dist(cursor, wall.a), hit.dist);
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
    if (hit.dist <= WALL_MAGNET_MM && alongB <= promote) {
      const strength = Math.min(dist(cursor, wall.b), hit.dist);
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

    if (hit.dist <= SEGMENT_MAGNET_MM && (!best.seg || hit.dist < best.seg.strength)) {
      // Face snap also on grid along the wall when sensible
      const face = snapPoint(hit.point, grid);
      const onSeg = projectPointOnSegment(face, wall.a, wall.b);
      best.seg = {
        point: { x: onSeg.point.x, y: onSeg.point.y },
        kind: 'segment',
        wallId: wall.id,
        strength: hit.dist,
      };
    }
  }

  // Endpoint wins over face when reasonably close; else face; else grid
  if (best.end && (!best.seg || best.end.strength <= best.seg.strength + 80)) {
    return best.end;
  }
  if (best.seg) return best.seg;
  return { point: gridPt, kind: 'grid', strength: dist(p, gridPt) };
}

/** @deprecated use resolveDraftSnap — kept for callers/tests */
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
  return resolveDraftSnap(p, walls, {
    ignoreWallId: opts.ignoreWallId,
    from: opts.from,
    grid: opts.grid,
  });
}

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
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
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
    if (!clusterPoint.has(root)) clusterPoint.set(root, { x: tips[i].x, y: tips[i].y });
  }

  const next = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  for (let i = 0; i < tips.length; i++) {
    const root = find(i);
    if (tips.filter((_, k) => find(k) === root).length < 2) continue;
    const pt = clusterPoint.get(root)!;
    const tip = tips[i];
    const wall = next.find((w) => w.id === tip.wallId);
    if (!wall) continue;
    wall[tip.end] = { x: pt.x, y: pt.y };
  }
  return next;
}

function matesAt(tip: Point, wall: Wall, all: Wall[], eps = 24): Wall[] {
  return all.filter(
    (w) =>
      w.id !== wall.id &&
      w.floor === wall.floor &&
      (dist(w.a, tip) <= eps || dist(w.b, tip) <= eps),
  );
}

/** Centerline guide inset so it does not paint an X through mitered corners. */
export function wallCenterlinePoints(wall: Wall, all: Wall[]): number[] {
  const len = wallLength(wall);
  if (len < 1) return [wall.a.x, wall.a.y, wall.b.x, wall.b.y];
  const u = { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
  const insetA = matesAt(wall.a, wall, all).length ? wall.thickness / 2 : 0;
  const insetB = matesAt(wall.b, wall, all).length ? wall.thickness / 2 : 0;
  if (insetA + insetB >= len - 1) {
    const m = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
    return [m.x, m.y, m.x, m.y];
  }
  return [
    wall.a.x + u.x * insetA,
    wall.a.y + u.y * insetA,
    wall.b.x - u.x * insetB,
    wall.b.y - u.y * insetB,
  ];
}

/**
 * Direction from a shared tip into the wall (away from the tip along the centerline).
 */
function dirFromTip(tip: Point, wall: Wall): Point | null {
  const other = dist(wall.a, tip) <= dist(wall.b, tip) ? wall.b : wall.a;
  const len = dist(tip, other);
  if (len < 1) return null;
  return { x: (other.x - tip.x) / len, y: (other.y - tip.y) / len };
}

/**
 * Filled wall footprint with mitered corners at shared tips.
 * Outer/inner faces meet at one shared outer and one shared inner corner —
 * no overlapping rectangles ("угол на угол").
 *
 * Inner/outer are chosen by the wedge bisector between the two walls (not
 * closest-to-butt, and not left/right-from-a→b — both fail at end B / 90° ties).
 * Then each hit is assigned to this wall's left/right offset by proximity to the butt.
 */
export function wallPolygonPoints(wall: Wall, all: Wall[]): number[] {
  const basis = unitAndNormal(wall.a, wall.b);
  if (!basis) return [];
  const { u, n } = basis;
  const h = wall.thickness / 2;

  const leftLine = { p: { x: wall.a.x + n.x * h, y: wall.a.y + n.y * h }, d: u };
  const rightLine = { p: { x: wall.a.x - n.x * h, y: wall.a.y - n.y * h }, d: u };

  const endPoints = (tip: Point): { left: Point; right: Point } => {
    const mates = matesAt(tip, wall, all);
    const buttLeft = { x: tip.x + n.x * h, y: tip.y + n.y * h };
    const buttRight = { x: tip.x - n.x * h, y: tip.y - n.y * h };
    if (!mates.length) return { left: buttLeft, right: buttRight };

    const along = dirFromTip(tip, wall);
    if (!along) return { left: buttLeft, right: buttRight };

    let best: { score: number; left: Point; right: Point } | null = null;

    for (const mate of mates) {
      const toOther = dirFromTip(tip, mate);
      if (!toOther) continue;
      const cross = along.x * toOther.y - along.y * toOther.x;
      if (Math.abs(cross) < 0.55) continue;

      const mb = unitAndNormal(mate.a, mate.b);
      if (!mb) continue;
      const mh = mate.thickness / 2;
      const mLeft = { p: { x: mate.a.x + mb.n.x * mh, y: mate.a.y + mb.n.y * mh }, d: mb.u };
      const mRight = { p: { x: mate.a.x - mb.n.x * mh, y: mate.a.y - mb.n.y * mh }, d: mb.u };

      const hits = [
        lineIntersect(leftLine.p, leftLine.d, mLeft.p, mLeft.d),
        lineIntersect(leftLine.p, leftLine.d, mRight.p, mRight.d),
        lineIntersect(rightLine.p, rightLine.d, mLeft.p, mLeft.d),
        lineIntersect(rightLine.p, rightLine.d, mRight.p, mRight.d),
      ].filter(Boolean) as Point[];
      if (hits.length < 2) continue;

      // Unit bisector of the wedge between the two rays from the tip → interior
      const bx = along.x + toOther.x;
      const by = along.y + toOther.y;
      const bl = Math.hypot(bx, by) || 1;
      const bisX = bx / bl;
      const bisY = by / bl;

      let inner = hits[0];
      let outer = hits[0];
      let innerDot = -Infinity;
      let outerDot = Infinity;
      for (const hit of hits) {
        const dot = (hit.x - tip.x) * bisX + (hit.y - tip.y) * bisY;
        if (dot > innerDot) {
          innerDot = dot;
          inner = hit;
        }
        if (dot < outerDot) {
          outerDot = dot;
          outer = hit;
        }
      }
      if (inner === outer) continue;

      // Map onto this wall's winding (left/right of a→b), not of tip→along
      const left =
        dist(inner, buttLeft) <= dist(outer, buttLeft) ? inner : outer;
      const right = left === inner ? outer : inner;

      const score = Math.abs(cross);
      if (!best || score > best.score) best = { score, left, right };
    }

    if (!best) return { left: buttLeft, right: buttRight };
    return { left: best.left, right: best.right };
  };

  const A = endPoints(wall.a);
  const B = endPoints(wall.b);
  // Quad: A-left → B-left → B-right → A-right
  return [A.left.x, A.left.y, B.left.x, B.left.y, B.right.x, B.right.y, A.right.x, A.right.y];
}

/** @deprecated — prefer wallPolygonPoints */
export function wallRenderEndpoints(
  wall: Wall,
  all: Wall[],
  eps = 2,
): { a: Point; b: Point } {
  void eps;
  void all;
  return { a: { ...wall.a }, b: { ...wall.b } };
}

export function projectPointOnSegment(
  p: Point,
  a: Point,
  b: Point,
): { point: Point; t: number; dist: number } {
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

export function segmentsCrossProper(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
  eps = 12,
): boolean {
  if (
    nearlySame(a1, b1, eps) ||
    nearlySame(a1, b2, eps) ||
    nearlySame(a2, b1, eps) ||
    nearlySame(a2, b2, eps)
  ) {
    return false;
  }

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
  if (Math.abs(den) < 1e-9) return false;

  const t = ((b1.x - a1.x) * by - (b1.y - a1.y) * bx) / den;
  const u = ((b1.x - a1.x) * ay - (b1.y - a1.y) * ax) / den;
  const margin = 0.02;
  return t > margin && t < 1 - margin && u > margin && u < 1 - margin;
}

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

export function footprintFromWalls(walls: Wall[]): {
  areaM2: number;
  perimeterM: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
} {
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
    const next = Math.hypot(w.a.x - tip.x, w.a.y - tip.y) < 1 ? w.b : w.a;
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

export function volumeM3(
  section: { width: number; depth: number },
  lengthMm: number,
  qty = 1,
): number {
  return (section.width / 1000) * (section.depth / 1000) * (lengthMm / 1000) * qty;
}

export function formatMm(mm: number): string {
  if (mm >= 1000 && mm % 10 === 0) return `${(mm / 1000).toFixed(mm % 100 === 0 ? 1 : 2)} м`;
  return `${Math.round(mm)} мм`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
