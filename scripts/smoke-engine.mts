import { DEFAULT_SETTINGS } from '../src/domain/materials';
import { magnetSnapPoint, weldWallEndpoints, wallRenderEndpoints } from '../src/domain/geometry';
import { generateFrameModel } from '../src/engine/frameEngine';
import { headerHeightMm } from '../src/engine/frameGeometry';
import type { Project } from '../src/domain/types';

const project: Project = {
  id: 't1',
  name: 'test',
  units: 'mm',
  activeFloor: 0,
  updatedAt: new Date().toISOString(),
  settings: {
    ...DEFAULT_SETTINGS,
    floors: 1,
    roofType: 'gable',
    studSpacingMm: 600,
    wasteFactor: 1.1,
    insulation: { ...DEFAULT_SETTINGS.insulation },
    climate: { ...DEFAULT_SETTINGS.climate },
    studSectionMm: { ...DEFAULT_SETTINGS.studSectionMm },
    joistSectionMm: { ...DEFAULT_SETTINGS.joistSectionMm },
  },
  walls: [
    { id: 'w1', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
    { id: 'w2', a: { x: 6000, y: 0 }, b: { x: 6000, y: 6000 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
    { id: 'w3', a: { x: 6000, y: 6000 }, b: { x: 0, y: 6000 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
    { id: 'w4', a: { x: 0, y: 6000 }, b: { x: 0, y: 0 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
    // Mid-span partition T-junction onto w1 (SP 7.2.12) — offset not on stud OC
    {
      id: 'w5',
      a: { x: 3200, y: 0 },
      b: { x: 3200, y: 3000 },
      thickness: 100,
      kind: 'interior',
      height: 2700,
      floor: 0,
    },
  ],
  openings: [
    { id: 'o1', wallId: 'w1', type: 'window', offset: 1500, width: 1200, height: 1400, sillHeight: 900 },
    { id: 'o2', wallId: 'w3', type: 'door', offset: 2500, width: 900, height: 2100, sillHeight: 0 },
  ],
  furniture: [],
};

const model = generateFrameModel(project);
const kinds = model.members.reduce<Record<string, number>>((acc, m) => {
  acc[m.kind] = (acc[m.kind] ?? 0) + 1;
  return acc;
}, {});

const ca = model.members.filter((m) => m.label.includes('Калифорнийский')).length;
const stock6 = model.cutting.every((c) => c.stockLengthMm === 6000 || c.boards.some((b) => b.cuts[0]?.lengthMm > 6000));
const hasBoardCuts = model.cutting.every((c) => c.boards.length > 0 && c.boards[0].cuts.length > 0);
const bomStock = model.bom.filter((b) => b.group === 'Пиломатериал' && b.unit === 'шт');

const report = {
  studs: kinds.stud ?? 0,
  kings: kinds.king_stud ?? 0,
  jacks: kinds.jack_stud ?? 0,
  headers: kinds.header ?? 0,
  california: ca,
  stock6000: stock6,
  hasBoardCuts,
  bomStockLines: bomStock.length,
  // Jacks must support header: jack top == header bottom on same wall
  jackHeaderBearing: (() => {
    const wallId = 'w1';
    const jacks = model.members.filter((m) => m.wallId === wallId && m.kind === 'jack_stud' && m.elev);
    const headers = model.members.filter((m) => m.wallId === wallId && m.kind === 'header' && m.elev);
    if (!jacks.length || !headers.length) return false;
    const headerBottom = Math.min(...headers.map((h) => h.elev!.z0));
    return jacks.every((j) => Math.abs(j.elev!.z1 - headerBottom) < 2);
  })(),
  // Jacks sit outside clear opening (not inside) — SP 7.2.13
  jacksOutsideOpening: (() => {
    const jacks = model.members.filter((m) => m.wallId === 'w1' && m.kind === 'jack_stud' && m.elev);
    // opening 1500..2700 — jack left should end at ~1500, jack right start at ~2700
    const left = jacks.find((j) => j.elev!.s1 <= 1550);
    const right = jacks.find((j) => j.elev!.s0 >= 2650);
    return Boolean(left && right);
  })(),
  // SP: double top plate
  doubleTopPlate: (() => {
    const tops = model.members.filter((m) => m.wallId === 'w1' && m.kind === 'top_plate');
    return tops.length >= 2;
  })(),
  // SP platform: bottom plate interrupted in door clear (2500..3400 on w3)
  doorBottomPlateCut: (() => {
    const plates = model.members.filter(
      (m) => m.wallId === 'w3' && m.kind === 'bottom_plate' && m.label === 'Нижняя обвязка' && m.elev,
    );
    if (plates.length < 2) return false;
    const coversDoor = plates.some((p) => {
      const mid = (p.elev!.s0 + p.elev!.s1) / 2;
      return mid > 2500 && mid < 3400;
    });
    return !coversDoor;
  })(),
  // Header height from SP B.13 for 1200 mm span, 1 floor → 150 mm
  headerHeightSp: (() => {
    const expected = headerHeightMm(1200, 1);
    const headers = model.members.filter((m) => m.wallId === 'w1' && m.kind === 'header');
    return headers.length >= 2 && headers.every((h) => h.sectionMm.depth === expected);
  })(),
  // Header spacer so assembly thickness = stud depth (7.2.14)
  headerSpacer: model.members.some(
    (m) => m.wallId === 'w1' && m.kind === 'blocking' && m.label.includes('Прокладка перемычки'),
  ),
  // SP 7.2.12 T-junction stud on host wall w1 near x=3000
  partitionJunction: model.members.some(
    (m) => m.wallId === 'w1' && m.label.includes('примыкания перегородки'),
  ),
  // Anchor note references SP 2.4 m
  anchorSpNote: model.bom.some((b) => b.note?.includes('2,4') && b.name.includes('Анкер')),
  elevHasDims: model.projections.wallElevations.some((w) => w.svg.includes('text-anchor="middle"')),
  elevHasNodeCallouts: model.projections.wallElevations.some(
    (w) => w.svg.includes('>king<') && w.svg.includes('>jack<') && w.svg.includes('header 2×'),
  ),
};

console.log(JSON.stringify(report, null, 2));

if (
  report.jacks < 4 ||
  report.kings < 4 ||
  report.headers < 4 ||
  report.california < 8 ||
  !report.stock6000 ||
  !report.hasBoardCuts ||
  report.bomStockLines < 1 ||
  !report.jackHeaderBearing ||
  !report.jacksOutsideOpening ||
  !report.doubleTopPlate ||
  !report.doorBottomPlateCut ||
  !report.headerHeightSp ||
  !report.headerSpacer ||
  !report.partitionJunction ||
  !report.anchorSpNote ||
  !report.elevHasDims ||
  !report.elevHasNodeCallouts
) {
  console.error('Smoke failed', report);
  process.exit(1);
}

// —— Structural: 8 m house WITHOUT bearing partition must FAIL floor span ——
const openSpan: Project = {
  ...project,
  id: 't-open',
  settings: {
    ...project.settings,
    joistSectionMm: { width: 50, depth: 200 },
    joistSpacingMm: 600,
  },
  walls: [
    { id: 'a1', a: { x: 0, y: 0 }, b: { x: 8000, y: 0 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
    { id: 'a2', a: { x: 8000, y: 0 }, b: { x: 8000, y: 6000 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
    { id: 'a3', a: { x: 8000, y: 6000 }, b: { x: 0, y: 6000 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
    { id: 'a4', a: { x: 0, y: 6000 }, b: { x: 0, y: 0 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
  ],
  openings: [],
};
const openModel = generateFrameModel(openSpan);
const openFail = openModel.structural.summary.fail > 0;
const openJoistFail = openModel.structural.checks.some(
  (c) => c.id.startsWith('floor_span') && c.severity === 'fail',
);
const openMaxBay = openModel.structural.members.find((m) => m.id.startsWith('joist'))?.spanM ?? 0;

// —— Structural: same house WITH full mid wall + 50×250 → floor span OK ——
const supported: Project = {
  ...openSpan,
  id: 't-supported',
  settings: {
    ...openSpan.settings,
    joistSectionMm: { width: 50, depth: 250 },
    joistSpacingMm: 600,
  },
  walls: [
    ...openSpan.walls,
    {
      id: 'mid',
      a: { x: 4000, y: 0 },
      b: { x: 4000, y: 6000 },
      thickness: 120,
      kind: 'interior',
      height: 2700,
      floor: 0,
    },
  ],
};
const supportedModel = generateFrameModel(supported);
const supportedJoistOk = supportedModel.structural.checks.some(
  (c) => c.id.startsWith('floor_span') && c.severity === 'ok',
);
const supportedBay = supportedModel.structural.members.find((m) => m.id.startsWith('joist'))?.spanM ?? 0;
const hasSplitJoists = supportedModel.members.some(
  (m) => m.kind === 'joist' && m.lengthMm <= 4100,
);
const hasForces = supportedModel.structural.members.every(
  (m) => m.momentKNm > 0 && m.deflectionLimitMm > 0,
);

const structReport = {
  openFail,
  openJoistFail,
  openMaxBay,
  supportedJoistOk,
  supportedBay,
  hasSplitJoists,
  hasForces,
  supportedWorst: supportedModel.structural.summary.worst,
};

console.log('structural', JSON.stringify(structReport, null, 2));

if (
  !openFail ||
  !openJoistFail ||
  openMaxBay < 5.5 ||
  !supportedJoistOk ||
  supportedBay > 4.1 ||
  !hasSplitJoists ||
  !hasForces
) {
  console.error('Structural smoke failed', structReport);
  process.exit(1);
}

// —— Magnet: corner approach must butt-join tip-to-tip, not snap into wall body ——
const existing = [
  {
    id: 'h',
    a: { x: 0, y: 0 },
    b: { x: 6000, y: 0 },
    thickness: 200,
    kind: 'exterior' as const,
    height: 2700,
    floor: 0 as const,
  },
];

// Approach corner from +Y, slightly inset in X (old bug: snapped onto segment at x≈100)
const approach = { x: 100, y: 120 };
const cornerHit = magnetSnapPoint(approach, existing, { freeWhenFar: true });
const midApproach = { x: 3000, y: 80 };
const midHit = magnetSnapPoint(midApproach, existing, { freeWhenFar: true });
const farCorner = { x: 180, y: 200 };
const farHit = magnetSnapPoint(farCorner, existing, { freeWhenFar: true });
// Click ~450mm along wall — must still promote to tip, not nest into body
const inset = { x: 450, y: 80 };
const insetHit = magnetSnapPoint(inset, existing, { freeWhenFar: true });

const magnetReport = {
  cornerKind: cornerHit.kind,
  cornerAt: cornerHit.point,
  midKind: midHit.kind,
  midAt: midHit.point,
  farKind: farHit.kind,
  farAt: farHit.point,
  insetKind: insetHit.kind,
  insetAt: insetHit.point,
};

console.log('magnet', JSON.stringify(magnetReport, null, 2));

if (
  cornerHit.kind !== 'endpoint' ||
  Math.hypot(cornerHit.point.x - 0, cornerHit.point.y - 0) > 1 ||
  midHit.kind !== 'segment' ||
  Math.abs(midHit.point.x - 3000) > 1 ||
  Math.abs(midHit.point.y - 0) > 1 ||
  farHit.kind !== 'endpoint' ||
  Math.hypot(farHit.point.x - 0, farHit.point.y - 0) > 1 ||
  insetHit.kind !== 'endpoint' ||
  Math.hypot(insetHit.point.x - 0, insetHit.point.y - 0) > 1
) {
  console.error('Magnet smoke failed', magnetReport);
  process.exit(1);
}

// Weld nearby mismatched tips
const mismatched = [
  {
    id: 'c1',
    a: { x: 0, y: 0 },
    b: { x: 4000, y: 0 },
    thickness: 200,
    kind: 'exterior' as const,
    height: 2700,
    floor: 0 as const,
  },
  {
    id: 'c2',
    a: { x: 80, y: 0 }, // 80mm off tip — must weld to (0,0)
    b: { x: 0, y: 4000 },
    thickness: 200,
    kind: 'exterior' as const,
    height: 2700,
    floor: 0 as const,
  },
];
const welded = weldWallEndpoints(mismatched, 0);
const tipJoined =
  welded[0].a.x === welded[1].a.x &&
  welded[0].a.y === welded[1].a.y;
if (!tipJoined) {
  console.error('Weld failed', welded.map((w) => ({ a: w.a, b: w.b })));
  process.exit(1);
}
console.log('weld', { tip: welded[0].a, tipJoined });

// Render inset: shared corner must shorten draw so strokes don't cross
const renderWalls = [
  {
    id: 'r1',
    a: { x: 0, y: 0 },
    b: { x: 4000, y: 0 },
    thickness: 200,
    kind: 'exterior' as const,
    height: 2700,
    floor: 0 as const,
  },
  {
    id: 'r2',
    a: { x: 0, y: 0 },
    b: { x: 0, y: 4000 },
    thickness: 200,
    kind: 'exterior' as const,
    height: 2700,
    floor: 0 as const,
  },
];
const r1 = wallRenderEndpoints(renderWalls[0], renderWalls);
const r2 = wallRenderEndpoints(renderWalls[1], renderWalls);
const renderReport = {
  r1a: r1.a,
  r2a: r2.a,
  hInsetOk: Math.abs(r1.a.x - 100) < 1 && Math.abs(r1.a.y) < 1,
  vInsetOk: Math.abs(r2.a.x) < 1 && Math.abs(r2.a.y - 100) < 1,
};
console.log('renderInset', renderReport);
if (!renderReport.hInsetOk || !renderReport.vInsetOk) {
  console.error('Render inset failed', renderReport);
  process.exit(1);
}

// Corner node assembly after tip-to-tip join
const cornerProject: Project = {
  ...project,
  id: 't-corner',
  walls: [
    {
      id: 'c1',
      a: { x: 0, y: 0 },
      b: { x: 4000, y: 0 },
      thickness: 200,
      kind: 'exterior',
      height: 2700,
      floor: 0,
    },
    {
      id: 'c2',
      a: { x: 0, y: 0 }, // shared tip
      b: { x: 0, y: 4000 },
      thickness: 200,
      kind: 'exterior',
      height: 2700,
      floor: 0,
    },
  ],
  openings: [],
};
const cornerModel = generateFrameModel(cornerProject);
const californiaAtCorner = cornerModel.members.filter((m) =>
  m.label.includes('Калифорнийский'),
).length;
if (californiaAtCorner < 3) {
  console.error('Corner nodes not assembled', { californiaAtCorner });
  process.exit(1);
}
console.log('cornerNodes', { californiaAtCorner });

