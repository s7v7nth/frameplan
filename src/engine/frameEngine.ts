import { polygonAreaFromExterior, uid, volumeM3, wallLength } from '../domain/geometry';
import {
  EXTERIOR_CLADDING,
  FLOOR_FINISH,
  INTERIOR_FINISH,
  STOCK_LENGTHS_MM,
} from '../domain/materials';
import type {
  BomLine,
  CuttingStock,
  FloorLevel,
  FrameMember,
  FrameModel,
  HeatLossResult,
  HeatLossSurface,
  LumberPiece,
  Project,
  SheetItem,
} from '../domain/types';
import {
  buildFloorMembers,
  buildRoofMembers,
  buildWallMembers,
  renderFrameProjections,
} from './frameGeometry';

function addSheet(sheets: SheetItem[], partial: Omit<SheetItem, 'id'>) {
  sheets.push({ id: uid('sheet'), ...partial });
}

function generateSheathing(project: Project, sheets: SheetItem[]) {
  const floors: FloorLevel[] = project.settings.floors === 2 ? [0, 1] : [0];
  const ext = EXTERIOR_CLADDING[project.settings.exteriorCladding];
  const inn = INTERIOR_FINISH[project.settings.interiorFinish];
  const height = project.settings.floorHeightMm;
  const sheetM2 = (1250 * 2500) / 1e6;

  for (const fl of floors) {
    const walls = project.walls.filter((w) => w.floor === fl);
    const exteriorLen = walls
      .filter((w) => w.kind === 'exterior')
      .reduce((s, w) => s + wallLength(w), 0);
    const interiorLen = walls
      .filter((w) => w.kind === 'interior')
      .reduce((s, w) => s + wallLength(w), 0);

    const openingArea = project.openings
      .filter((o) => walls.some((w) => w.id === o.wallId))
      .reduce((s, o) => s + (o.width * o.height) / 1e6, 0);

    const exteriorArea =
      Math.max(0, (exteriorLen * height) / 1e6 - openingArea) * project.settings.wasteFactor;
    const interiorArea =
      Math.max(0, ((exteriorLen + interiorLen * 2) * height) / 1e6 - openingArea) *
      project.settings.wasteFactor;

    addSheet(sheets, {
      category: 'wall_sheathing',
      label: 'ОСП наружная обшивка 12 мм',
      thicknessMm: 12,
      widthMm: 1250,
      heightMm: 2500,
      areaM2: exteriorArea,
      qty: Math.ceil(exteriorArea / sheetM2),
    });
    addSheet(sheets, {
      category: 'cladding',
      label: ext.name,
      thicknessMm: ext.thicknessMm ?? 10,
      widthMm: 1250,
      heightMm: 2500,
      areaM2: exteriorArea,
      qty: Math.ceil(exteriorArea / sheetM2),
    });
    addSheet(sheets, {
      category: 'interior',
      label: inn.name,
      thicknessMm: inn.thicknessMm ?? 12.5,
      widthMm: 1200,
      heightMm: 2500,
      areaM2: interiorArea,
      qty: Math.ceil(interiorArea / ((1200 * 2500) / 1e6)),
    });
  }

  // Subfloor sheets from footprint
  const area0 = polygonAreaFromExterior(
    project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior'),
  );
  const finish = FLOOR_FINISH[project.settings.floorFinish];
  for (let fl = 0; fl < project.settings.floors; fl++) {
    const sheetArea = area0 * project.settings.wasteFactor;
    addSheet(sheets, {
      category: 'subfloor',
      label: finish.name,
      thicknessMm: finish.thicknessMm ?? 18,
      widthMm: 1250,
      heightMm: 2500,
      areaM2: sheetArea,
      qty: Math.ceil(sheetArea / sheetM2),
    });
  }

  // Roof sheathing rough from members bounding box
  const roofArea = area0 * (project.settings.roofType === 'flat' ? 1.05 : 1.25) * project.settings.wasteFactor;
  addSheet(sheets, {
    category: 'roof_sheathing',
    label: 'Обрешётка/ОСП кровли 12 мм',
    thicknessMm: 12,
    widthMm: 1250,
    heightMm: 2500,
    areaM2: roofArea,
    qty: Math.ceil(roofArea / sheetM2),
  });
}

/** First-fit decreasing nesting onto stock lengths. */
export function nestCutting(lumber: LumberPiece[], wasteFactor: number): CuttingStock[] {
  type Key = string;
  const groups = new Map<Key, LumberPiece[]>();
  for (const p of lumber) {
    const key = `${p.sectionMm.width}x${p.sectionMm.depth}`;
    const arr = groups.get(key) ?? [];
    for (let i = 0; i < p.qty; i++) arr.push({ ...p, qty: 1 });
    groups.set(key, arr);
  }

  const result: CuttingStock[] = [];
  for (const [, pieces] of groups) {
    const section = pieces[0].sectionMm;
    const expanded = pieces
      .map((p) => ({ lengthMm: Math.ceil(p.lengthMm), label: p.label }))
      .filter((p) => p.lengthMm > 0)
      .sort((a, b) => b.lengthMm - a.lengthMm);

    const maxPiece = expanded[0]?.lengthMm ?? 0;
    const stockLengthMm =
      STOCK_LENGTHS_MM.find((l) => l >= maxPiece) ?? Math.ceil(maxPiece / 1000) * 1000;

    const bins: number[] = [];
    for (const piece of expanded) {
      let placed = false;
      for (let i = 0; i < bins.length; i++) {
        if (bins[i] + piece.lengthMm <= stockLengthMm) {
          bins[i] += piece.lengthMm;
          placed = true;
          break;
        }
      }
      if (!placed) bins.push(piece.lengthMm);
    }

    const boardsNeeded = Math.ceil(bins.length * wasteFactor);
    const used = bins.reduce((s, b) => s + b, 0);
    const wasteMm = boardsNeeded * stockLengthMm - used;

    const agg = new Map<string, { lengthMm: number; label: string; qty: number }>();
    for (const p of expanded) {
      const k = `${p.label}|${p.lengthMm}`;
      const cur = agg.get(k) ?? { ...p, qty: 0 };
      cur.qty += 1;
      agg.set(k, cur);
    }

    result.push({
      sectionMm: section,
      stockLengthMm,
      pieces: [...agg.values()],
      boardsNeeded,
      wasteMm,
      utilization: used / (boardsNeeded * stockLengthMm || 1),
    });
  }
  return result;
}

function buildBom(
  project: Project,
  lumber: LumberPiece[],
  sheets: SheetItem[],
  cutting: CuttingStock[],
): BomLine[] {
  const lines: BomLine[] = [];
  let i = 0;
  const push = (line: Omit<BomLine, 'id' | 'total'> & { total?: number }) => {
    const total = line.total ?? line.qty * line.unitPrice;
    lines.push({ id: `bom_${i++}`, ...line, total });
  };

  for (const c of cutting) {
    const vol =
      (c.sectionMm.width / 1000) *
      (c.sectionMm.depth / 1000) *
      (c.stockLengthMm / 1000) *
      c.boardsNeeded;
    push({
      group: 'Пиломатериал',
      name: `Доска ${c.sectionMm.width}×${c.sectionMm.depth} мм, L=${c.stockLengthMm} мм`,
      unit: 'м³',
      qty: Number(vol.toFixed(3)),
      unitPrice: project.settings.lumberPriceRubPerM3,
      note: `${c.boardsNeeded} шт, утилизация ${(c.utilization * 100).toFixed(0)}%`,
    });
  }

  for (const s of sheets) {
    const price =
      s.category === 'cladding'
        ? EXTERIOR_CLADDING[project.settings.exteriorCladding].priceRubPerM2 ??
          project.settings.sheetPriceRubPerM2
        : s.category === 'interior'
          ? INTERIOR_FINISH[project.settings.interiorFinish].priceRubPerM2 ??
            project.settings.sheetPriceRubPerM2
          : s.category === 'subfloor'
            ? FLOOR_FINISH[project.settings.floorFinish].priceRubPerM2 ??
              project.settings.sheetPriceRubPerM2
            : project.settings.sheetPriceRubPerM2;
    push({
      group:
        s.category === 'cladding'
          ? 'Наружная обшивка'
          : s.category === 'interior'
            ? 'Внутренняя обшивка'
            : s.category === 'subfloor'
              ? 'Черный пол'
              : s.category === 'roof_sheathing'
                ? 'Кровля'
                : 'Обшивка каркаса',
      name: s.label,
      unit: 'м²',
      qty: Number(s.areaM2.toFixed(2)),
      unitPrice: price ?? 0,
    });
  }

  const area0 = polygonAreaFromExterior(
    project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior'),
  );
  const floors = project.settings.floors;
  const wallArea = project.walls
    .filter((w) => w.kind === 'exterior')
    .reduce((s, w) => s + (wallLength(w) * (w.height || project.settings.floorHeightMm)) / 1e6, 0);
  const ins = project.settings.insulation;
  const wallInsM3 = wallArea * (ins.wallThicknessMm / 1000) * project.settings.wasteFactor;
  const floorInsM3 = area0 * (ins.floorThicknessMm / 1000) * project.settings.wasteFactor;
  const ceilInsM3 = area0 * floors * (ins.ceilingThicknessMm / 1000) * project.settings.wasteFactor;

  push({
    group: 'Утеплитель',
    name: `Утеплитель стен δ=${ins.wallThicknessMm} мм`,
    unit: 'м³',
    qty: Number(wallInsM3.toFixed(2)),
    unitPrice: project.settings.insulationPriceRubPerM3,
  });
  push({
    group: 'Утеплитель',
    name: `Утеплитель пола δ=${ins.floorThicknessMm} мм`,
    unit: 'м³',
    qty: Number(floorInsM3.toFixed(2)),
    unitPrice: project.settings.insulationPriceRubPerM3,
  });
  push({
    group: 'Утеплитель',
    name: `Утеплитель перекрытия/потолка δ=${ins.ceilingThicknessMm} мм`,
    unit: 'м³',
    qty: Number(ceilInsM3.toFixed(2)),
    unitPrice: project.settings.insulationPriceRubPerM3,
  });

  const lumberVol = lumber.reduce((s, p) => s + volumeM3(p.sectionMm, p.lengthMm, p.qty), 0);
  push({
    group: 'Крепёж',
    name: 'Гвозди/саморезы (укрупнённо)',
    unit: 'кг',
    qty: Number((lumberVol * 25).toFixed(1)),
    unitPrice: project.settings.fastenerPriceRubPerKg,
  });

  const sillLen = lumber
    .filter((p) => p.category === 'sill')
    .reduce((s, p) => s + p.lengthMm * p.qty, 0);
  push({
    group: 'Крепёж',
    name: 'Анкерные болты Ø12 мм (обвязка фундамента)',
    unit: 'шт',
    qty: Math.max(4, Math.ceil(sillLen / 2400) + 4),
    unitPrice: 85,
    note: 'Шаг не более 2,4 м по СП 31-105',
  });

  return lines;
}

export function computeHeatLoss(project: Project): HeatLossResult {
  const { settings } = project;
  const deltaT = settings.climate.designIndoorC - settings.climate.designOutdoorC;
  const area = polygonAreaFromExterior(
    project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior'),
  );
  const height = (settings.floorHeightMm / 1000) * settings.floors;
  const volume = area * height;
  const surfaces: HeatLossSurface[] = [];

  const rsi = 0.13;
  const rse = 0.04;
  const uFrom = (layers: { dMm: number; lambda: number }[]) => {
    const r = rsi + rse + layers.reduce((s, l) => s + l.dMm / 1000 / l.lambda, 0);
    return 1 / r;
  };

  const exteriorWalls = project.walls.filter((w) => w.kind === 'exterior');
  let wallArea = exteriorWalls.reduce(
    (s, w) => s + (wallLength(w) * (w.height || settings.floorHeightMm)) / 1e6,
    0,
  );
  const windowArea = project.openings
    .filter((o) => o.type === 'window')
    .reduce((s, o) => s + (o.width * o.height) / 1e6, 0);
  const doorArea = project.openings
    .filter((o) => o.type === 'door')
    .reduce((s, o) => s + (o.width * o.height) / 1e6, 0);
  wallArea = Math.max(0, wallArea - windowArea - doorArea);

  const ext = EXTERIOR_CLADDING[settings.exteriorCladding];
  const inn = INTERIOR_FINISH[settings.interiorFinish];
  const uWall = uFrom([
    { dMm: inn.thicknessMm ?? 12.5, lambda: inn.lambda },
    { dMm: settings.insulation.wallThicknessMm, lambda: settings.insulation.wallLambda },
    { dMm: 12, lambda: 0.13 },
    { dMm: ext.thicknessMm ?? 10, lambda: Math.min(ext.lambda, 1) },
  ]);

  surfaces.push({
    id: 'walls',
    name: 'Наружные стены',
    areaM2: wallArea,
    uValue: uWall,
    deltaT,
    lossW: wallArea * uWall * deltaT,
  });
  surfaces.push({
    id: 'windows',
    name: 'Окна',
    areaM2: windowArea,
    uValue: 1.4,
    deltaT,
    lossW: windowArea * 1.4 * deltaT,
  });
  surfaces.push({
    id: 'doors',
    name: 'Двери наружные',
    areaM2: doorArea,
    uValue: 2.0,
    deltaT,
    lossW: doorArea * 2.0 * deltaT,
  });

  const floorFinish = FLOOR_FINISH[settings.floorFinish];
  const uFloor = uFrom([
    { dMm: floorFinish.thicknessMm ?? 18, lambda: floorFinish.lambda },
    { dMm: settings.insulation.floorThicknessMm, lambda: settings.insulation.floorLambda },
  ]);
  surfaces.push({
    id: 'floor',
    name: 'Пол по грунту/над техподпольем',
    areaM2: area,
    uValue: uFloor,
    deltaT: deltaT * 0.6,
    lossW: area * uFloor * deltaT * 0.6,
  });

  const uCeil = uFrom([
    { dMm: settings.insulation.ceilingThicknessMm, lambda: settings.insulation.ceilingLambda },
    { dMm: 12, lambda: 0.13 },
  ]);
  surfaces.push({
    id: 'ceiling',
    name: 'Перекрытие/потолок под кровлей',
    areaM2: area,
    uValue: uCeil,
    deltaT,
    lossW: area * uCeil * deltaT,
  });

  const transmissionW = surfaces.reduce((s, x) => s + x.lossW, 0);
  const ventilationW = 0.34 * settings.climate.airExchangeRate * volume * deltaT;
  const totalW = transmissionW + ventilationW;

  return {
    surfaces,
    transmissionW,
    ventilationW,
    totalW,
    specificWm2: area > 0 ? totalW / area : 0,
    heatedAreaM2: area * settings.floors,
    volumeM3: volume,
  };
}

export function generateFrameModel(project: Project): FrameModel {
  const lumber: LumberPiece[] = [];
  const members: FrameMember[] = [];
  const sheets: SheetItem[] = [];

  const floors: FloorLevel[] = project.settings.floors === 2 ? [0, 1] : [0];

  for (const fl of floors) {
    buildFloorMembers(project, fl, members, lumber);
  }

  for (const wall of project.walls) {
    if (project.settings.floors === 1 && wall.floor === 1) continue;
    buildWallMembers(wall, project.openings, project.settings, members, lumber);
  }

  buildRoofMembers(project, members, lumber);
  generateSheathing(project, sheets);

  const cutting = nestCutting(lumber, project.settings.wasteFactor);
  const bom = buildBom(project, lumber, sheets, cutting);
  const heatLoss = computeHeatLoss(project);
  const projections = renderFrameProjections(project, members);

  const footprint = polygonAreaFromExterior(
    project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior'),
  );
  const perimeter =
    project.walls
      .filter((w) => w.floor === 0 && w.kind === 'exterior')
      .reduce((s, w) => s + wallLength(w), 0) / 1000;
  const wallLengthM = project.walls.reduce((s, w) => s + wallLength(w), 0) / 1000;
  const studCount = lumber
    .filter((p) => ['stud', 'king_stud', 'jack_stud'].includes(p.category))
    .reduce((s, p) => s + p.qty, 0);
  const lumberVolumeM3 = lumber.reduce(
    (s, p) => s + volumeM3(p.sectionMm, p.lengthMm, p.qty),
    0,
  );

  return {
    lumber,
    members,
    sheets,
    cutting,
    bom,
    heatLoss,
    projections,
    summary: {
      footprintM2: footprint,
      heatedAreaM2: footprint * project.settings.floors,
      perimeterM: perimeter,
      wallLengthM,
      studCount,
      lumberVolumeM3,
    },
  };
}
