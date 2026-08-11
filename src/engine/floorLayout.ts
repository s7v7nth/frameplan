import { wallLength } from '../domain/geometry';
import type { FloorLevel, Project, Wall } from '../domain/types';

export type SpanAxis = 'x' | 'y';

export interface FloorBayLayout {
  floor: FloorLevel;
  spanAxis: SpanAxis;
  /** Support coordinates along the span axis (mm), sorted */
  supportsMm: number[];
  /** Bay widths in meters */
  baysM: number[];
  maxBayM: number;
  supportCount: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function nearly(a: number, b: number, eps = 80): boolean {
  return Math.abs(a - b) <= eps;
}

function uniqueSorted(values: number[], eps = 80): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || !nearly(out[out.length - 1], v, eps)) out.push(Math.round(v));
  }
  return out;
}

function wallAxis(wall: Wall): 'x' | 'y' | 'skew' {
  const dx = Math.abs(wall.b.x - wall.a.x);
  const dy = Math.abs(wall.b.y - wall.a.y);
  if (dx >= dy * 2.5) return 'x';
  if (dy >= dx * 2.5) return 'y';
  return 'skew';
}

/**
 * Bearing lines for joists spanning in X are walls parallel to Y (constant x).
 * Bearing lines for joists spanning in Y are walls parallel to X (constant y).
 * Interior walls must cover ≥70% of the transverse dimension to count as continuous supports.
 */
function supportCoords(
  walls: Wall[],
  spanAxis: SpanAxis,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): number[] {
  const coords: number[] = [];
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxY - bounds.minY;
  if (spanAxis === 'x') {
    coords.push(bounds.minX, bounds.maxX);
    const needLen = depth * 0.7;
    for (const w of walls) {
      if (wallAxis(w) !== 'y') continue;
      if (wallLength(w) < Math.max(1500, needLen)) continue;
      const x = (w.a.x + w.b.x) / 2;
      if (x > bounds.minX + 200 && x < bounds.maxX - 200) coords.push(x);
    }
  } else {
    coords.push(bounds.minY, bounds.maxY);
    const needLen = width * 0.7;
    for (const w of walls) {
      if (wallAxis(w) !== 'x') continue;
      if (wallLength(w) < Math.max(1500, needLen)) continue;
      const y = (w.a.y + w.b.y) / 2;
      if (y > bounds.minY + 200 && y < bounds.maxY - 200) coords.push(y);
    }
  }
  return uniqueSorted(coords);
}

function baysFromSupports(supports: number[]): number[] {
  const bays: number[] = [];
  for (let i = 0; i < supports.length - 1; i++) {
    bays.push((supports[i + 1] - supports[i]) / 1000);
  }
  return bays;
}

/**
 * Choose joist span direction that minimizes the largest bay between bearing walls
 * (exterior + interior). This is how an 8 m house with a mid partition becomes 2×4 m bays.
 */
export function analyzeFloorBays(project: Project, floor: FloorLevel): FloorBayLayout {
  const exterior = project.walls.filter((w) => w.floor === floor && w.kind === 'exterior');
  const ref =
    exterior.length > 0
      ? exterior
      : floor === 1
        ? project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior')
        : [];
  const allFloorWalls = project.walls.filter(
    (w) => w.floor === floor || (floor === 1 && exterior.length === 0 && w.floor === 0),
  );

  if (ref.length === 0) {
    return {
      floor,
      spanAxis: 'x',
      supportsMm: [0, 0],
      baysM: [0],
      maxBayM: 0,
      supportCount: 0,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }

  const pts = ref.flatMap((w) => [w.a, w.b]);
  const bounds = {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };

  const wallsForSupports = project.walls.filter((w) => w.floor === floor);
  void allFloorWalls;

  const sx = supportCoords(wallsForSupports, 'x', bounds);
  const sy = supportCoords(wallsForSupports, 'y', bounds);
  const baysX = baysFromSupports(sx);
  const baysY = baysFromSupports(sy);
  const maxX = Math.max(...baysX, 0);
  const maxY = Math.max(...baysY, 0);

  // Prefer orientation with smaller max bay; tie-break: fewer bays of similar size → shorter total members
  const spanAxis: SpanAxis = maxX <= maxY ? 'x' : 'y';
  const supportsMm = spanAxis === 'x' ? sx : sy;
  const baysM = spanAxis === 'x' ? baysX : baysY;

  return {
    floor,
    spanAxis,
    supportsMm,
    baysM,
    maxBayM: Math.max(...baysM, 0),
    supportCount: supportsMm.length,
    bounds,
  };
}
