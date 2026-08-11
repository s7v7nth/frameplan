import { pointAlongWall, uid, wallAngle, wallLength } from '../domain/geometry';
import type {
  FloorLevel,
  FrameMember,
  LumberPiece,
  Opening,
  Point,
  Project,
  ProjectSettings,
  Wall,
} from '../domain/types';

function openingsOnWall(openings: Opening[], wallId: string): Opening[] {
  return openings
    .filter((o) => o.wallId === wallId)
    .sort((a, b) => a.offset - b.offset);
}

function dir(wall: Wall): Point {
  const len = wallLength(wall);
  if (len === 0) return { x: 1, y: 0 };
  return { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
}

function normal(wall: Wall): Point {
  const d = dir(wall);
  return { x: -d.y, y: d.x };
}

function along(wall: Wall, s: number): Point {
  return pointAlongWall(wall, s);
}

function pushMember(
  members: FrameMember[],
  lumber: LumberPiece[],
  partial: Omit<FrameMember, 'id'>,
) {
  const id = uid('fm');
  members.push({ id, ...partial });
  lumber.push({
    id: uid('lum'),
    category: partial.kind,
    label: partial.label,
    sectionMm: partial.sectionMm,
    lengthMm: partial.lengthMm,
    floor: partial.floor,
    wallId: partial.wallId,
    qty: 1,
  });
}

function plateSegment(wall: Wall, s0: number, s1: number, offsetN: number): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const n = normal(wall);
  const p0 = along(wall, s0);
  const p1 = along(wall, s1);
  return {
    x1: p0.x + n.x * offsetN,
    y1: p0.y + n.y * offsetN,
    x2: p1.x + n.x * offsetN,
    y2: p1.y + n.y * offsetN,
  };
}

/** Full wall framing members with plan + elevation geometry (SP 31-105 §7.2). */
export function buildWallMembers(
  wall: Wall,
  openings: Opening[],
  settings: ProjectSettings,
  members: FrameMember[],
  lumber: LumberPiece[],
  skipEndStuds: { start: boolean; end: boolean } = { start: false, end: false },
) {
  const len = Math.round(wallLength(wall));
  if (len < 50) return;

  const wallOpenings = openingsOnWall(openings, wall.id);
  const H = wall.height || settings.floorHeightMm;
  const section = settings.studSectionMm;
  const tw = section.width; // stud thickness along wall
  const td = section.depth;
  const spacing = settings.studSpacingMm;
  const bottomH = Math.max(38, Math.min(td, 50));
  const topPly = Math.max(38, Math.min(td, 50));
  const topPlies = 2;
  const topH = topPly * topPlies;
  const ang = wallAngle(wall);

  // Bottom plate — same section as studs (laid flat)
  pushMember(members, lumber, {
    kind: 'bottom_plate',
    label: 'Нижняя обвязка',
    sectionMm: section,
    lengthMm: len,
    floor: wall.floor,
    wallId: wall.id,
    plan: plateSegment(wall, 0, len, 0),
    elev: { s0: 0, s1: len, z0: 0, z1: bottomH },
  });

  // Double top plate
  for (let ply = 0; ply < topPlies; ply++) {
    pushMember(members, lumber, {
      kind: 'top_plate',
      label: ply === 0 ? 'Верхняя обвязка (нижняя доска)' : 'Верхняя обвязка (верхняя доска)',
      sectionMm: section,
      lengthMm: len,
      floor: wall.floor,
      wallId: wall.id,
      plan: plateSegment(wall, 0, len, ply === 0 ? -8 : 8),
      elev: {
        s0: 0,
        s1: len,
        z0: H - topH + ply * topPly,
        z1: H - topH + (ply + 1) * topPly,
      },
    });
  }

  type Occ = { s0: number; s1: number };
  const blocked: Occ[] = [];

  const addStud = (
    kind: FrameMember['kind'],
    label: string,
    s: number,
    z0: number,
    z1: number,
  ) => {
    const clamped = Math.max(0, Math.min(len - tw, s));
    const p = along(wall, clamped + tw / 2);
    pushMember(members, lumber, {
      kind,
      label,
      sectionMm: section,
      lengthMm: Math.max(50, z1 - z0),
      floor: wall.floor,
      wallId: wall.id,
      planMark: { x: p.x, y: p.y, angle: ang },
      elev: { s0: clamped, s1: clamped + tw, z0, z1 },
    });
  };

  for (const o of wallOpenings) {
    // Opening rough width between jack inner faces
    const openL = Math.max(0, Math.round(o.offset));
    const openR = Math.min(len, Math.round(o.offset + o.width));
    // Layout along wall: [king][jack][ opening ][jack][king]
    const jackL = openL;
    const jackR = openR - tw;
    const kingL = Math.max(0, jackL - tw);
    const kingR = Math.min(len - tw, jackR + tw);

    const headerDepth = o.width > 1500 ? 250 : o.width > 900 ? 200 : 150;
    // Header underside = top of rough opening
    const headerBottom = o.type === 'door' ? o.height : o.sillHeight + o.height;
    const headerTop = Math.min(H - topH, headerBottom + headerDepth);
    // Jacks carry the header: from bottom plate to underside of header
    const jackZ0 = bottomH;
    const jackZ1 = headerBottom;

    // Kings — full height beside jacks
    addStud('king_stud', 'Королевская стойка', kingL, bottomH, H - topH);
    addStud('king_stud', 'Королевская стойка', kingR, bottomH, H - topH);

    // Jacks — support both ends of header (must touch header underside)
    addStud('jack_stud', 'Джек (опора перемычки)', jackL, jackZ0, jackZ1);
    addStud('jack_stud', 'Джек (опора перемычки)', jackR, jackZ0, jackZ1);

    // Double header bearing on both jacks (from jackL to jackR+tw)
    const headerS0 = jackL;
    const headerS1 = jackR + tw;
    for (let ply = 0; ply < 2; ply++) {
      pushMember(members, lumber, {
        kind: 'header',
        label: `Перемычка ${o.width} мм (${ply + 1}/2)`,
        sectionMm: { width: tw, depth: headerDepth },
        lengthMm: Math.max(tw * 2, headerS1 - headerS0),
        floor: wall.floor,
        wallId: wall.id,
        plan: plateSegment(wall, headerS0, headerS1, 24 + ply * 12),
        elev: {
          s0: headerS0,
          s1: headerS1,
          z0: headerBottom,
          z1: headerTop,
        },
      });
    }

    if (o.type === 'window' && o.sillHeight > bottomH + 80) {
      const sillTop = o.sillHeight;
      const sillThick = bottomH;
      // Rough sill between jacks
      pushMember(members, lumber, {
        kind: 'bottom_plate',
        label: 'Подоконная доска',
        sectionMm: section,
        lengthMm: Math.max(tw, openR - openL),
        floor: wall.floor,
        wallId: wall.id,
        plan: plateSegment(wall, openL, openR, -24),
        elev: { s0: openL, s1: openR, z0: sillTop - sillThick, z1: sillTop },
      });

      // Cripples under sill between jacks
      for (let s = openL + spacing; s < openR - tw; s += spacing) {
        addStud('cripple', 'Коротыш под окном', s, bottomH, sillTop - sillThick);
      }
    }

    // Cripples above header up to top plate
    if (H - topH - headerTop > 80) {
      for (let s = openL + spacing; s < openR - tw; s += spacing) {
        addStud('cripple', 'Коротыш над перемычкой', s, headerTop, H - topH);
      }
    }

    // Block out entire king-to-king zone from regular studs
    blocked.push({ s0: kingL, s1: kingR + tw });
  }

  const isBlocked = (s: number) =>
    blocked.some((b) => s + tw / 2 > b.s0 + 1 && s + tw / 2 < b.s1 - 1);

  // Regular studs (corners handled by California corner assembly when walls meet)
  const studPositions = new Set<number>();
  if (!skipEndStuds.start) studPositions.add(0);
  if (!skipEndStuds.end) studPositions.add(Math.max(0, len - tw));
  for (let s = spacing; s < len - tw; s += spacing) studPositions.add(Math.round(s));

  for (const s of [...studPositions].sort((a, b) => a - b)) {
    if (isBlocked(s)) continue;
    addStud('stud', 'Стойка', s, bottomH, H - topH);
  }
}

function near(a: Point, b: Point, eps = 8): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

/** Detect wall junctions and build California corners (2+1 studs). */
export function buildCaliforniaCorners(
  walls: Wall[],
  settings: ProjectSettings,
  members: FrameMember[],
  lumber: LumberPiece[],
): Map<string, { start: boolean; end: boolean }> {
  const skip = new Map<string, { start: boolean; end: boolean }>();
  for (const w of walls) skip.set(w.id, { start: false, end: false });

  const ends: { wall: Wall; end: 'a' | 'b'; point: Point }[] = [];
  for (const w of walls) {
    ends.push({ wall: w, end: 'a', point: w.a });
    ends.push({ wall: w, end: 'b', point: w.b });
  }

  const used = new Set<string>();
  for (let i = 0; i < ends.length; i++) {
    const keyI = `${ends[i].wall.id}:${ends[i].end}`;
    if (used.has(keyI)) continue;
    const group = [ends[i]];
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[j].wall.floor !== ends[i].wall.floor) continue;
      if (ends[j].wall.id === ends[i].wall.id) continue;
      if (near(ends[i].point, ends[j].point)) group.push(ends[j]);
    }
    if (group.length < 2) continue;

    for (const g of group) used.add(`${g.wall.id}:${g.end}`);

    // Mark ends to skip simple studs
    for (const g of group) {
      const flags = skip.get(g.wall.id)!;
      if (g.end === 'a') flags.start = true;
      else flags.end = true;
    }

    // Primary wall gets California pair; others get single abutting stud
    const primary = group[0];
    const H = primary.wall.height || settings.floorHeightMm;
    const section = settings.studSectionMm;
    const tw = section.width;
    const td = section.depth;
    const bottomH = Math.max(38, Math.min(td, 50));
    const topH = bottomH * 2;
    const ang = wallAngle(primary.wall);
    const len = wallLength(primary.wall);
    const sCorner = primary.end === 'a' ? 0 : Math.max(0, len - tw);
    const sInset =
      primary.end === 'a'
        ? Math.min(len - tw, tw + 10)
        : Math.max(0, len - tw - (tw + 10));

    const addCornerStud = (
      wall: Wall,
      s: number,
      kind: FrameMember['kind'],
      label: string,
    ) => {
      const p = along(wall, s + tw / 2);
      pushMember(members, lumber, {
        kind,
        label,
        sectionMm: section,
        lengthMm: H - bottomH - topH,
        floor: wall.floor,
        wallId: wall.id,
        planMark: { x: p.x, y: p.y, angle: wallAngle(wall) },
        elev: { s0: s, s1: s + tw, z0: bottomH, z1: H - topH },
      });
    };

    addCornerStud(primary.wall, sCorner, 'stud', 'Калифорнийский угол (стойка 1)');
    addCornerStud(primary.wall, sInset, 'stud', 'Калифорнийский угол (стойка 2)');

    for (let g = 1; g < group.length; g++) {
      const other = group[g];
      const oLen = wallLength(other.wall);
      const s = other.end === 'a' ? 0 : Math.max(0, oLen - tw);
      addCornerStud(other.wall, s, 'stud', 'Калифорнийский угол (примыкание)');
    }

    // Keep ang referenced to avoid unused in some builds
    void ang;
  }

  return skip;
}

export function prepareWallSkipFlags(walls: Wall[]): Map<string, { start: boolean; end: boolean }> {
  const skip = new Map<string, { start: boolean; end: boolean }>();
  for (const w of walls) skip.set(w.id, { start: false, end: false });

  const ends: { wall: Wall; end: 'a' | 'b'; point: Point }[] = [];
  for (const w of walls) {
    ends.push({ wall: w, end: 'a', point: w.a });
    ends.push({ wall: w, end: 'b', point: w.b });
  }

  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[j].wall.floor !== ends[i].wall.floor) continue;
      if (ends[j].wall.id === ends[i].wall.id) continue;
      if (!near(ends[i].point, ends[j].point)) continue;
      const a = skip.get(ends[i].wall.id)!;
      const b = skip.get(ends[j].wall.id)!;
      if (ends[i].end === 'a') a.start = true;
      else a.end = true;
      if (ends[j].end === 'a') b.start = true;
      else b.end = true;
    }
  }
  return skip;
}

export function buildFloorMembers(
  project: Project,
  floor: FloorLevel,
  members: FrameMember[],
  lumber: LumberPiece[],
) {
  const refWalls =
    floor === 0
      ? project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior')
      : project.walls.filter((w) => w.floor === 1 && w.kind === 'exterior').length
        ? project.walls.filter((w) => w.floor === 1 && w.kind === 'exterior')
        : project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior');
  if (refWalls.length === 0) return;

  const pts = refWalls.flatMap((w) => [w.a, w.b]);
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const joist = project.settings.joistSectionMm;
  const spacing = project.settings.joistSpacingMm;
  const spanShort = spanX <= spanY;
  const span = spanShort ? spanX : spanY;
  const run = spanShort ? spanY : spanX;

  if (floor === 0) {
    for (const wall of refWalls) {
      const L = Math.round(wallLength(wall));
      pushMember(members, lumber, {
        kind: 'sill',
        label: 'Лежень (обвязка фундамента)',
        sectionMm: { width: 50, depth: 150 },
        lengthMm: L,
        floor: 'foundation',
        wallId: wall.id,
        plan: plateSegment(wall, 0, L, 0),
      });
    }
  }

  // Rim joists
  if (spanShort) {
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Обвязочная балка',
      sectionMm: joist,
      lengthMm: Math.round(run),
      floor,
      plan: { x1: minX, y1: minY, x2: minX, y2: maxY },
    });
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Обвязочная балка',
      sectionMm: joist,
      lengthMm: Math.round(run),
      floor,
      plan: { x1: maxX, y1: minY, x2: maxX, y2: maxY },
    });
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Торцевая обвязка',
      sectionMm: joist,
      lengthMm: Math.round(span),
      floor,
      plan: { x1: minX, y1: minY, x2: maxX, y2: minY },
    });
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Торцевая обвязка',
      sectionMm: joist,
      lengthMm: Math.round(span),
      floor,
      plan: { x1: minX, y1: maxY, x2: maxX, y2: maxY },
    });
    for (let y = minY; y <= maxY + 1; y += spacing) {
      pushMember(members, lumber, {
        kind: 'joist',
        label: floor === 0 ? 'Балка черного пола' : 'Балка перекрытия',
        sectionMm: joist,
        lengthMm: Math.round(span),
        floor,
        plan: { x1: minX, y1: y, x2: maxX, y2: y },
      });
    }
  } else {
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Обвязочная балка',
      sectionMm: joist,
      lengthMm: Math.round(run),
      floor,
      plan: { x1: minX, y1: minY, x2: maxX, y2: minY },
    });
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Обвязочная балка',
      sectionMm: joist,
      lengthMm: Math.round(run),
      floor,
      plan: { x1: minX, y1: maxY, x2: maxX, y2: maxY },
    });
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Торцевая обвязка',
      sectionMm: joist,
      lengthMm: Math.round(span),
      floor,
      plan: { x1: minX, y1: minY, x2: minX, y2: maxY },
    });
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Торцевая обвязка',
      sectionMm: joist,
      lengthMm: Math.round(span),
      floor,
      plan: { x1: maxX, y1: minY, x2: maxX, y2: maxY },
    });
    for (let x = minX; x <= maxX + 1; x += spacing) {
      pushMember(members, lumber, {
        kind: 'joist',
        label: floor === 0 ? 'Балка черного пола' : 'Балка перекрытия',
        sectionMm: joist,
        lengthMm: Math.round(span),
        floor,
        plan: { x1: x, y1: minY, x2: x, y2: maxY },
      });
    }
  }
}

export function buildRoofMembers(
  project: Project,
  members: FrameMember[],
  lumber: LumberPiece[],
) {
  const exterior = project.walls.filter(
    (w) => w.kind === 'exterior' && w.floor === (project.settings.floors === 2 ? 1 : 0),
  );
  const base =
    exterior.length > 0
      ? exterior
      : project.walls.filter((w) => w.kind === 'exterior' && w.floor === 0);
  if (base.length === 0) return;

  const pts = base.flatMap((w) => [w.a, w.b]);
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  const width = maxX - minX;
  const depth = maxY - minY;
  const pitch = (project.settings.roofPitchDeg * Math.PI) / 180;
  const overhang = project.settings.overhangMm;
  const spacing = project.settings.joistSpacingMm;
  const section = project.settings.joistSectionMm;
  const cx = (minX + maxX) / 2;

  if (project.settings.roofType === 'gable' || project.settings.roofType === 'hip') {
    const run = width / 2 + overhang;
    const rafterLen = Math.round(run / Math.cos(pitch));
    pushMember(members, lumber, {
      kind: 'ridge',
      label: 'Коньковый брус',
      sectionMm: section,
      lengthMm: Math.round(depth + overhang * 2),
      floor: 'roof',
      plan: {
        x1: cx,
        y1: minY - overhang,
        x2: cx,
        y2: maxY + overhang,
      },
    });
    for (let y = minY - overhang; y <= maxY + overhang + 1; y += spacing) {
      pushMember(members, lumber, {
        kind: 'rafter',
        label: 'Стропило',
        sectionMm: section,
        lengthMm: rafterLen,
        floor: 'roof',
        plan: { x1: minX - overhang, y1: y, x2: cx, y2: y },
      });
      pushMember(members, lumber, {
        kind: 'rafter',
        label: 'Стропило',
        sectionMm: section,
        lengthMm: rafterLen,
        floor: 'roof',
        plan: { x1: maxX + overhang, y1: y, x2: cx, y2: y },
      });
    }
    if (project.settings.roofType === 'hip') {
      const hipLen = Math.round(Math.hypot(width / 2, depth / 2) / Math.cos(pitch));
      const corners: [Point, Point][] = [
        [{ x: minX - overhang, y: minY - overhang }, { x: cx, y: (minY + maxY) / 2 }],
        [{ x: maxX + overhang, y: minY - overhang }, { x: cx, y: (minY + maxY) / 2 }],
        [{ x: minX - overhang, y: maxY + overhang }, { x: cx, y: (minY + maxY) / 2 }],
        [{ x: maxX + overhang, y: maxY + overhang }, { x: cx, y: (minY + maxY) / 2 }],
      ];
      for (const [a, b] of corners) {
        pushMember(members, lumber, {
          kind: 'rafter',
          label: 'Накосное стропило',
          sectionMm: { width: section.width, depth: section.depth + 50 },
          lengthMm: hipLen,
          floor: 'roof',
          plan: { x1: a.x, y1: a.y, x2: b.x, y2: b.y },
        });
      }
    }
  } else if (project.settings.roofType === 'shed') {
    const shedLen = Math.round((width + overhang * 2) / Math.cos(pitch));
    for (let y = minY - overhang; y <= maxY + overhang + 1; y += spacing) {
      pushMember(members, lumber, {
        kind: 'rafter',
        label: 'Стропило односкатной кровли',
        sectionMm: section,
        lengthMm: shedLen,
        floor: 'roof',
        plan: {
          x1: minX - overhang,
          y1: y,
          x2: maxX + overhang,
          y2: y,
        },
      });
    }
  } else {
    for (let y = minY - overhang; y <= maxY + overhang + 1; y += spacing) {
      pushMember(members, lumber, {
        kind: 'joist',
        label: 'Балка плоской кровли',
        sectionMm: section,
        lengthMm: Math.round(width + overhang * 2),
        floor: 'roof',
        plan: {
          x1: minX - overhang,
          y1: y,
          x2: maxX + overhang,
          y2: y,
        },
      });
    }
  }
}

const COLORS: Record<string, string> = {
  sill: '#7c2d12',
  bottom_plate: '#1f3a2e',
  top_plate: '#14532d',
  stud: '#334155',
  king_stud: '#0f766e',
  jack_stud: '#c45c26',
  header: '#b45309',
  cripple: '#64748b',
  joist: '#0369a1',
  rim_joist: '#0c4a6e',
  rafter: '#9a3412',
  ridge: '#7c2d12',
  blocking: '#57534e',
};

function svgEsc(n: number): string {
  return n.toFixed(2);
}

export function renderFrameProjections(
  project: Project,
  members: FrameMember[],
): {
  planSvg: string;
  elevationFrontSvg: string;
  elevationSideSvg: string;
  roofSvg: string;
  wallElevations: { wallId: string; title: string; svg: string }[];
} {
  const floor = project.activeFloor;
  const walls = project.walls.filter((w) => w.floor === floor);
  const floorMembers = members.filter(
    (m) => m.floor === floor || (floor === 0 && m.floor === 'foundation'),
  );
  const pts = walls.flatMap((w) => [w.a, w.b]);
  const pad = 1000;
  const minX = (pts.length ? Math.min(...pts.map((p) => p.x)) : 0) - pad;
  const minY = (pts.length ? Math.min(...pts.map((p) => p.y)) : 0) - pad;
  const maxX = (pts.length ? Math.max(...pts.map((p) => p.x)) : 8000) + pad;
  const maxY = (pts.length ? Math.max(...pts.map((p) => p.y)) : 6000) + pad;
  const W = maxX - minX;
  const H = maxY - minY;
  const view = 720;
  const scale = view / Math.max(W, H, 1);
  const vw = W * scale;
  const vh = H * scale;
  const toX = (x: number) => (x - minX) * scale;
  const toY = (y: number) => (y - minY) * scale;

  const legend = `
    <g font-family="Manrope,sans-serif" font-size="11">
      <text x="8" y="14" fill="#1f3a2e" font-weight="700">План каркаса · этаж ${floor + 1}</text>
      <rect x="8" y="22" width="10" height="10" fill="#334155"/><text x="22" y="31" fill="#334155">стойка</text>
      <rect x="70" y="22" width="10" height="10" fill="#0f766e"/><text x="84" y="31" fill="#0f766e">king</text>
      <rect x="120" y="22" width="10" height="10" fill="#c45c26"/><text x="134" y="31" fill="#c45c26">jack</text>
      <rect x="175" y="22" width="10" height="10" fill="#b45309"/><text x="189" y="31" fill="#b45309">header</text>
      <rect x="245" y="22" width="10" height="10" fill="#0369a1"/><text x="259" y="31" fill="#0369a1">балка</text>
    </g>`;

  let planBody = '';

  // Joists / rim under walls
  for (const m of floorMembers.filter((m) => m.kind === 'joist' || m.kind === 'rim_joist' || m.kind === 'sill')) {
    if (!m.plan) continue;
    const sw = m.kind === 'joist' ? 1.2 : 2.4;
    planBody += `<line x1="${svgEsc(toX(m.plan.x1))}" y1="${svgEsc(toY(m.plan.y1))}" x2="${svgEsc(toX(m.plan.x2))}" y2="${svgEsc(toY(m.plan.y2))}" stroke="${COLORS[m.kind]}" stroke-width="${sw}" opacity="0.55"/>`;
  }

  // Plates
  for (const m of floorMembers.filter((m) => m.kind === 'bottom_plate' || m.kind === 'top_plate')) {
    if (!m.plan) continue;
    planBody += `<line x1="${svgEsc(toX(m.plan.x1))}" y1="${svgEsc(toY(m.plan.y1))}" x2="${svgEsc(toX(m.plan.x2))}" y2="${svgEsc(toY(m.plan.y2))}" stroke="${COLORS[m.kind]}" stroke-width="3.5" stroke-linecap="square"/>`;
  }

  // Headers on plan
  for (const m of floorMembers.filter((m) => m.kind === 'header')) {
    if (!m.plan) continue;
    planBody += `<line x1="${svgEsc(toX(m.plan.x1))}" y1="${svgEsc(toY(m.plan.y1))}" x2="${svgEsc(toX(m.plan.x2))}" y2="${svgEsc(toY(m.plan.y2))}" stroke="${COLORS.header}" stroke-width="5"/>`;
  }

  // Stud marks
  for (const m of floorMembers.filter((m) => m.planMark)) {
    const mark = m.planMark!;
    const len = m.kind === 'king_stud' || m.kind === 'jack_stud' ? 140 : 110;
    const dx = Math.cos(mark.angle + Math.PI / 2) * len;
    const dy = Math.sin(mark.angle + Math.PI / 2) * len;
    const x = toX(mark.x);
    const y = toY(mark.y);
    const sw = m.kind === 'king_stud' ? 3.2 : m.kind === 'jack_stud' ? 2.8 : 2;
    planBody += `<line x1="${svgEsc(x - dx)}" y1="${svgEsc(y - dy)}" x2="${svgEsc(x + dx)}" y2="${svgEsc(y + dy)}" stroke="${COLORS[m.kind] ?? '#334155'}" stroke-width="${sw}"/>`;
    planBody += `<circle cx="${svgEsc(x)}" cy="${svgEsc(y)}" r="2.2" fill="${COLORS[m.kind] ?? '#334155'}"/>`;
  }

  // Opening labels
  for (const o of project.openings.filter((o) => walls.some((w) => w.id === o.wallId))) {
    const wall = walls.find((w) => w.id === o.wallId)!;
    const p = along(wall, o.offset + o.width / 2);
    planBody += `<text x="${svgEsc(toX(p.x))}" y="${svgEsc(toY(p.y) - 8)}" text-anchor="middle" font-size="10" fill="${o.type === 'window' ? '#2563eb' : '#b45309'}">${o.type === 'window' ? 'ОКНО' : 'ДВЕРЬ'} ${o.width}×${o.height}</text>`;
  }

  const planSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgEsc(vw)} ${svgEsc(vh + 40)}" width="100%" height="100%" style="background:#fff">${legend}<g transform="translate(0,36)">${planBody}</g></svg>`;

  // Per-wall elevations
  const wallElevations = walls.map((wall, idx) => {
    const L = wallLength(wall);
    const wallH = wall.height || project.settings.floorHeightMm;
    const mWall = members.filter((m) => m.wallId === wall.id && m.elev);
    const padX = 40;
    const padY = 30;
    const scaleX = Math.min(8, 900 / Math.max(L, 1));
    const scaleY = Math.min(0.12, 320 / Math.max(wallH, 1));
    const svgW = L * scaleX + padX * 2;
    const svgH = wallH * scaleY + padY * 2 + 24;
    const X = (s: number) => padX + s * scaleX;
    const Z = (z: number) => padY + 20 + (wallH - z) * scaleY;

    let body = `<rect x="${X(0)}" y="${Z(wallH)}" width="${L * scaleX}" height="${wallH * scaleY}" fill="#f8fafc" stroke="#cbd5e1"/>`;
    // Draw order: plates, cripples, studs, kings, jacks, headers on top
    const order = (k: string) =>
      ({ bottom_plate: 0, top_plate: 1, cripple: 2, stud: 3, king_stud: 4, jack_stud: 5, header: 6 })[
        k
      ] ?? 3;
    const sorted = [...mWall].sort((a, b) => order(a.kind) - order(b.kind));
    for (const m of sorted) {
      const e = m.elev!;
      const rawW = Math.abs(e.s1 - e.s0) * scaleX;
      // Vertical members (studs/jacks/kings) need visible width on drawing
      const isPost = ['stud', 'king_stud', 'jack_stud', 'cripple'].includes(m.kind);
      const w = isPost ? Math.max(5, rawW) : Math.max(2, rawW);
      const x = X(Math.min(e.s0, e.s1)) - (isPost ? (w - rawW) / 2 : 0);
      const y = Z(Math.max(e.z0, e.z1));
      const h = Math.max(m.kind === 'header' ? 6 : 2, Math.abs(e.z1 - e.z0) * scaleY);
      body += `<rect x="${svgEsc(x)}" y="${svgEsc(y)}" width="${svgEsc(w)}" height="${svgEsc(h)}" fill="${COLORS[m.kind] ?? '#334155'}" stroke="#0f172a" stroke-width="0.5" opacity="0.95"/>`;
    }

    // Opening voids outline
    for (const o of openingsOnWall(project.openings, wall.id)) {
      const z0 = o.type === 'door' ? 0 : o.sillHeight;
      const z1 = z0 + o.height;
      body += `<rect x="${svgEsc(X(o.offset))}" y="${svgEsc(Z(z1))}" width="${svgEsc(o.width * scaleX)}" height="${svgEsc(o.height * scaleY)}" fill="#e0f2fe" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="4 2" opacity="0.85"/>`;
    }

    body += `<text x="${padX}" y="16" font-size="12" fill="#1f3a2e" font-family="Manrope,sans-serif">Развёртка стены ${idx + 1} · ${(L / 1000).toFixed(2)} м · ${wall.kind === 'exterior' ? 'наружная' : 'внутренняя'}</text>`;

    return {
      wallId: wall.id,
      title: `Стена ${idx + 1} (${(L / 1000).toFixed(2)} м)`,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgEsc(svgW)} ${svgEsc(svgH)}" width="100%" height="100%" style="background:#fff">${body}</svg>`,
    };
  });

  // Front / side elevations — pick longest walls roughly parallel to axes
  const exterior = walls.filter((w) => w.kind === 'exterior');
  const byHoriz = [...exterior].sort(
    (a, b) => Math.abs(b.b.x - b.a.x) - Math.abs(a.b.x - a.a.x),
  );
  const byVert = [...exterior].sort(
    (a, b) => Math.abs(b.b.y - b.a.y) - Math.abs(a.b.y - a.a.y),
  );
  const frontWall = byHoriz[0] ?? walls[0];
  const sideWall = byVert[0] ?? walls[1] ?? walls[0];

  const elevSvg = (wall: Wall | undefined, title: string) => {
    if (!wall) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text x="20" y="40" fill="#64748b">Нет стены</text></svg>`;
    }
    const found = wallElevations.find((w) => w.wallId === wall.id);
    if (!found) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text x="20" y="40" fill="#64748b">${title}</text></svg>`;
    }
    return found.svg.replace('Развёртка стены', title);
  };

  // Roof plan
  const roofMembers = members.filter((m) => m.floor === 'roof' && m.plan);
  let roofBody = '';
  const rPad = 1200;
  const rMinX = minX - rPad;
  const rMinY = minY - rPad;
  const rMaxX = maxX + rPad;
  const rMaxY = maxY + rPad;
  const rW = rMaxX - rMinX;
  const rH = rMaxY - rMinY;
  const rScale = 640 / Math.max(rW, rH, 1);
  const rx = (x: number) => (x - rMinX) * rScale;
  const ry = (y: number) => (y - rMinY) * rScale;
  for (const m of roofMembers) {
    const p = m.plan!;
    roofBody += `<line x1="${svgEsc(rx(p.x1))}" y1="${svgEsc(ry(p.y1))}" x2="${svgEsc(rx(p.x2))}" y2="${svgEsc(ry(p.y2))}" stroke="${COLORS[m.kind]}" stroke-width="${m.kind === 'ridge' ? 4 : 1.6}"/>`;
  }
  const roofSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgEsc(rW * rScale)} ${svgEsc(rH * rScale + 24)}" width="100%" height="100%" style="background:#fff"><text x="8" y="14" font-size="12" fill="#7c2d12" font-family="Manrope,sans-serif">План стропил · ${project.settings.roofType} · ${project.settings.roofPitchDeg}°</text><g transform="translate(0,20)">${roofBody}</g></svg>`;

  return {
    planSvg,
    elevationFrontSvg: elevSvg(frontWall, 'Фасад — каркас'),
    elevationSideSvg: elevSvg(sideWall, 'Торец — каркас'),
    roofSvg,
    wallElevations,
  };
}
