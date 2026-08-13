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

/** Base grid when zoom is unknown. Prefer `gridStepForScale`. */
export const GRID_MM = 100;

const GRID_STEPS_MM = [10, 20, 25, 50, 100, 200, 250, 500] as const;

/**
 * Grid step from canvas scale so ~14–18 screen px ≈ one step.
 * Zoom in → finer (10–25 mm); zoom out → coarser (100–500 mm).
 */
export function gridStepForScale(scale: number): number {
  const s = Math.min(0.5, Math.max(0.015, scale));
  const targetMm = 16 / s;
  let best: (typeof GRID_STEPS_MM)[number] = GRID_MM;
  let bestErr = Infinity;
  for (const step of GRID_STEPS_MM) {
    const err = Math.abs(step - targetMm);
    if (err < bestErr) {
      bestErr = err;
      best = step;
    }
  }
  return best;
}

export function snapPoint(p: Point, grid = GRID_MM): Point {
  return {
    x: Math.round(p.x / grid) * grid,
    y: Math.round(p.y / grid) * grid,
  };
}

/**
 * Fallback world-mm magnet radii when scale is unknown (tests / offline).
 * Prefer `magnetRadiiForScale` — CAD tools snap in screen pixels.
 */
export const TIP_MAGNET_MM = 90;
export const TIP_MAGNET_RELEASE_MM = 130;
export const SEGMENT_MAGNET_MM = 170;
export const SEGMENT_MAGNET_RELEASE_MM = 240;
export const ENDFACE_MAGNET_MM = 140;
export const ENDFACE_MAGNET_RELEASE_MM = 200;
/** @deprecated alias — tip engage */
export const WALL_MAGNET_MM = TIP_MAGNET_MM;
export const WALL_MAGNET_RELEASE_MM = TIP_MAGNET_RELEASE_MM;
/** Weld shared tips after place (tip-to-tip only; never collapses butt offsets). */
export const ENDPOINT_WELD_MM = 120;
/** Soft H/V lock while drafting (only when falling back to grid), world-mm fallback. */
export const ORTHO_SNAP_MM = 70;
/** Detect L-corners for butt join within this radius of a tip pair. */
export const BUTT_JOIN_DETECT_MM = 280;

/** Screen-space magnet radii → world mm (zoom-invariant feel, like Planner/CAD). */
export function magnetRadiiForScale(scale?: number): {
  tipEngage: number;
  tipRelease: number;
  faceEngage: number;
  faceRelease: number;
  endfaceEngage: number;
  endfaceRelease: number;
  ortho: number;
} {
  if (scale == null || !Number.isFinite(scale) || scale <= 0) {
    return {
      tipEngage: TIP_MAGNET_MM,
      tipRelease: TIP_MAGNET_RELEASE_MM,
      faceEngage: SEGMENT_MAGNET_MM,
      faceRelease: SEGMENT_MAGNET_RELEASE_MM,
      endfaceEngage: ENDFACE_MAGNET_MM,
      endfaceRelease: ENDFACE_MAGNET_RELEASE_MM,
      ortho: ORTHO_SNAP_MM,
    };
  }
  const s = Math.min(0.5, Math.max(0.015, scale));
  return {
    tipEngage: 12 / s,
    tipRelease: 18 / s,
    faceEngage: 16 / s,
    faceRelease: 24 / s,
    endfaceEngage: 14 / s,
    endfaceRelease: 20 / s,
    ortho: 6 / s, // ~6 screen px soft ortho (Shift-free assist)
  };
}

/**
 * Free-placement snap grid (finer than visual grid).
 * Caps coarse zoom steps so tips don't jump 200 mm per cell.
 */
export function snapGridForScale(scale?: number): number {
  if (scale == null) return GRID_MM;
  const visual = gridStepForScale(scale);
  // Aim ~8 px per step, never coarser than 50 mm while editing tips
  const s = Math.min(0.5, Math.max(0.015, scale));
  const target = 8 / s;
  const steps = [10, 20, 25, 50] as const;
  let best: number = 50;
  let bestErr = Infinity;
  for (const step of steps) {
    const err = Math.abs(step - target);
    if (err < bestErr) {
      bestErr = err;
      best = step;
    }
  }
  return Math.min(visual, best);
}

function roundMm(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export type MagnetKind = 'endpoint' | 'segment' | 'face' | 'endface' | 'grid';

export type MagnetHit = {
  point: Point;
  kind: MagnetKind;
  wallId?: string;
  strength: number;
};

export type WallEdge = { a: Point; b: Point; wallId: string; which: 'face' | 'endface' };

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

/** Long faces at ±thickness/2 from the centerline. */
export function wallFaces(wall: Wall): WallEdge[] {
  const basis = unitAndNormal(wall.a, wall.b);
  if (!basis) return [];
  const { n } = basis;
  const h = wall.thickness / 2;
  return [
    {
      a: { x: wall.a.x + n.x * h, y: wall.a.y + n.y * h },
      b: { x: wall.b.x + n.x * h, y: wall.b.y + n.y * h },
      wallId: wall.id,
      which: 'face',
    },
    {
      a: { x: wall.a.x - n.x * h, y: wall.a.y - n.y * h },
      b: { x: wall.b.x - n.x * h, y: wall.b.y - n.y * h },
      wallId: wall.id,
      which: 'face',
    },
  ];
}

/** Short end faces (торцы) at tips a and b. */
export function wallEndFaces(wall: Wall): WallEdge[] {
  const basis = unitAndNormal(wall.a, wall.b);
  if (!basis) return [];
  const { n } = basis;
  const h = wall.thickness / 2;
  return [
    {
      a: { x: wall.a.x + n.x * h, y: wall.a.y + n.y * h },
      b: { x: wall.a.x - n.x * h, y: wall.a.y - n.y * h },
      wallId: wall.id,
      which: 'endface',
    },
    {
      a: { x: wall.b.x + n.x * h, y: wall.b.y + n.y * h },
      b: { x: wall.b.x - n.x * h, y: wall.b.y - n.y * h },
      wallId: wall.id,
      which: 'endface',
    },
  ];
}

/**
 * Dock point on a host long-face for an L/T butt joint.
 * Near a host tip, insets by selfThickness/2 along the face so centerlines
 * form Planner-style geometry (through length L, butt L−2t).
 * Continuous along the face — never grid-quantized (that caused 200 mm jumps).
 */
function dockPointOnFace(
  raw: Point,
  host: Wall,
  face: WallEdge,
  selfThickness: number,
): Point {
  const hit = projectPointOnSegment(raw, face.a, face.b);
  let pt = hit.point;
  if (selfThickness > 0) {
    const inset = selfThickness / 2;
    const faceLen = dist(face.a, face.b);
    if (faceLen >= 1) {
      const u = { x: (face.b.x - face.a.x) / faceLen, y: (face.b.y - face.a.y) / faceLen };
      for (const tip of [host.a, host.b]) {
        const onFace = projectPointOnSegment(tip, face.a, face.b);
        if (onFace.dist > host.thickness * 0.6) continue;
        if (dist(pt, onFace.point) > Math.max(inset + 80, host.thickness)) continue;
        const fromA = dist(onFace.point, face.a);
        const fromB = dist(onFace.point, face.b);
        pt =
          fromA <= fromB
            ? { x: onFace.point.x + u.x * inset, y: onFace.point.y + u.y * inset }
            : { x: onFace.point.x - u.x * inset, y: onFace.point.y - u.y * inset };
        break;
      }
    }
  }
  return roundMm(pt);
}

function stickyFaceOrEnd(
  raw: Point,
  walls: Wall[],
  prev: MagnetHit,
  opts: {
    ignoreWallId?: string;
    selfThickness: number;
    radii: ReturnType<typeof magnetRadiiForScale>;
  },
): MagnetHit | null {
  if (!prev.wallId) return null;
  const wall = walls.find((w) => w.id === prev.wallId);
  if (!wall || wall.id === opts.ignoreWallId) return null;
  const { radii } = opts;

  if (prev.kind === 'endface') {
    for (const edge of wallEndFaces(wall)) {
      const hit = projectPointOnSegment(raw, edge.a, edge.b);
      if (hit.dist <= radii.endfaceRelease) {
        return {
          point: roundMm(hit.point),
          kind: 'endface',
          wallId: wall.id,
          strength: hit.dist,
        };
      }
    }
    return null;
  }

  if (prev.kind === 'face' || prev.kind === 'segment') {
    for (const edge of wallEndFaces(wall)) {
      const hit = projectPointOnSegment(raw, edge.a, edge.b);
      if (hit.dist <= radii.endfaceEngage) {
        return {
          point: roundMm(hit.point),
          kind: 'endface',
          wallId: wall.id,
          strength: hit.dist,
        };
      }
    }
    for (const edge of wallFaces(wall)) {
      const hit = projectPointOnSegment(raw, edge.a, edge.b);
      if (hit.dist <= radii.faceRelease) {
        const pt = dockPointOnFace(raw, wall, edge, opts.selfThickness);
        return {
          point: pt,
          kind: 'face',
          wallId: wall.id,
          strength: hit.dist,
        };
      }
    }
  }

  if (prev.kind === 'endpoint') {
    const d = dist(raw, prev.point);
    if (d <= radii.tipRelease) {
      return {
        point: { ...prev.point },
        kind: 'endpoint',
        wallId: prev.wallId,
        strength: d,
      };
    }
  }
  return null;
}

/**
 * Draft snap priority (Planner 5D style):
 * 1) торец (endface) — near wall ends
 * 2) грань (face) — T / side dock at ±thickness/2, not centerline
 * 3) tip-to-tip — only when clearly on the tip itself
 * 4) soft ortho + fine snap grid
 */
export function resolveDraftSnap(
  p: Point,
  walls: Wall[],
  opts: {
    ignoreWallId?: string;
    from?: Point;
    grid?: number;
    scale?: number;
    prev?: MagnetHit | null;
    /** Thickness of the wall being drawn/moved — used for L-corner inset on faces. */
    selfThickness?: number;
    /** Soft H/V assist. Default true when `from` is set. */
    ortho?: boolean;
  } = {},
): MagnetHit {
  const radii = magnetRadiiForScale(opts.scale);
  const selfThickness = opts.selfThickness ?? 200;
  const raw = { x: p.x, y: p.y };
  const useOrtho = opts.ortho ?? opts.from != null;

  if (opts.prev && opts.prev.kind !== 'grid') {
    const sticky = stickyFaceOrEnd(raw, walls, opts.prev, {
      ignoreWallId: opts.ignoreWallId,
      selfThickness,
      radii,
    });
    if (sticky) return sticky;
  }

  const best = {
    endface: null as MagnetHit | null,
    face: null as MagnetHit | null,
    end: null as MagnetHit | null,
  };

  for (const wall of walls) {
    if (opts.ignoreWallId && wall.id === opts.ignoreWallId) continue;

    for (const edge of wallEndFaces(wall)) {
      const hit = projectPointOnSegment(raw, edge.a, edge.b);
      if (hit.dist <= radii.endfaceEngage && (!best.endface || hit.dist < best.endface.strength)) {
        best.endface = {
          point: roundMm(hit.point),
          kind: 'endface',
          wallId: wall.id,
          strength: hit.dist,
        };
      }
    }

    for (const edge of wallFaces(wall)) {
      const cl = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
      const faceMid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
      const faceSide = { x: faceMid.x - cl.x, y: faceMid.y - cl.y };
      const tipRel = { x: raw.x - cl.x, y: raw.y - cl.y };
      if (faceSide.x * tipRel.x + faceSide.y * tipRel.y < 0) continue;
      const hit = projectPointOnSegment(raw, edge.a, edge.b);
      if (hit.dist <= radii.faceEngage && (!best.face || hit.dist < best.face.strength)) {
        const pt = dockPointOnFace(raw, wall, edge, selfThickness);
        best.face = {
          point: pt,
          kind: 'face',
          wallId: wall.id,
          strength: hit.dist,
        };
      }
    }

    for (const end of [wall.a, wall.b]) {
      const d = dist(raw, end);
      if (d <= radii.tipEngage && (!best.end || d < best.end.strength)) {
        best.end = { point: { x: end.x, y: end.y }, kind: 'endpoint', wallId: wall.id, strength: d };
      }
    }
  }

  // Face wins mid-span; торец when clearly closer to the end
  if (best.face && best.endface) {
    if (best.face.strength <= best.endface.strength + radii.endfaceEngage * 0.15) return best.face;
    return best.endface;
  }
  if (best.face && (!best.end || best.end.strength > radii.tipEngage * 0.85)) return best.face;
  if (best.endface) return best.endface;
  if (best.end) return best.end;
  if (best.face) return best.face;

  let cursor = raw;
  if (useOrtho && opts.from) cursor = orthoSnapFrom(opts.from, cursor, radii.ortho);
  // Optional explicit grid (tests / callers). Default: continuous 1 mm free motion.
  if (opts.grid != null) {
    const gridPt = snapPoint(cursor, opts.grid);
    return { point: gridPt, kind: 'grid', strength: dist(p, gridPt) };
  }
  const free = roundMm(cursor);
  return { point: free, kind: 'grid', strength: dist(p, free) };
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
    selfThickness?: number;
  } = {},
): MagnetHit {
  return resolveDraftSnap(p, walls, {
    ignoreWallId: opts.ignoreWallId,
    from: opts.from,
    grid: opts.grid,
    selfThickness: opts.selfThickness,
  });
}

/** Stable through-wall pick: longer → more horizontal (when equal) → exterior → lower id. */
export function isThroughWall(candidate: Wall, other: Wall): boolean {
  const lenC = wallLength(candidate);
  const lenO = wallLength(other);
  if (Math.abs(lenC - lenO) > 50) return lenC > lenO;
  const horizC = Math.abs(candidate.b.x - candidate.a.x) >= Math.abs(candidate.b.y - candidate.a.y);
  const horizO = Math.abs(other.b.x - other.a.x) >= Math.abs(other.b.y - other.a.y);
  if (horizC !== horizO) return horizC;
  if (candidate.kind !== other.kind) return candidate.kind === 'exterior';
  return candidate.id <= other.id;
}

/**
 * Direction from a tip into the wall (away from the tip along the centerline).
 */
function dirFromTip(tip: Point, wall: Wall): Point | null {
  const other = dist(wall.a, tip) <= dist(wall.b, tip) ? wall.b : wall.a;
  const len = dist(tip, other);
  if (len < 1) return null;
  return { x: (other.x - tip.x) / len, y: (other.y - tip.y) / len };
}

function tipsNearlyCoincident(a: Point, b: Point, mm = BUTT_JOIN_DETECT_MM): boolean {
  return dist(a, b) <= mm;
}

/**
 * Planner-style L-butt join.
 * By default may adjust any wall. Pass `mutableWallIds` to only rewrite those
 * walls (hosts stay put) — used while dragging so opposite walls do not warp.
 */
export function applyButtJoins(
  walls: Wall[],
  floor: number,
  opts: { mutableWallIds?: string[] } = {},
): Wall[] {
  const next = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  const floorWalls = next.filter((w) => w.floor === floor);
  const mutable = opts.mutableWallIds ? new Set(opts.mutableWallIds) : null;
  const canMutate = (id: string) => !mutable || mutable.has(id);

  type Corner = {
    throughId: string;
    throughEnd: 'a' | 'b';
    buttId: string;
    buttEnd: 'a' | 'b';
    alongThrough: Point;
    alongButt: Point;
    corner: Point;
  };
  const corners: Corner[] = [];

  for (let i = 0; i < floorWalls.length; i++) {
    for (let j = i + 1; j < floorWalls.length; j++) {
      const w0 = floorWalls[i];
      const w1 = floorWalls[j];
      for (const e0 of ['a', 'b'] as const) {
        for (const e1 of ['a', 'b'] as const) {
          const t0 = w0[e0];
          const t1 = w1[e1];
          if (!tipsNearlyCoincident(t0, t1)) continue;
          const d0 = dirFromTip(t0, w0);
          const d1 = dirFromTip(t1, w1);
          if (!d0 || !d1) continue;
          const cross = d0.x * d1.y - d0.y * d1.x;
          if (Math.abs(cross) < 0.55) continue;
          const throughIs0 = isThroughWall(w0, w1);
          const through = throughIs0 ? w0 : w1;
          const butt = throughIs0 ? w1 : w0;
          const throughEnd = throughIs0 ? e0 : e1;
          const buttEnd = throughIs0 ? e1 : e0;
          const alongThrough = throughIs0 ? d0 : d1;
          const alongButt = throughIs0 ? d1 : d0;
          const corner = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };
          corners.push({
            throughId: through.id,
            throughEnd,
            buttId: butt.id,
            buttEnd,
            alongThrough,
            alongButt,
            corner,
          });
        }
      }
    }
  }

  // Lateral shift of through walls — only when mutable and not already docked
  const throughShift = new Map<string, Point>();
  const throughShiftN = new Map<string, number>();
  const actuallyShifted = new Set<string>();
  for (const c of corners) {
    if (!canMutate(c.throughId)) continue;
    const through = next.find((w) => w.id === c.throughId)!;
    const half = through.thickness / 2;
    const sh = { x: c.alongButt.x * half, y: c.alongButt.y * half };
    const prev = throughShift.get(c.throughId) ?? { x: 0, y: 0 };
    throughShift.set(c.throughId, { x: prev.x + sh.x, y: prev.y + sh.y });
    throughShiftN.set(c.throughId, (throughShiftN.get(c.throughId) ?? 0) + 1);
  }
  for (const [id, sum] of throughShift) {
    const n = throughShiftN.get(id) ?? 1;
    const avg = { x: sum.x / n, y: sum.y / n };
    const w = next.find((x) => x.id === id);
    if (!w) continue;
    const sample = corners.find((c) => c.throughId === id);
    if (sample) {
      const butt = next.find((x) => x.id === sample.buttId);
      if (butt) {
        const tip = butt[sample.buttEnd];
        const faceDist = Math.min(
          ...wallFaces(w).map((f) => projectPointOnSegment(tip, f.a, f.b).dist),
        );
        if (faceDist < 8 && dist(tip, w[sample.throughEnd]) > w.thickness * 0.4) {
          continue;
        }
      }
    }
    w.a = { x: w.a.x + avg.x, y: w.a.y + avg.y };
    w.b = { x: w.b.x + avg.x, y: w.b.y + avg.y };
    actuallyShifted.add(id);
  }

  // Place butt tips on through faces — only mutable butt walls
  for (const c of corners) {
    if (!canMutate(c.buttId)) continue;
    const through = next.find((w) => w.id === c.throughId);
    const butt = next.find((w) => w.id === c.buttId);
    if (!through || !butt) continue;

    const throughTip = through[c.throughEnd];
    const alongButt = c.alongButt;
    const alongThrough = dirFromTip(throughTip, through) ?? c.alongThrough;
    const throughShifted = actuallyShifted.has(c.throughId);

    let dockFull: Point;
    if (throughShifted) {
      const preShiftCorner = {
        x: throughTip.x - alongButt.x * (through.thickness / 2),
        y: throughTip.y - alongButt.y * (through.thickness / 2),
      };
      dockFull = {
        x:
          preShiftCorner.x +
          alongButt.x * through.thickness +
          alongThrough.x * (butt.thickness / 2),
        y:
          preShiftCorner.y +
          alongButt.y * through.thickness +
          alongThrough.y * (butt.thickness / 2),
      };
    } else {
      // Host locked: dock onto current face near tip (do not invent a through shift)
      dockFull = {
        x:
          throughTip.x +
          alongButt.x * (through.thickness / 2) +
          alongThrough.x * (butt.thickness / 2),
        y:
          throughTip.y +
          alongButt.y * (through.thickness / 2) +
          alongThrough.y * (butt.thickness / 2),
      };
    }
    butt[c.buttEnd] = { x: Math.round(dockFull.x), y: Math.round(dockFull.y) };
  }

  return next;
}

/**
 * Tip-to-tip weld only. Skips pairs that look like Planner butt docks
 * (separated by ~thickness along a face).
 * When `mutableWallIds` is set, only those walls' tips are rewritten
 * (hosts stay put — CAD-style commit of the edited wall).
 */
export function weldWallEndpoints(
  walls: Wall[],
  floor: number,
  weldMm = ENDPOINT_WELD_MM,
  opts: { mutableWallIds?: string[] } = {},
): Wall[] {
  type Tip = { wallId: string; end: 'a' | 'b'; x: number; y: number };
  const tips: Tip[] = [];
  const byId = new Map(walls.map((w) => [w.id, w]));
  const mutable = opts.mutableWallIds ? new Set(opts.mutableWallIds) : null;
  const canMutate = (id: string) => !mutable || mutable.has(id);

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

  const isButtOffsetPair = (i: number, j: number): boolean => {
    const w0 = byId.get(tips[i].wallId);
    const w1 = byId.get(tips[j].wallId);
    if (!w0 || !w1) return false;
    const d = dist(tips[i], tips[j]);
    if (d < 1) return false;
    const minT = Math.min(w0.thickness, w1.thickness);
    const maxT = Math.max(w0.thickness, w1.thickness);
    if (d < minT * 0.4 || d > maxT * 1.65) return false;
    const d0 = dirFromTip(tips[i], w0);
    const d1 = dirFromTip(tips[j], w1);
    if (!d0 || !d1) return false;
    const cross = Math.abs(d0.x * d1.y - d0.y * d1.x);
    if (cross < 0.55) return false;
    const t0on1 = wallFaces(w1).some(
      (f) => projectPointOnSegment(tips[i], f.a, f.b).dist <= 16,
    );
    const t1on0 = wallFaces(w0).some(
      (f) => projectPointOnSegment(tips[j], f.a, f.b).dist <= 16,
    );
    return t0on1 || t1on0;
  };

  for (let i = 0; i < tips.length; i++) {
    for (let j = i + 1; j < tips.length; j++) {
      if (tips[i].wallId === tips[j].wallId) continue;
      if (dist(tips[i], tips[j]) > weldMm) continue;
      if (isButtOffsetPair(i, j)) continue;
      unite(i, j);
    }
  }

  const clusterPoint = new Map<number, Point>();
  for (let i = 0; i < tips.length; i++) {
    const root = find(i);
    if (!clusterPoint.has(root)) {
      // Prefer an immutable tip as the weld target so hosts stay put
      const members = tips.map((t, k) => ({ t, k })).filter(({ k }) => find(k) === root);
      const host = members.find(({ t }) => !canMutate(t.wallId));
      const anchor = host?.t ?? tips[i];
      clusterPoint.set(root, { x: anchor.x, y: anchor.y });
    }
  }

  const next = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  for (let i = 0; i < tips.length; i++) {
    if (!canMutate(tips[i].wallId)) continue;
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

/** Join L-corners into Planner butt geometry, then tip-weld remaining coincidences. */
export function finalizeWallJoins(
  walls: Wall[],
  floor: number,
  opts: { mutableWallIds?: string[] } = {},
): Wall[] {
  return weldWallEndpoints(applyButtJoins(walls, floor, opts), floor, ENDPOINT_WELD_MM, opts);
}

/**
 * CAD-style endpoint commit: only adjust the dragged tip.
 * - tip-to-tip: snap this tip onto a nearby host tip
 * - face dock: project this tip onto the nearest host face (with L inset)
 * Never lateral-shifts the whole wall or rewrites other walls.
 */
export function commitEndpointJoin(
  walls: Wall[],
  floor: number,
  wallId: string,
  end: 'a' | 'b',
): Wall[] {
  const next = walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));
  const wall = next.find((w) => w.id === wallId && w.floor === floor);
  if (!wall) return walls;
  const tip = wall[end];
  const others = next.filter((w) => w.floor === floor && w.id !== wallId);

  // Prefer tip-to-tip weld onto a host tip
  let bestTip: { point: Point; d: number } | null = null;
  for (const host of others) {
    for (const hostEnd of [host.a, host.b]) {
      const d = dist(tip, hostEnd);
      if (d <= ENDPOINT_WELD_MM && (!bestTip || d < bestTip.d)) {
        // Skip Planner butt offsets (already docked on a face)
        const onFace = wallFaces(host).some((f) => projectPointOnSegment(tip, f.a, f.b).dist <= 16);
        const dHost = dirFromTip(hostEnd, host);
        const dSelf = dirFromTip(tip, wall);
        if (onFace && dHost && dSelf) {
          const cross = Math.abs(dHost.x * dSelf.y - dHost.y * dSelf.x);
          if (cross > 0.55 && d > Math.min(host.thickness, wall.thickness) * 0.4) continue;
        }
        bestTip = { point: { ...hostEnd }, d };
      }
    }
  }
  if (bestTip) {
    wall[end] = roundMm(bestTip.point);
    return next;
  }

  // Else dock onto nearest face if close enough
  let bestFace: { point: Point; d: number } | null = null;
  for (const host of others) {
    for (const face of wallFaces(host)) {
      const hit = projectPointOnSegment(tip, face.a, face.b);
      if (hit.dist > host.thickness * 0.75 + 40) continue;
      const pt = dockPointOnFace(tip, host, face, wall.thickness);
      const d = dist(tip, pt);
      if (!bestFace || d < bestFace.d) bestFace = { point: pt, d };
    }
  }
  if (bestFace && bestFace.d < wall.thickness + 80) {
    wall[end] = bestFace.point;
  }
  return next;
}

/**
 * Rigid translation snap for whole-wall drag.
 * Keeps orientation/length; only adjusts dx/dy. Prefers the face on the approach
 * side and ignores distant opposite walls (no yank across the room).
 */
export function resolveTranslateSnap(
  wall: Wall,
  dx: number,
  dy: number,
  others: Wall[],
  opts: { scale?: number; grid?: number } = {},
): { dx: number; dy: number; kind: MagnetKind; ok: boolean } {
  const radii = magnetRadiiForScale(opts.scale);
  const dragLen = Math.hypot(dx, dy);
  const dragU = dragLen > 1 ? { x: dx / dragLen, y: dy / dragLen } : { x: 0, y: 0 };

  // Base: continuous translation (1 mm). Magnets override when near hosts.
  let adx = Math.round(dx);
  let ady = Math.round(dy);

  type Cand = { dx: number; dy: number; dist: number; kind: MagnetKind };
  const cands: Cand[] = [];

  for (const end of ['a', 'b'] as const) {
    const tip = { x: wall[end].x + adx, y: wall[end].y + ady };
    for (const host of others) {
      const basis = unitAndNormal(host.a, host.b);
      if (!basis) continue;
      for (const face of wallFaces(host)) {
        const cl = { x: (host.a.x + host.b.x) / 2, y: (host.a.y + host.b.y) / 2 };
        const faceMid = { x: (face.a.x + face.b.x) / 2, y: (face.a.y + face.b.y) / 2 };
        const faceSide = { x: faceMid.x - cl.x, y: faceMid.y - cl.y };
        const tipRel = { x: tip.x - cl.x, y: tip.y - cl.y };
        if (faceSide.x * tipRel.x + faceSide.y * tipRel.y < 0) continue;

        const hit = projectPointOnSegment(tip, face.a, face.b);
        if (hit.dist > radii.faceEngage) continue;
        const wallBasis = unitAndNormal(wall.a, wall.b);
        if (!wallBasis) continue;
        const alongDot = Math.abs(wallBasis.u.x * basis.u.x + wallBasis.u.y * basis.u.y);
        const parallel = alongDot > 0.92;
        const ortho = alongDot < 0.35;
        if (!parallel && !ortho) continue;

        const tdx = hit.point.x - wall[end].x;
        const tdy = hit.point.y - wall[end].y;
        if (dragLen > 20 && tdx * dragU.x + tdy * dragU.y < -40) continue;
        cands.push({ dx: tdx, dy: tdy, dist: hit.dist, kind: 'face' });
      }

      for (const edge of wallEndFaces(host)) {
        const hit = projectPointOnSegment(tip, edge.a, edge.b);
        if (hit.dist > radii.endfaceEngage) continue;
        const hostTip = dist(edge.a, host.a) < dist(edge.a, host.b) ? host.a : host.b;
        const outward = dirFromTip(hostTip, host);
        if (outward) {
          const rel = { x: tip.x - hostTip.x, y: tip.y - hostTip.y };
          if (rel.x * -outward.x + rel.y * -outward.y < -20) continue;
        }
        const tdx = hit.point.x - wall[end].x;
        const tdy = hit.point.y - wall[end].y;
        if (dragLen > 20 && tdx * dragU.x + tdy * dragU.y < -40) continue;
        cands.push({ dx: tdx, dy: tdy, dist: hit.dist, kind: 'endface' });
      }
    }
  }

  let kind: MagnetKind = 'grid';
  if (cands.length) {
    cands.sort((a, b) => a.dist - b.dist);
    adx = Math.round(cands[0].dx);
    ady = Math.round(cands[0].dy);
    kind = cands[0].kind;
  }

  const nextA = { x: wall.a.x + adx, y: wall.a.y + ady };
  const nextB = { x: wall.b.x + adx, y: wall.b.y + ady };
  const ok = !wallSegmentCollides(nextA, nextB, others);
  return { dx: adx, dy: ady, kind, ok };
}

/** Right-angle markers at L-corners (~90°) for canvas feedback. */
export function orthoCornerMarkers(
  walls: Wall[],
  floor: number,
): { x: number; y: number; angle: number; size: number }[] {
  const out: { x: number; y: number; angle: number; size: number }[] = [];
  const floorWalls = walls.filter((w) => w.floor === floor);
  const seen = new Set<string>();

  for (let i = 0; i < floorWalls.length; i++) {
    for (let j = i + 1; j < floorWalls.length; j++) {
      const w0 = floorWalls[i];
      const w1 = floorWalls[j];
      const b0 = unitAndNormal(w0.a, w0.b);
      const b1 = unitAndNormal(w1.a, w1.b);
      if (!b0 || !b1) continue;
      const dot = Math.abs(b0.u.x * b1.u.x + b0.u.y * b1.u.y);
      if (dot > 0.2) continue; // not ~perpendicular

      for (const e0 of ['a', 'b'] as const) {
        for (const e1 of ['a', 'b'] as const) {
          const t0 = w0[e0];
          const t1 = w1[e1];
          const dTips = dist(t0, t1);
          const onFace =
            wallFaces(w0).some((f) => projectPointOnSegment(t1, f.a, f.b).dist <= 20) ||
            wallFaces(w1).some((f) => projectPointOnSegment(t0, f.a, f.b).dist <= 20);
          if (dTips > Math.max(w0.thickness, w1.thickness) * 1.6 + 40 && !onFace) continue;

          const key = [w0.id, e0, w1.id, e1].sort().join(':');
          if (seen.has(key)) continue;
          seen.add(key);

          const d0 = dirFromTip(t0, w0);
          const d1 = dirFromTip(t1, w1);
          if (!d0 || !d1) continue;
          // Outer corner bisector for placing the square
          const ox = -(d0.x + d1.x);
          const oy = -(d0.y + d1.y);
          const olen = Math.hypot(ox, oy) || 1;
          const size = Math.min(w0.thickness, w1.thickness) * 0.55;
          const cx = (t0.x + t1.x) / 2 + (ox / olen) * (size * 0.15);
          const cy = (t0.y + t1.y) / 2 + (oy / olen) * (size * 0.15);
          const angle = Math.atan2(d0.y, d0.x);
          out.push({ x: cx, y: cy, angle, size });
        }
      }
    }
  }
  return out;
}

/** Draft-time ortho indicator at the start tip when the segment is H/V locked. */
export function draftOrthoMarker(
  from: Point,
  to: Point,
  thresholdMm = ORTHO_SNAP_MM,
): { x: number; y: number; angle: number; size: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 200) return null;
  const ortho =
    (Math.abs(dx) <= thresholdMm && Math.abs(dy) > thresholdMm) ||
    (Math.abs(dy) <= thresholdMm && Math.abs(dx) > thresholdMm) ||
    Math.min(Math.abs(dx), Math.abs(dy)) / Math.max(Math.abs(dx), Math.abs(dy)) < 0.08;
  if (!ortho) return null;
  const angle = Math.abs(dx) >= Math.abs(dy) ? 0 : Math.PI / 2;
  return { x: from.x, y: from.y, angle, size: 180 };
}

/**
 * Mates at a tip: shared tip OR tip docked on the other wall's face/endface.
 */
function matesAt(tip: Point, wall: Wall, all: Wall[], eps = 24): Wall[] {
  return all.filter((w) => {
    if (w.id === wall.id || w.floor !== wall.floor) return false;
    if (dist(w.a, tip) <= eps || dist(w.b, tip) <= eps) return true;
    const faceEps = Math.max(eps, w.thickness * 0.55 + 8);
    for (const edge of [...wallFaces(w), ...wallEndFaces(w)]) {
      if (projectPointOnSegment(tip, edge.a, edge.b).dist <= faceEps) return true;
    }
    // Other tip near our face
    for (const otherTip of [w.a, w.b]) {
      for (const edge of [...wallFaces(wall), ...wallEndFaces(wall)]) {
        if (projectPointOnSegment(otherTip, edge.a, edge.b).dist <= faceEps) return true;
      }
    }
    return false;
  });
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
 * Filled wall footprint. When tips already dock on a mate face (Planner butt),
 * ends stay square. Shared-tip L-corners still get through+butt extend.
 */
export function wallPolygonPoints(wall: Wall, all: Wall[]): number[] {
  const basis = unitAndNormal(wall.a, wall.b);
  if (!basis) return [];
  const { n } = basis;
  const h = wall.thickness / 2;

  const tipOnMateFace = (tip: Point, mate: Wall): boolean => {
    return wallFaces(mate).some((f) => projectPointOnSegment(tip, f.a, f.b).dist <= 16);
  };

  const endPoints = (tip: Point): { left: Point; right: Point } => {
    const mates = matesAt(tip, wall, all);
    const buttLeft = { x: tip.x + n.x * h, y: tip.y + n.y * h };
    const buttRight = { x: tip.x - n.x * h, y: tip.y - n.y * h };
    if (!mates.length) return { left: buttLeft, right: buttRight };

    // Already docked on a face — square end (true butt geometry)
    if (mates.some((m) => tipOnMateFace(tip, m))) {
      return { left: buttLeft, right: buttRight };
    }

    const along = dirFromTip(tip, wall);
    if (!along) return { left: buttLeft, right: buttRight };

    let best: { score: number; left: Point; right: Point } | null = null;

    for (const mate of mates) {
      const mateTip = dist(mate.a, tip) <= dist(mate.b, tip) ? mate.a : mate.b;
      // Only apply legacy through-extend when tips still share a point
      if (dist(mateTip, tip) > 24) continue;
      const toOther = dirFromTip(tip, mate);
      if (!toOther) continue;
      const cross = along.x * toOther.y - along.y * toOther.x;
      if (Math.abs(cross) < 0.55) continue;

      const mh = mate.thickness / 2;
      const through = isThroughWall(wall, mate);
      let end: Point;
      if (through) {
        end = { x: tip.x - along.x * mh, y: tip.y - along.y * mh };
      } else {
        end = { x: tip.x + along.x * mh, y: tip.y + along.y * mh };
      }
      const left = { x: end.x + n.x * h, y: end.y + n.y * h };
      const right = { x: end.x - n.x * h, y: end.y - n.y * h };
      const score = Math.abs(cross);
      if (!best || score > best.score) best = { score, left, right };
    }

    if (!best) return { left: buttLeft, right: buttRight };
    return { left: best.left, right: best.right };
  };

  const A = endPoints(wall.a);
  const B = endPoints(wall.b);
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
