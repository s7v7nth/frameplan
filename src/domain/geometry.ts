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

export function projectPointOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { point: { ...a }, t: 0, dist: Math.hypot(p.x - a.x, p.y - a.y) };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) };
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
