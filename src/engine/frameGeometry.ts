import {
  detectWallJoints,
  isThroughWall,
  pointAlongWall,
  projectPointOnSegment,
  uid,
  wallAngle,
  wallLength,
} from '../domain/geometry';
import type {
  FloorLevel,
  FrameMember,
  LumberPiece,
  Opening,
  Point,
  Project,
  ProjectSettings,
  Wall,
  WallJoint,
} from '../domain/types';
import { analyzeFloorBays } from './floorLayout';
import { headerHeightMm } from './spanTables';

export { headerHeightMm };

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

type Occ = { s0: number; s1: number };

/**
 * Wall framing per SP 31-105-2002 §7.2 platform framing.
 * Opening clear span = [offset, offset+width] between INNER faces of jacks (7.2.13):
 *   [king][jack] | opening | [jack][king]
 * Header: two boards on edge bearing on both jacks (7.2.14); assembly thickness = stud depth.
 * Bottom plate continuous under windows; interrupted in door clear opening.
 * Double top plate (7.2.6).
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
  const studDepth = section.depth;
  const spacing = settings.studSpacingMm;
  // Plate thickness in elevation ≈ stud width (board on flat); plate width ≥ stud depth (7.2.7)
  const plateThk = tw;
  const topPlies = 2;
  const topH = plateThk * topPlies;
  const bottomH = plateThk;
  const studTop = H - topH;
  const studBot = bottomH;
  const ang = wallAngle(wall);

  // Door clear gaps — bottom plate is cut between jacks (platform framing)
  const doorGaps: Occ[] = [];
  for (const o of wallOpenings) {
    if (o.type !== 'door') continue;
    const clearL = Math.max(0, Math.round(o.offset));
    const clearR = Math.min(len, Math.round(o.offset + o.width));
    if (clearR - clearL >= 300) doorGaps.push({ s0: clearL, s1: clearR });
  }

  const emitBottomPlate = (s0: number, s1: number) => {
    const L = Math.round(s1 - s0);
    if (L < 40) return;
    pushMember(members, lumber, {
      kind: 'bottom_plate',
      label: 'Нижняя обвязка',
      sectionMm: section,
      lengthMm: L,
      floor: wall.floor,
      wallId: wall.id,
      plan: plateSegment(wall, s0, s1, 0),
      elev: { s0, s1, z0: 0, z1: bottomH },
    });
  };

  let plateCursor = 0;
  for (const g of doorGaps) {
    emitBottomPlate(plateCursor, g.s0);
    plateCursor = g.s1;
  }
  emitBottomPlate(plateCursor, len);

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

    // [king][jack] | clear | [jack][king] — SP 7.2.13 double studs at openings
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

    // Header height from SP app. B.13; thickness of assembly = stud depth (7.2.14)
    const headerDepth = headerHeightMm(clearW, settings.floors);
    const headerBottom =
      o.type === 'door' ? Math.min(o.height, studTop - headerDepth) : o.sillHeight + o.height;
    const headerTop = Math.min(studTop, headerBottom + headerDepth);

    // Kings — continuous bottom plate to top plate (outer of the pair)
    addPost('king_stud', 'Королевская стойка', kingL, studBot, studTop);
    addPost('king_stud', 'Королевская стойка', kingR, studBot, studTop);

    // Jacks — from bottom plate to underside of header (inner, bear the header)
    addPost('jack_stud', 'Опорная стойка (джек)', jackL, studBot, headerBottom);
    addPost('jack_stud', 'Опорная стойка (джек)', jackR, studBot, headerBottom);

    // Double header on edge (2 boards), bears on both jacks; spacer if 2×width < stud depth
    const headerS0 = jackL;
    const headerS1 = jackR + tw;
    const headerLen = Math.round(headerS1 - headerS0);
    for (let ply = 0; ply < 2; ply++) {
      pushMember(members, lumber, {
        kind: 'header',
        label: `Перемычка ${clearW} мм (${ply + 1}/2)`,
        sectionMm: { width: tw, depth: headerDepth },
        lengthMm: headerLen,
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
    const spacerThk = studDepth - 2 * tw;
    if (spacerThk >= 20) {
      pushMember(members, lumber, {
        kind: 'blocking',
        label: `Прокладка перемычки (${spacerThk} мм, толщина = глубина стойки)`,
        sectionMm: { width: spacerThk, depth: headerDepth },
        lengthMm: headerLen,
        floor: wall.floor,
        wallId: wall.id,
        plan: plateSegment(wall, headerS0, headerS1, 28),
        elev: { s0: headerS0, s1: headerS1, z0: headerBottom, z1: headerTop },
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

function jointsOnFloors(walls: Wall[]): WallJoint[] {
  const seen = new Set<FloorLevel>();
  const out: WallJoint[] = [];
  for (const w of walls) {
    if (seen.has(w.floor)) continue;
    seen.add(w.floor);
    out.push(...detectWallJoints(walls, w.floor));
  }
  return out;
}

function endStudS(wall: Wall, end: 'a' | 'b', tw: number, inset = 0): number {
  const len = wallLength(wall);
  if (end === 'a') return Math.max(0, Math.min(len - tw, inset * tw));
  return Math.max(0, len - (inset + 1) * tw);
}

function postOccupied(
  members: FrameMember[],
  wallId: string,
  s: number,
  tw: number,
): boolean {
  return members.some(
    (m) =>
      m.wallId === wallId &&
      m.elev &&
      ['stud', 'corner_stud', 'king_stud', 'jack_stud'].includes(m.kind) &&
      Math.abs(m.elev.s0 - s) < tw,
  );
}

/**
 * Skip ordinary end studs at L-joints — California 2+1 assembly replaces them.
 * Driven by `detectWallJoints` (shared tips and Planner butt docks).
 */
export function prepareWallSkipFlags(walls: Wall[]): Map<string, { start: boolean; end: boolean }> {
  const skip = new Map<string, { start: boolean; end: boolean }>();
  for (const w of walls) skip.set(w.id, { start: false, end: false });

  for (const j of jointsOnFloors(walls)) {
    if (j.kind !== 'L') continue;
    for (const e of j.ends) {
      if (e.end === 'span') continue;
      const flags = skip.get(e.wallId);
      if (!flags) continue;
      if (e.end === 'a') flags.start = true;
      else flags.end = true;
    }
  }
  return skip;
}

/**
 * SP 31-105-2002 §7.2.11 — California / «тёплый» corner at every L-joint.
 * Through wall: two studs (outer + interior nailing). Butt wall: one end stud.
 * Joints come from `detectWallJoints` (canvas walljoint), not tip heuristics.
 */
export function buildCaliforniaCorners(
  walls: Wall[],
  settings: ProjectSettings,
  members: FrameMember[],
  lumber: LumberPiece[],
) {
  const byId = new Map(walls.map((w) => [w.id, w]));
  const section = settings.studSectionMm;
  const tw = section.width;
  const plateThk = tw;
  const bottomH = plateThk;
  const topH = plateThk * 2;
  const done = new Set<string>();

  const addCornerStud = (wall: Wall, s: number, label: string) => {
    const clamped = Math.max(0, Math.min(wallLength(wall) - tw, Math.round(s)));
    if (postOccupied(members, wall.id, clamped, tw)) return;
    const H = wall.height || settings.floorHeightMm;
    const p = along(wall, clamped + tw / 2);
    pushMember(members, lumber, {
      kind: 'corner_stud',
      label,
      sectionMm: section,
      lengthMm: H - bottomH - topH,
      floor: wall.floor,
      wallId: wall.id,
      planMark: { x: p.x, y: p.y, angle: wallAngle(wall) },
      elev: { s0: clamped, s1: clamped + tw, z0: bottomH, z1: H - topH },
    });
  };

  for (const j of jointsOnFloors(walls)) {
    if (j.kind !== 'L') continue;
    const e0 = j.ends.find((e) => e.wallId === j.wallIds[0]);
    const e1 = j.ends.find((e) => e.wallId === j.wallIds[1]);
    if (!e0 || !e1 || e0.end === 'span' || e1.end === 'span') continue;

    const w0 = byId.get(j.wallIds[0]);
    const w1 = byId.get(j.wallIds[1]);
    if (!w0 || !w1) continue;

    const key = `${[w0.id, w1.id].sort().join(':')}:${e0.end}:${e1.end}`;
    if (done.has(key)) continue;
    done.add(key);

    const through = isThroughWall(w0, w1) ? w0 : w1;
    const butt = through.id === w0.id ? w1 : w0;
    const throughEnd = through.id === w0.id ? e0.end : e1.end;
    const buttEnd = butt.id === w0.id ? e0.end : e1.end;

    addCornerStud(
      through,
      endStudS(through, throughEnd, tw, 0),
      'Калифорнийский угол — стойка 1 (СП 7.2.11)',
    );
    addCornerStud(
      through,
      endStudS(through, throughEnd, tw, 1),
      'Калифорнийский угол — стойка 2 (тёплый угол)',
    );
    addCornerStud(
      butt,
      endStudS(butt, buttEnd, tw, 0),
      'Калифорнийский угол — примыкание (СП 7.2.11)',
    );
  }
}

/**
 * SP 7.2.12 — T-joint of a partition onto a continuous wall:
 * full-height backing stud on the host at the joint (from `detectWallJoints`).
 */
export function buildPartitionJunctions(
  walls: Wall[],
  settings: ProjectSettings,
  members: FrameMember[],
  lumber: LumberPiece[],
) {
  const byId = new Map(walls.map((w) => [w.id, w]));
  const section = settings.studSectionMm;
  const tw = section.width;
  const plateThk = tw;
  const bottomH = plateThk;
  const topH = plateThk * 2;

  for (const j of jointsOnFloors(walls)) {
    if (j.kind !== 'T') continue;
    const span = j.ends.find((e) => e.end === 'span');
    if (!span) continue;
    const host = byId.get(span.wallId);
    if (!host) continue;

    const hostLen = wallLength(host);
    const hit = projectPointOnSegment(j.point, host.a, host.b);
    const s = hit.t * hostLen;
    if (s < tw * 2 || s > hostLen - tw * 2) continue;

    const sClamped = Math.max(0, Math.min(hostLen - tw, Math.round(s - tw / 2)));
    if (postOccupied(members, host.id, sClamped, tw)) continue;

    const H = host.height || settings.floorHeightMm;
    const p = along(host, sClamped + tw / 2);
    pushMember(members, lumber, {
      kind: 'stud',
      label: 'Стойка примыкания перегородки (СП 7.2.12)',
      sectionMm: section,
      lengthMm: H - bottomH - topH,
      floor: host.floor,
      wallId: host.id,
      planMark: { x: p.x, y: p.y, angle: wallAngle(host) },
      elev: { s0: sClamped, s1: sClamped + tw, z0: bottomH, z1: H - topH },
    });
  }
}

export function buildFloorMembers(
  project: Project,
  floor: FloorLevel,
  members: FrameMember[],
  lumber: LumberPiece[],
) {
  const layout = analyzeFloorBays(project, floor);
  const { minX, minY, maxX, maxY } = layout.bounds;
  if (layout.supportCount < 2 || layout.maxBayM <= 0) return;

  const joist = project.settings.joistSectionMm;
  const spacing = project.settings.joistSpacingMm;
  const refWalls = project.walls.filter(
    (w) =>
      w.kind === 'exterior' &&
      (w.floor === floor || (floor === 1 && !project.walls.some((x) => x.floor === 1 && x.kind === 'exterior'))),
  );

  if (floor === 0) {
    for (const wall of refWalls.filter((w) => w.floor === 0)) {
      const L = Math.round(wallLength(wall));
      // SP 6.2.8.4 — sill (опорная доска) not less than 38×88; use 50×150 stock
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

  // Rim joists around footprint
  pushMember(members, lumber, {
    kind: 'rim_joist',
    label: 'Обвязочная балка',
    sectionMm: joist,
    lengthMm: Math.round(maxY - minY),
    floor,
    plan: { x1: minX, y1: minY, x2: minX, y2: maxY },
  });
  pushMember(members, lumber, {
    kind: 'rim_joist',
    label: 'Обвязочная балка',
    sectionMm: joist,
    lengthMm: Math.round(maxY - minY),
    floor,
    plan: { x1: maxX, y1: minY, x2: maxX, y2: maxY },
  });
  pushMember(members, lumber, {
    kind: 'rim_joist',
    label: 'Торцевая обвязка',
    sectionMm: joist,
    lengthMm: Math.round(maxX - minX),
    floor,
    plan: { x1: minX, y1: minY, x2: maxX, y2: minY },
  });
  pushMember(members, lumber, {
    kind: 'rim_joist',
    label: 'Торцевая обвязка',
    sectionMm: joist,
    lengthMm: Math.round(maxX - minX),
    floor,
    plan: { x1: minX, y1: maxY, x2: maxX, y2: maxY },
  });

  // Intermediate bearing rim along interior supports
  for (let i = 1; i < layout.supportsMm.length - 1; i++) {
    const s = layout.supportsMm[i];
    if (layout.spanAxis === 'x') {
      pushMember(members, lumber, {
        kind: 'rim_joist',
        label: 'Опорная балка на внутренней стене',
        sectionMm: joist,
        lengthMm: Math.round(maxY - minY),
        floor,
        plan: { x1: s, y1: minY, x2: s, y2: maxY },
      });
    } else {
      pushMember(members, lumber, {
        kind: 'rim_joist',
        label: 'Опорная балка на внутренней стене',
        sectionMm: joist,
        lengthMm: Math.round(maxX - minX),
        floor,
        plan: { x1: minX, y1: s, x2: maxX, y2: s },
      });
    }
  }

  const label = floor === 0 ? 'Балка черного пола' : 'Балка перекрытия';

  if (layout.spanAxis === 'x') {
    // Joists span X within each bay; laid out along Y
    for (let i = 0; i < layout.supportsMm.length - 1; i++) {
      const x0 = layout.supportsMm[i];
      const x1 = layout.supportsMm[i + 1];
      const span = Math.round(x1 - x0);
      for (let y = minY; y <= maxY + 1; y += spacing) {
        pushMember(members, lumber, {
          kind: 'joist',
          label: `${label} (пролёт ${(span / 1000).toFixed(2)} м)`,
          sectionMm: joist,
          lengthMm: span,
          floor,
          plan: { x1: x0, y1: y, x2: x1, y2: y },
        });
      }
    }
  } else {
    for (let i = 0; i < layout.supportsMm.length - 1; i++) {
      const y0 = layout.supportsMm[i];
      const y1 = layout.supportsMm[i + 1];
      const span = Math.round(y1 - y0);
      for (let x = minX; x <= maxX + 1; x += spacing) {
        pushMember(members, lumber, {
          kind: 'joist',
          label: `${label} (пролёт ${(span / 1000).toFixed(2)} м)`,
          sectionMm: joist,
          lengthMm: span,
          floor,
          plan: { x1: x, y1: y0, x2: x, y2: y1 },
        });
      }
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
      plan: { x1: cx, y1: minY - overhang, x2: cx, y2: maxY + overhang },
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
        plan: { x1: minX - overhang, y1: y, x2: maxX + overhang, y2: y },
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
        plan: { x1: minX - overhang, y1: y, x2: maxX + overhang, y2: y },
      });
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
  const fillCorner = '#fbbf24';
  const fillOpen = '#ffffff';

  let g = '';

  // Title block
  const hasWarmCorner = mWall.some((m) => m.kind === 'corner_stud');
  g += `<text x="${marginL}" y="22" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="14" font-weight="700" fill="${ink}">${titlePrefix} ${wallIndex + 1}</text>`;
  g += `<text x="${marginL}" y="38" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="11" fill="#4b5563">${wall.kind === 'exterior' ? 'Наружная' : 'Внутренняя'} · L=${(L / 1000).toFixed(2)} м · H=${(wallH / 1000).toFixed(2)} м · шаг стоек по проекту${hasWarmCorner ? ' · тёплый угол СП 7.2.11' : ''}</text>`;

  // Outer wall outline
  g += `<rect x="${svgN(X(0))}" y="${svgN(Y(wallH))}" width="${svgN(L * scaleX)}" height="${svgN(wallH * scaleY)}" fill="#fff" stroke="${ink}" stroke-width="1.6"/>`;

  const order = (k: string) =>
    ({
      bottom_plate: 0,
      top_plate: 1,
      cripple: 2,
      stud: 3,
      corner_stud: 3.5,
      king_stud: 4,
      jack_stud: 5,
      blocking: 5.5,
      header: 6,
    })[k] ?? 3;

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
    else if (m.kind === 'corner_stud') fill = fillCorner;

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

  // Node callouts for first opening — positions from generated jack/king geometry
  if (wallOpenings[0]) {
    const o = wallOpenings[0];
    const kings = mWall.filter((m) => m.kind === 'king_stud' && m.elev);
    const jacks = mWall.filter((m) => m.kind === 'jack_stud' && m.elev);
    const headers = mWall.filter((m) => m.kind === 'header' && m.elev);
    const leftKing = kings
      .filter((m) => m.elev!.s1 <= o.offset + 1)
      .sort((a, b) => b.elev!.s0 - a.elev!.s0)[0];
    const leftJack = jacks
      .filter((m) => m.elev!.s1 <= o.offset + 1)
      .sort((a, b) => b.elev!.s0 - a.elev!.s0)[0];
    const hdr = headers[0];
    const notes: { x: number; y: number; t: string }[] = [];
    if (leftKing) {
      notes.push({
        x: X((leftKing.elev!.s0 + leftKing.elev!.s1) / 2),
        y: Y(wallH * 0.55),
        t: 'king',
      });
    }
    if (leftJack) {
      notes.push({
        x: X((leftJack.elev!.s0 + leftJack.elev!.s1) / 2),
        y: Y(wallH * 0.45),
        t: 'jack',
      });
    }
    if (hdr) {
      notes.push({
        x: X((hdr.elev!.s0 + hdr.elev!.s1) / 2),
        y: Y(hdr.elev!.z1 + 40),
        t: 'header 2×',
      });
    }
    for (const n of notes) {
      g += `<circle cx="${svgN(n.x)}" cy="${svgN(n.y)}" r="3" fill="${ink}"/>`;
      g += `<text x="${svgN(n.x + 6)}" y="${svgN(n.y - 4)}" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="10" fill="${ink}">${n.t}</text>`;
    }
  }

  // California / warm-corner callouts at wall ends (SP 7.2.11)
  const cornerPosts = mWall.filter((m) => m.kind === 'corner_stud' && m.elev);
  if (cornerPosts.length) {
    const left = cornerPosts.filter((m) => m.elev!.s0 < L / 2).sort((a, b) => a.elev!.s0 - b.elev!.s0);
    const right = cornerPosts.filter((m) => m.elev!.s0 >= L / 2).sort((a, b) => b.elev!.s0 - a.elev!.s0);
    const mark = (group: typeof cornerPosts, tag: string) => {
      if (!group.length) return;
      const midS = (group[0].elev!.s0 + group[group.length - 1].elev!.s1) / 2;
      const x = X(midS);
      const y = Y(wallH * 0.72);
      g += `<rect x="${svgN(x - 36)}" y="${svgN(y - 12)}" width="72" height="16" rx="3" fill="#fef3c7" stroke="#d97706" stroke-width="0.8"/>`;
      g += `<text x="${svgN(x)}" y="${svgN(y)}" text-anchor="middle" dominant-baseline="middle" font-family="IBM Plex Sans,Manrope,sans-serif" font-size="8" fill="#92400e">${tag}</text>`;
    };
    mark(left, 'тёплый угол');
    mark(right, 'тёплый угол');
  }

  // Legend
  g += `<g font-family="IBM Plex Sans,Manrope,sans-serif" font-size="9" fill="#4b5563">
    <text x="${marginL}" y="${svgH - 10}">СП 31-105 §7.2: нижняя обвязка · стойки · двойная верхняя обвязка · king/jack/header у проёмов · калифорнийский тёплый угол (7.2.11) · примыкания перегородок (7.2.12)</text>
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
  corner_stud: '#d97706',
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
      <rect x="70" y="22" width="10" height="10" fill="#d97706"/><text x="84" y="31" fill="#d97706">угол</text>
      <rect x="128" y="22" width="10" height="10" fill="#0f766e"/><text x="142" y="31" fill="#0f766e">king</text>
      <rect x="188" y="22" width="10" height="10" fill="#c45c26"/><text x="202" y="31" fill="#c45c26">jack</text>
      <rect x="243" y="22" width="10" height="10" fill="#b45309"/><text x="257" y="31" fill="#b45309">header</text>
      <rect x="313" y="22" width="10" height="10" fill="#0369a1"/><text x="327" y="31" fill="#0369a1">балка</text>
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
    const sw = m.kind === 'king_stud' ? 3.2 : m.kind === 'jack_stud' ? 2.8 : m.kind === 'corner_stud' ? 3.4 : 2;
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
