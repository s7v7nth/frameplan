import type { FloorLevel, Point, Project, Wall } from './types';
import { dist, wallLength } from './geometry';

const NODE_EPS = 25;

export interface Room {
  id: string;
  floor: FloorLevel;
  label: string;
  areaM2: number;
  centroid: Point;
  polygon: Point[];
}

function keyOf(p: Point): string {
  return `${Math.round(p.x / NODE_EPS) * NODE_EPS},${Math.round(p.y / NODE_EPS) * NODE_EPS}`;
}

function parseKey(k: string): Point {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
}

function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2 / 1_000_000;
}

function centroid(poly: Point[]): Point {
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  const n = poly.length || 1;
  return { x: cx / n, y: cy / n };
}

/**
 * Detect rooms as minimal faces of the wall planar graph on a floor.
 * Exterior face (largest area) is excluded; remaining faces are rooms.
 */
export function detectRooms(project: Project, floor: FloorLevel): Room[] {
  const walls = project.walls.filter((w) => w.floor === floor);
  if (walls.length < 3) return [];

  // Adjacency: undirected edges between snapped nodes
  type Edge = { a: string; b: string; wall: Wall };
  const edges: Edge[] = [];
  const adj = new Map<string, { to: string; wall: Wall }[]>();

  const addAdj = (from: string, to: string, wall: Wall) => {
    const list = adj.get(from) ?? [];
    list.push({ to, wall });
    adj.set(from, list);
  };

  for (const wall of walls) {
    if (wallLength(wall) < 50) continue;
    const a = keyOf(wall.a);
    const b = keyOf(wall.b);
    if (a === b) continue;
    edges.push({ a, b, wall });
    addAdj(a, b, wall);
    addAdj(b, a, wall);
  }

  // Sort neighbors by polar angle for left-most turn face walk
  for (const [node, neigh] of adj) {
    const origin = parseKey(node);
    neigh.sort((u, v) => {
      const pu = parseKey(u.to);
      const pv = parseKey(v.to);
      return (
        Math.atan2(pu.y - origin.y, pu.x - origin.x) -
        Math.atan2(pv.y - origin.y, pv.x - origin.x)
      );
    });
    adj.set(node, neigh);
  }

  const used = new Set<string>(); // directed edge key a->b
  const faces: Point[][] = [];

  const edgeKey = (a: string, b: string) => `${a}>${b}`;

  for (const e of edges) {
    for (const [start, end] of [
      [e.a, e.b],
      [e.b, e.a],
    ] as const) {
      const startKey = edgeKey(start, end);
      if (used.has(startKey)) continue;

      const polyKeys: string[] = [start];
      let prev = start;
      let curr = end;
      let guard = 0;
      let closed = false;
      used.add(startKey);

      while (guard++ < 500) {
        polyKeys.push(curr);
        const neigh = adj.get(curr) ?? [];
        if (neigh.length === 0) break;

        // Incoming direction: from prev to curr. Take next CW neighbor (right-hand rule).
        const incomingAngle = Math.atan2(
          parseKey(prev).y - parseKey(curr).y,
          parseKey(prev).x - parseKey(curr).x,
        );
        let bestIdx = -1;
        let bestDelta = Infinity;
        for (let i = 0; i < neigh.length; i++) {
          if (neigh[i].to === prev && neigh.length > 1) continue;
          const n = parseKey(neigh[i].to);
          const ang = Math.atan2(n.y - parseKey(curr).y, n.x - parseKey(curr).x);
          let delta = ang - incomingAngle;
          while (delta <= 1e-9) delta += Math.PI * 2;
          while (delta > Math.PI * 2) delta -= Math.PI * 2;
          if (delta < bestDelta) {
            bestDelta = delta;
            bestIdx = i;
          }
        }
        if (bestIdx < 0) break;
        const next = neigh[bestIdx].to;
        const dk = edgeKey(curr, next);
        if (used.has(dk) && next === start) {
          closed = true;
          break;
        }
        if (used.has(dk)) break;
        used.add(dk);
        prev = curr;
        curr = next;
        if (curr === start) {
          closed = true;
          break;
        }
      }

      if (closed && polyKeys.length >= 3) {
        // Drop duplicate closing key if present
        const unique =
          polyKeys[polyKeys.length - 1] === polyKeys[0]
            ? polyKeys.slice(0, -1)
            : polyKeys;
        if (unique.length >= 3) {
          faces.push(unique.map(parseKey));
        }
      }
    }
  }

  // Deduplicate faces by sorted key set + area
  const uniq: { poly: Point[]; area: number }[] = [];
  const seen = new Set<string>();
  for (const poly of faces) {
    const area = polygonArea(poly);
    if (area < 0.5) continue; // ignore tiny loops
    const sig = [...poly.map(keyOf)].sort().join('|') + `@${area.toFixed(2)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    uniq.push({ poly, area });
  }

  if (uniq.length === 0) return [];

  // Largest face is usually exterior (outer boundary walk); drop it if multiple
  uniq.sort((a, b) => b.area - a.area);
  const roomsSrc = uniq.length > 1 ? uniq.slice(1) : uniq;

  // Prefer rooms clearly inside footprint: drop if centroid outside exterior bbox loosely
  const exterior = walls.filter((w) => w.kind === 'exterior');
  const pts = exterior.flatMap((w) => [w.a, w.b]);
  let rooms = roomsSrc;
  if (pts.length) {
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));
    rooms = roomsSrc.filter((r) => {
      const c = centroid(r.poly);
      return c.x >= minX - 50 && c.x <= maxX + 50 && c.y >= minY - 50 && c.y <= maxY + 50;
    });
  }

  return rooms.map((r, i) => ({
    id: `room_${floor}_${i}`,
    floor,
    label: `Пом. ${i + 1}`,
    areaM2: r.area,
    centroid: centroid(r.poly),
    polygon: r.poly,
  }));
}

export function detectAllRooms(project: Project): Room[] {
  const floors: FloorLevel[] =
    project.settings.floors === 2 ? [0, 1] : [0];
  return floors.flatMap((f) => detectRooms(project, f));
}

/** True if exterior walls on floor form a nearly closed loop. */
export function exteriorLoopClosed(walls: Wall[], eps = 40): boolean {
  const exterior = walls.filter((w) => w.kind === 'exterior');
  if (exterior.length < 3) return false;
  const degree = new Map<string, number>();
  for (const w of exterior) {
    for (const p of [w.a, w.b]) {
      const k = keyOf(p);
      degree.set(k, (degree.get(k) ?? 0) + 1);
    }
  }
  // Every node should have even degree (ideally 2) for a closed loop
  for (const [, d] of degree) {
    if (d % 2 !== 0) return false;
  }
  // Also check we can walk a cycle covering all edges
  const remaining = [...exterior];
  let tip = remaining[0].b;
  let current = remaining.shift()!;
  const start = keyOf(current.a);
  let guard = 0;
  while (remaining.length && guard++ < 200) {
    const idx = remaining.findIndex(
      (w) => dist(w.a, tip) < eps || dist(w.b, tip) < eps,
    );
    if (idx < 0) return false;
    const w = remaining.splice(idx, 1)[0];
    tip = dist(w.a, tip) < eps ? w.b : w.a;
  }
  return remaining.length === 0 && dist(tip, parseKey(start)) < eps;
}
