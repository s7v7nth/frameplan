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

function plateSegment(
  wall: Wall,
  s0: number,
  s1: number,
  offsetN: number,
): { x1: number; y1: number; x2: number; y2: number } {
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

/**
 * Wall framing per SP 31-105 platform framing.
 * Opening clear span = [offset, offset+width] between INNER faces of jacks:
 *   [king][jack] | opening | [jack][king]
 * Header bears full width on both jacks.
 */
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
  const tw = section.width;
  const spacing = settings.studSpacingMm;
  // Plate thickness in elevation ≈ stud width (board on flat)
  const plateThk = tw;
  const topPlies = 2;
  const topH = plateThk * topPlies;
  const bottomH = plateThk;
  const studTop = H - topH;
  const studBot = bottomH;
  const ang = wallAngle(wall);

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

  for (let ply = 0; ply < topPlies; ply++) {
    pushMember(members, lumber, {
      kind: 'top_plate',
      label: ply === 0 ? 'Верхняя обвязка — доска 1' : 'Верхняя обвязка — доска 2',
      sectionMm: section,
      lengthMm: len,
      floor: wall.floor,
      wallId: wall.id,
      plan: plateSegment(wall, 0, len, ply === 0 ? -6 : 6),
      elev: {
        s0: 0,
        s1: len,
        z0: H - topH + ply * plateThk,
        z1: H - topH + (ply + 1) * plateThk,
      },
    });
  }

  type Occ = { s0: number; s1: number };
  const blocked: Occ[] = [];

  const addPost = (
    kind: FrameMember['kind'],
    label: string,
    s: number,
    z0: number,
    z1: number,
  ) => {
    const clamped = Math.max(0, Math.min(len - tw, Math.round(s)));
    const p = along(wall, clamped + tw / 2);
    pushMember(members, lumber, {
      kind,
      label,
      sectionMm: section,
      lengthMm: Math.max(40, Math.round(z1 - z0)),
      floor: wall.floor,
      wallId: wall.id,
      planMark: { x: p.x, y: p.y, angle: ang },
      elev: { s0: clamped, s1: clamped + tw, z0, z1 },
    });
  };

  for (const o of wallOpenings) {
    const clearL = Math.max(0, Math.round(o.offset));
    const clearR = Math.min(len, Math.round(o.offset + o.width));
    const clearW = clearR - clearL;
    if (clearW < 300) continue;

    // [king][jack] | clear | [jack][king]
    let jackL = clearL - tw;
    let jackR = clearR;
    let kingL = clearL - 2 * tw;
    let kingR = clearR + tw;

    // Clamp to wall; if opening near end, compress assembly
    if (kingL < 0) {
      kingL = 0;
      jackL = tw;
    }
    if (kingR > len - tw) {
      kingR = len - tw;
      jackR = len - 2 * tw;
    }
    jackL = Math.max(kingL + tw, Math.min(jackL, clearL - tw));
    jackR = Math.min(kingR - tw, Math.max(jackR, clearR));

    // Header size by span (SP table simplified)
    const headerDepth = clearW > 1500 ? 250 : clearW > 900 ? 200 : 150;
    const headerBottom =
      o.type === 'door' ? Math.min(o.height, studTop - headerDepth) : o.sillHeight + o.height;
    const headerTop = Math.min(studTop, headerBottom + headerDepth);

    // Kings — continuous floor-to-top-plate
    addPost('king_stud', 'Королевская стойка', kingL, studBot, studTop);
    addPost('king_stud', 'Королевская стойка', kingR, studBot, studTop);

    // Jacks — from bottom plate to underside of header (bear the header)
    addPost('jack_stud', 'Опорная стойка (джек)', jackL, studBot, headerBottom);
    addPost('jack_stud', 'Опорная стойка (джек)', jackR, studBot, headerBottom);

    // Double header on edge (2 boards), bears on both jacks
    const headerS0 = jackL;
    const headerS1 = jackR + tw;
    for (let ply = 0; ply < 2; ply++) {
      pushMember(members, lumber, {
        kind: 'header',
        label: `Перемычка ${clearW} мм (${ply + 1}/2)`,
        sectionMm: { width: tw, depth: headerDepth },
        lengthMm: Math.round(headerS1 - headerS0),
        floor: wall.floor,
        wallId: wall.id,
        plan: plateSegment(wall, headerS0, headerS1, 18 + ply * 10),
        elev: {
          s0: headerS0,
          s1: headerS1,
          // Same elev box for both plies (face-to-face); drawing shows one header with 2× mark
          z0: headerBottom,
          z1: headerTop,
        },
      });
    }

    // Window rough sill + cripples under (between jacks, inside clear opening)
    if (o.type === 'window' && o.sillHeight > studBot + 100) {
      const sillTop = o.sillHeight;
      const sillBot = sillTop - plateThk;
      pushMember(members, lumber, {
        kind: 'bottom_plate',
        label: 'Подоконная доска (черновой подоконник)',
        sectionMm: section,
        lengthMm: clearW,
        floor: wall.floor,
        wallId: wall.id,
        plan: plateSegment(wall, clearL, clearR, -18),
        elev: { s0: clearL, s1: clearR, z0: sillBot, z1: sillTop },
      });

      // Cripples OC under sill — include one next to each jack
      const underPositions = new Set<number>();
      underPositions.add(clearL);
      underPositions.add(Math.max(clearL, clearR - tw));
      for (let s = clearL + spacing; s < clearR - tw; s += spacing) {
        underPositions.add(Math.round(s));
      }
      for (const s of underPositions) {
        if (s >= clearR - tw / 2) continue;
        addPost('cripple', 'Коротыш под окном', s, studBot, sillBot);
      }
    }

    // Cripples above header to top plate
    if (studTop - headerTop > 60) {
      const above = new Set<number>();
      above.add(clearL);
      above.add(Math.max(clearL, clearR - tw));
      for (let s = clearL + spacing; s < clearR - tw; s += spacing) {
        above.add(Math.round(s));
      }
      for (const s of above) {
        if (s >= clearR - tw / 2) continue;
        addPost('cripple', 'Коротыш над перемычкой', s, headerTop, studTop);
      }
    }

    blocked.push({ s0: kingL, s1: kingR + tw });
  }

  const isBlocked = (s: number) =>
    blocked.some((b) => s + tw / 2 > b.s0 + 1 && s + tw / 2 < b.s1 - 1);

  const studPositions = new Set<number>();
  if (!skipEndStuds.start) studPositions.add(0);
  if (!skipEndStuds.end) studPositions.add(Math.max(0, len - tw));
  for (let s = spacing; s < len - tw / 2; s += spacing) {
    studPositions.add(Math.round(s));
  }

  for (const s of [...studPositions].sort((a, b) => a - b)) {
    if (isBlocked(s)) continue;
    addPost('stud', 'Стойка', s, studBot, studTop);
  }
}

function near(a: Point, b: Point, eps = 8): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

/** California corner: 2 studs on primary wall + 1 abutting stud on secondary. */
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

    for (const g of group) {
      const flags = skip.get(g.wall.id)!;
      if (g.end === 'a') flags.start = true;
      else flags.end = true;
    }

    const primary = group[0];
    const H = primary.wall.height || settings.floorHeightMm;
    const section = settings.studSectionMm;
    const tw = section.width;
    const plateThk = tw;
    const bottomH = plateThk;
    const topH = plateThk * 2;
    const len = wallLength(primary.wall);
    const sCorner = primary.end === 'a' ? 0 : Math.max(0, len - tw);
    const sInset =
      primary.end === 'a' ? Math.min(len - tw, tw) : Math.max(0, len - 2 * tw);

    const addCornerStud = (wall: Wall, s: number, label: string) => {
      const p = along(wall, s + tw / 2);
      pushMember(members, lumber, {
        kind: 'stud',
        label,
        sectionMm: section,
        lengthMm: H - bottomH - topH,
        floor: wall.floor,
        wallId: wall.id,
        planMark: { x: p.x, y: p.y, angle: wallAngle(wall) },
        elev: { s0: s, s1: s + tw, z0: bottomH, z1: H - topH },
      });
    };

    addCornerStud(primary.wall, sCorner, 'Калифорнийский угол — стойка 1');
    addCornerStud(primary.wall, sInset, 'Калифорнийский угол — стойка 2');
    for (let g = 1; g < group.length; g++) {
      const other = group[g];
      const oLen = wallLength(other.wall);
      const s = other.end === 'a' ? 0 : Math.max(0, oLen - tw);
      addCornerStud(other.wall, s, 'Калифорнийский угол — примыкание');
    }
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

  if (spanShort) {
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Обвязочная балка',
      sectionMm: joist,
      lengthMm: Math.round(spanY),
      floor,
      plan: { x1: minX, y1: minY, x2: minX, y2: maxY },
    });
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Обвязочная балка',
      sectionMm: joist,
      lengthMm: Math.round(spanY),
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
      lengthMm: Math.round(spanX),
      floor,
      plan: { x1: minX, y1: minY, x2: maxX, y2: minY },
    });
    pushMember(members, lumber, {
      kind: 'rim_joist',
      label: 'Обвязочная балка',
      sectionMm: joist,
      lengthMm: Math.round(spanX),
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
  // Ridge along the longer plan dimension (more realistic for gable/hip)
  const ridgeAlongY = depth >= width;
  const span = ridgeAlongY ? width : depth;
  const ridgeLenBase = ridgeAlongY ? depth : width;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  if (project.settings.roofType === 'gable' || project.settings.roofType === 'hip') {
    const run = span / 2 + overhang;
    const rafterLen = Math.round(run / Math.max(0.2, Math.cos(pitch)));
    // Hip: shorten ridge by roughly half-span on each end
    const hipInset =
      project.settings.roofType === 'hip' ? Math.min(span / 2, ridgeLenBase / 2) : 0;
    const ridgeLen = Math.max(spacing, Math.round(ridgeLenBase + overhang * 2 - hipInset * 2));

    if (ridgeAlongY) {
      const y0 = minY - overhang + hipInset;
      const y1 = maxY + overhang - hipInset;
      pushMember(members, lumber, {
        kind: 'ridge',
        label: 'Коньковый брус',
        sectionMm: section,
        lengthMm: ridgeLen,
        floor: 'roof',
        plan: { x1: cx, y1: y0, x2: cx, y2: y1 },
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
    } else {
      const x0 = minX - overhang + hipInset;
      const x1 = maxX + overhang - hipInset;
      pushMember(members, lumber, {
        kind: 'ridge',
        label: 'Коньковый брус',
        sectionMm: section,
        lengthMm: ridgeLen,
        floor: 'roof',
        plan: { x1: x0, y1: cy, x2: x1, y2: cy },
      });
      for (let x = minX - overhang; x <= maxX + overhang + 1; x += spacing) {
        pushMember(members, lumber, {
          kind: 'rafter',
          label: 'Стропило',
          sectionMm: section,
          lengthMm: rafterLen,
          floor: 'roof',
          plan: { x1: x, y1: minY - overhang, x2: x, y2: cy },
        });
        pushMember(members, lumber, {
          kind: 'rafter',
          label: 'Стропило',
          sectionMm: section,
          lengthMm: rafterLen,
          floor: 'roof',
          plan: { x1: x, y1: maxY + overhang, x2: x, y2: cy },
        });
      }
    }

    if (project.settings.roofType === 'hip') {
      const hipLen = Math.round(Math.hypot(width / 2, depth / 2) / Math.max(0.2, Math.cos(pitch)));
      const ridgeEndA = ridgeAlongY
        ? { x: cx, y: minY - overhang + hipInset }
        : { x: minX - overhang + hipInset, y: cy };
      const ridgeEndB = ridgeAlongY
        ? { x: cx, y: maxY + overhang - hipInset }
        : { x: maxX + overhang - hipInset, y: cy };
      const corners: [Point, Point][] = [
        [{ x: minX - overhang, y: minY - overhang }, ridgeEndA],
        [{ x: maxX + overhang, y: minY - overhang }, ridgeAlongY ? ridgeEndA : ridgeEndB],
        [{ x: minX - overhang, y: maxY + overhang }, ridgeAlongY ? ridgeEndB : ridgeEndA],
        [{ x: maxX + overhang, y: maxY + overhang }, ridgeEndB],
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
    // Span across shorter direction for typical shed
    if (ridgeAlongY) {
      const shedLen = Math.round((width + overhang * 2) / Math.max(0.2, Math.cos(pitch)));
      for (let y = minY - overhang; y <= maxY + overhang + 1; y += spacing) {
        pushMember(members, lumber, {
          kind: 'rafter',
          label: 'Стропило односкатной кровли',
          sectionMm: section,
          lengthMm: shedLen,
          floor: 'roof',
          plan: { x1: minX - overhang, y1: y, x2: maxX + overhang, y2: y },
        });
      }
    } else {
      const shedLen = Math.round((depth + overhang * 2) / Math.max(0.2, Math.cos(pitch)));
      for (let x = minX - overhang; x <= maxX + overhang + 1; x += spacing) {
        pushMember(members, lumber, {
          kind: 'rafter',
          label: 'Стропило односкатной кровли',
          sectionMm: section,
          lengthMm: shedLen,
          floor: 'roof',
          plan: { x1: x, y1: minY - overhang, x2: x, y2: maxY + overhang },
        });
      }
    }
  } else {
    if (ridgeAlongY) {
      for (let y = minY - overhang; y <= maxY + overhang + 1; y += spacing) {
        pushMember(members, lumber, {
          kind: 'joist',
          label: 'Балка плоской кровли',
          sectionMm: section,
          lengthMm: Math.round(width + overhang * 2),
          floor: 'roof',
          plan: { x1: minX - overhang, y1: y, x2: maxX + overhang, y2: y },
        });
      }
    } else {
      for (let x = minX - overhang; x <= maxX + overhang + 1; x += spacing) {
        pushMember(members, lumber, {
          kind: 'joist',
          label: 'Балка плоской кровли',
          sectionMm: section,
          lengthMm: Math.round(depth + overhang * 2),
          floor: 'roof',
          plan: { x1: x, y1: minY - overhang, x2: x, y2: maxY + overhang },
        });
      }
    }
  }
}

function svgN(n: number): string {
  return n.toFixed(2);
}

/** Horizontal dimension string under/above drawing. */
function dimH(
  x1: number,
  x2: number,
  y: number,
  label: string,
  side: 'up' | 'down' = 'down',
): string {
  const mid = (x1 + x2) / 2;
  const tick = side === 'down' ? 6 : -6;
  return `
    <g stroke="#111" stroke-width="0.7" fill="#111" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="10">
      <line x1="${svgN(x1)}" y1="${svgN(y)}" x2="${svgN(x2)}" y2="${svgN(y)}"/>
      <line x1="${svgN(x1)}" y1="${svgN(y - tick)}" x2="${svgN(x1)}" y2="${svgN(y + tick)}"/>
      <line x1="${svgN(x2)}" y1="${svgN(y - tick)}" x2="${svgN(x2)}" y2="${svgN(y + tick)}"/>
      <text x="${svgN(mid)}" y="${svgN(y + (side === 'down' ? 12 : -4))}" text-anchor="middle">${label}</text>
    </g>`;
}

function dimV(x: number, y1: number, y2: number, label: string): string {
  const mid = (y1 + y2) / 2;
  return `
    <g stroke="#111" stroke-width="0.7" fill="#111" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="10">
      <line x1="${svgN(x)}" y1="${svgN(y1)}" x2="${svgN(x)}" y2="${svgN(y2)}"/>
      <line x1="${svgN(x - 6)}" y1="${svgN(y1)}" x2="${svgN(x + 6)}" y2="${svgN(y1)}"/>
      <line x1="${svgN(x - 6)}" y1="${svgN(y2)}" x2="${svgN(x + 6)}" y2="${svgN(y2)}"/>
      <text x="${svgN(x - 8)}" y="${svgN(mid)}" text-anchor="end" dominant-baseline="middle">${label}</text>
    </g>`;
}

/**
 * Constructor-style wall framing elevation (развёртка каркаса стены).
 * Lineweights, dimensions, opening callouts — like a shop drawing.
 */
export function renderWallElevationDrawing(
  wall: Wall,
  wallIndex: number,
  openings: Opening[],
  members: FrameMember[],
  titlePrefix = 'Развёртка каркаса стены',
): { wallId: string; title: string; svg: string } {
  const L = wallLength(wall);
  const wallH = wall.height || 2700;
  const mWall = members.filter((m) => m.wallId === wall.id && m.elev);
  const wallOpenings = openingsOnWall(openings, wall.id);

  const marginL = 70;
  const marginR = 40;
  const marginT = 48;
  const marginB = 56;
  const drawW = 980;
  const drawH = 420;
  const scaleX = drawW / Math.max(L, 1);
  const scaleY = drawH / Math.max(wallH, 1);
  const svgW = marginL + drawW + marginR;
  const svgH = marginT + drawH + marginB;

  const X = (s: number) => marginL + s * scaleX;
  const Y = (z: number) => marginT + (wallH - z) * scaleY; // z up → y down

  const ink = '#111827';
  const fillStud = '#f3f4f6';
  const fillKing = '#e5e7eb';
  const fillJack = '#d1d5db';
  const fillHeader = '#9ca3af';
  const fillPlate = '#374151';
  const fillCripple = '#f9fafb';
  const fillOpen = '#ffffff';

  let g = '';

  // Title block
  g += `<text x="${marginL}" y="22" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="14" font-weight="700" fill="${ink}">${titlePrefix} ${wallIndex + 1}</text>`;
  g += `<text x="${marginL}" y="38" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="11" fill="#4b5563">${wall.kind === 'exterior' ? 'Наружная' : 'Внутренняя'} · L=${(L / 1000).toFixed(2)} м · H=${(wallH / 1000).toFixed(2)} м · шаг стоек по проекту</text>`;

  // Outer wall outline
  g += `<rect x="${svgN(X(0))}" y="${svgN(Y(wallH))}" width="${svgN(L * scaleX)}" height="${svgN(wallH * scaleY)}" fill="#fff" stroke="${ink}" stroke-width="1.6"/>`;

  const order = (k: string) =>
    ({ bottom_plate: 0, top_plate: 1, cripple: 2, stud: 3, king_stud: 4, jack_stud: 5, header: 6 })[k] ?? 3;

  // Draw headers once (dedupe overlapping plies)
  const drawnHeaders = new Set<string>();
  for (const m of [...mWall].sort((a, b) => order(a.kind) - order(b.kind))) {
    const e = m.elev!;
    if (m.kind === 'header') {
      const key = `${e.s0}|${e.s1}|${e.z0}|${e.z1}`;
      if (drawnHeaders.has(key)) continue;
      drawnHeaders.add(key);
    }
    const x = X(Math.min(e.s0, e.s1));
    const w = Math.max(1.2, Math.abs(e.s1 - e.s0) * scaleX);
    const y = Y(Math.max(e.z0, e.z1));
    const h = Math.max(1.2, Math.abs(e.z1 - e.z0) * scaleY);
    let fill = fillStud;
    let sw = 0.8;
    if (m.kind === 'bottom_plate' || m.kind === 'top_plate') {
      fill = fillPlate;
      sw = 1.1;
    } else if (m.kind === 'king_stud') fill = fillKing;
    else if (m.kind === 'jack_stud') fill = fillJack;
    else if (m.kind === 'header') fill = fillHeader;
    else if (m.kind === 'cripple') fill = fillCripple;

    g += `<rect x="${svgN(x)}" y="${svgN(y)}" width="${svgN(w)}" height="${svgN(h)}" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>`;

    if (m.kind === 'header') {
      g += `<line x1="${svgN(x)}" y1="${svgN(y + h)}" x2="${svgN(x + w)}" y2="${svgN(y)}" stroke="${ink}" stroke-width="0.55" opacity="0.5"/>`;
      g += `<text x="${svgN(x + w / 2)}" y="${svgN(y + h / 2)}" text-anchor="middle" dominant-baseline="middle" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="9" fill="${ink}">2×</text>`;
    }
  }

  // Opening clear voids (white cutouts with bold outline) — drawn after members so void reads clearly
  for (const o of wallOpenings) {
    const z0 = o.type === 'door' ? 0 : o.sillHeight;
    const z1 = z0 + o.height;
    // Door: void from floor through bottom plate visually starts at z=0; framing still has bottom plate under sides
    const vx = X(o.offset);
    const vy = Y(z1);
    const vw = o.width * scaleX;
    const vh = o.height * scaleY;
    g += `<rect x="${svgN(vx)}" y="${svgN(vy)}" width="${svgN(vw)}" height="${svgN(vh)}" fill="${fillOpen}" stroke="${ink}" stroke-width="1.4"/>`;
    // Opening label inside
    g += `<text x="${svgN(vx + vw / 2)}" y="${svgN(vy + vh / 2)}" text-anchor="middle" dominant-baseline="middle" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="11" fill="${ink}">${o.type === 'window' ? 'Окно' : 'Дверь'} ${o.width}×${o.height}</text>`;
  }

  // Overall dimensions
  g += dimH(X(0), X(L), marginT + drawH + 28, `${Math.round(L)}`, 'down');
  g += dimV(marginL - 28, Y(wallH), Y(0), `${Math.round(wallH)}`);

  // Opening dimensions
  for (const o of wallOpenings) {
    g += dimH(X(o.offset), X(o.offset + o.width), marginT + drawH + 44, `${o.width}`, 'down');
    if (o.type === 'window') {
      g += dimV(X(o.offset + o.width) + 14, Y(o.sillHeight + o.height), Y(o.sillHeight), `${o.height}`);
      g += dimV(X(o.offset) - 14, Y(o.sillHeight), Y(0), `hп=${o.sillHeight}`);
    } else {
      g += dimV(X(o.offset + o.width) + 14, Y(o.height), Y(0), `${o.height}`);
    }
  }

  // Node callouts for first opening (constructor notes)
  if (wallOpenings[0]) {
    const o = wallOpenings[0];
    const tw = 50;
    const notes = [
      { x: X(o.offset - 2 * tw), y: Y(wallH * 0.55), t: 'king' },
      { x: X(o.offset - tw), y: Y(wallH * 0.45), t: 'jack' },
      { x: X(o.offset + o.width / 2), y: Y((o.type === 'door' ? o.height : o.sillHeight + o.height) + 80), t: 'header 2×' },
    ];
    for (const n of notes) {
      g += `<circle cx="${svgN(n.x)}" cy="${svgN(n.y)}" r="3" fill="${ink}"/>`;
      g += `<text x="${svgN(n.x + 6)}" y="${svgN(n.y - 4)}" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="10" fill="${ink}">${n.t}</text>`;
    }
  }

  // Legend
  g += `<g font-family="IBM Plex Sans,Manrope,sans-serif" font-size="9" fill="#4b5563">
    <text x="${marginL}" y="${svgH - 10}">СП 31-105: нижняя обвязка · стойки · двойная верхняя обвязка · king/jack/header у проёмов · калифорнийский угол на стыках стен</text>
  </g>`;

  const title = `Стена ${wallIndex + 1} (${(L / 1000).toFixed(2)} м)`;
  return {
    wallId: wall.id,
    title,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgN(svgW)} ${svgN(svgH)}" width="100%" height="100%" style="background:#fff">${g}</svg>`,
  };
}

const PLAN_COLORS: Record<string, string> = {
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
    <g font-family="IBM Plex Sans,Manrope,sans-serif" font-size="11">
      <text x="8" y="14" fill="#1f3a2e" font-weight="700">План каркаса · этаж ${floor + 1}</text>
      <rect x="8" y="22" width="10" height="10" fill="#334155"/><text x="22" y="31" fill="#334155">стойка</text>
      <rect x="70" y="22" width="10" height="10" fill="#0f766e"/><text x="84" y="31" fill="#0f766e">king</text>
      <rect x="120" y="22" width="10" height="10" fill="#c45c26"/><text x="134" y="31" fill="#c45c26">jack</text>
      <rect x="175" y="22" width="10" height="10" fill="#b45309"/><text x="189" y="31" fill="#b45309">header</text>
      <rect x="245" y="22" width="10" height="10" fill="#0369a1"/><text x="259" y="31" fill="#0369a1">балка</text>
    </g>`;

  let planBody = '';
  for (const m of floorMembers.filter(
    (m) => m.kind === 'joist' || m.kind === 'rim_joist' || m.kind === 'sill',
  )) {
    if (!m.plan) continue;
    const sw = m.kind === 'joist' ? 1.2 : 2.4;
    planBody += `<line x1="${svgN(toX(m.plan.x1))}" y1="${svgN(toY(m.plan.y1))}" x2="${svgN(toX(m.plan.x2))}" y2="${svgN(toY(m.plan.y2))}" stroke="${PLAN_COLORS[m.kind]}" stroke-width="${sw}" opacity="0.55"/>`;
  }
  for (const m of floorMembers.filter((m) => m.kind === 'bottom_plate' || m.kind === 'top_plate')) {
    if (!m.plan) continue;
    planBody += `<line x1="${svgN(toX(m.plan.x1))}" y1="${svgN(toY(m.plan.y1))}" x2="${svgN(toX(m.plan.x2))}" y2="${svgN(toY(m.plan.y2))}" stroke="${PLAN_COLORS[m.kind]}" stroke-width="3.5" stroke-linecap="square"/>`;
  }
  for (const m of floorMembers.filter((m) => m.kind === 'header')) {
    if (!m.plan) continue;
    planBody += `<line x1="${svgN(toX(m.plan.x1))}" y1="${svgN(toY(m.plan.y1))}" x2="${svgN(toX(m.plan.x2))}" y2="${svgN(toY(m.plan.y2))}" stroke="${PLAN_COLORS.header}" stroke-width="5"/>`;
  }
  for (const m of floorMembers.filter((m) => m.planMark)) {
    const mark = m.planMark!;
    const len = m.kind === 'king_stud' || m.kind === 'jack_stud' ? 140 : 110;
    const dx = Math.cos(mark.angle + Math.PI / 2) * len;
    const dy = Math.sin(mark.angle + Math.PI / 2) * len;
    const x = toX(mark.x);
    const y = toY(mark.y);
    const sw = m.kind === 'king_stud' ? 3.2 : m.kind === 'jack_stud' ? 2.8 : 2;
    planBody += `<line x1="${svgN(x - dx)}" y1="${svgN(y - dy)}" x2="${svgN(x + dx)}" y2="${svgN(y + dy)}" stroke="${PLAN_COLORS[m.kind] ?? '#334155'}" stroke-width="${sw}"/>`;
    planBody += `<circle cx="${svgN(x)}" cy="${svgN(y)}" r="2.2" fill="${PLAN_COLORS[m.kind] ?? '#334155'}"/>`;
  }
  for (const o of project.openings.filter((o) => walls.some((w) => w.id === o.wallId))) {
    const wall = walls.find((w) => w.id === o.wallId)!;
    const p = along(wall, o.offset + o.width / 2);
    planBody += `<text x="${svgN(toX(p.x))}" y="${svgN(toY(p.y) - 8)}" text-anchor="middle" font-size="10" fill="${o.type === 'window' ? '#2563eb' : '#b45309'}">${o.type === 'window' ? 'ОКНО' : 'ДВЕРЬ'} ${o.width}×${o.height}</text>`;
  }

  const planSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgN(vw)} ${svgN(vh + 40)}" width="100%" height="100%" style="background:#fff">${legend}<g transform="translate(0,36)">${planBody}</g></svg>`;

  const wallElevations = walls.map((wall, idx) =>
    renderWallElevationDrawing(wall, idx, project.openings, members),
  );

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
    const idx = walls.findIndex((w) => w.id === wall.id);
    return renderWallElevationDrawing(
      wall,
      idx >= 0 ? idx : 0,
      project.openings,
      members,
      title,
    ).svg;
  };

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
    roofBody += `<line x1="${svgN(rx(p.x1))}" y1="${svgN(ry(p.y1))}" x2="${svgN(rx(p.x2))}" y2="${svgN(ry(p.y2))}" stroke="${PLAN_COLORS[m.kind]}" stroke-width="${m.kind === 'ridge' ? 4 : 1.6}"/>`;
  }
  const roofSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgN(rW * rScale)} ${svgN(rH * rScale + 24)}" width="100%" height="100%" style="background:#fff"><text x="8" y="14" font-size="12" fill="#7c2d12" font-family="IBM Plex Sans,Manrope,sans-serif">План стропил · ${project.settings.roofType} · ${project.settings.roofPitchDeg}°</text><g transform="translate(0,20)">${roofBody}</g></svg>`;

  return {
    planSvg,
    elevationFrontSvg: elevSvg(frontWall, 'Фасад — каркас стены'),
    elevationSideSvg: elevSvg(sideWall, 'Торец — каркас стены'),
    roofSvg,
    wallElevations,
  };
}
