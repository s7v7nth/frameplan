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
  FrameModel,
  HeatLossResult,
  HeatLossSurface,
  LumberPiece,
  Opening,
  Project,
  SheetItem,
  Wall,
} from '../domain/types';

function openingsOnWall(openings: Opening[], wallId: string): Opening[] {
  return openings
    .filter((o) => o.wallId === wallId)
    .sort((a, b) => a.offset - b.offset);
}

/** Generate stud positions along a wall, skipping opening spans (SP 31-105 §7.2). */
function studOffsets(wallLen: number, spacing: number, openings: Opening[]): number[] {
  const positions = new Set<number>([0, wallLen]);
  for (let x = spacing; x < wallLen - 10; x += spacing) positions.add(Math.round(x));

  for (const o of openings) {
    const start = o.offset;
    const end = o.offset + o.width;
    for (const p of [...positions]) {
      if (p > start + 20 && p < end - 20) positions.delete(p);
    }
    // king studs at opening edges
    positions.add(Math.max(0, Math.round(start)));
    positions.add(Math.min(wallLen, Math.round(end)));
  }
  return [...positions].sort((a, b) => a - b);
}

function addLumber(
  list: LumberPiece[],
  partial: Omit<LumberPiece, 'id' | 'qty'> & { qty?: number },
) {
  list.push({
    id: uid('lum'),
    qty: partial.qty ?? 1,
    ...partial,
  });
}

function generateWallFraming(
  wall: Wall,
  openings: Opening[],
  settings: Project['settings'],
  lumber: LumberPiece[],
) {
  const len = Math.round(wallLength(wall));
  if (len < 50) return;

  const wallOpenings = openingsOnWall(openings, wall.id);
  const height = wall.height || settings.floorHeightMm;
  const section = settings.studSectionMm;
  const spacing = settings.studSpacingMm;

  // Bottom plate — one board ≥38 mm (SP 7.2.6–7.2.7)
  addLumber(lumber, {
    category: 'bottom_plate',
    label: `Нижняя обвязка ${wall.kind === 'exterior' ? 'нар.' : 'внутр.'}`,
    sectionMm: section,
    lengthMm: len,
    floor: wall.floor,
    wallId: wall.id,
  });

  // Top plate — double for load-bearing (exterior + treat all as bearing for MVP)
  const topPlies = wall.kind === 'exterior' ? 2 : 2;
  addLumber(lumber, {
    category: 'top_plate',
    label: `Верхняя обвязка (${topPlies} доски)`,
    sectionMm: section,
    lengthMm: len,
    floor: wall.floor,
    wallId: wall.id,
    qty: topPlies,
  });

  const offsets = studOffsets(len, spacing, wallOpenings);
  for (const off of offsets) {
    const inOpening = wallOpenings.some(
      (o) => off > o.offset + 5 && off < o.offset + o.width - 5,
    );
    if (inOpening) continue;
    addLumber(lumber, {
      category: 'stud',
      label: 'Стойка',
      sectionMm: section,
      lengthMm: height - section.depth * (1 + topPlies), // approx net stud length
      floor: wall.floor,
      wallId: wall.id,
    });
  }

  for (const o of wallOpenings) {
    // King studs (already partly at edges; add dedicated)
    addLumber(lumber, {
      category: 'king_stud',
      label: o.type === 'window' ? 'Королевская стойка окна' : 'Королевская стойка двери',
      sectionMm: section,
      lengthMm: height - section.depth * (1 + topPlies),
      floor: wall.floor,
      wallId: wall.id,
      qty: 2,
    });

    // Jack studs (trimmers)
    const jackLen =
      o.type === 'door'
        ? o.height
        : o.sillHeight + o.height;
    addLumber(lumber, {
      category: 'jack_stud',
      label: 'Опорная стойка проёма',
      sectionMm: section,
      lengthMm: Math.max(200, jackLen),
      floor: wall.floor,
      wallId: wall.id,
      qty: 2,
    });

    // Header — double member for openings (simplified SP lintel)
    const headerDepth = Math.max(section.depth, o.width > 1200 ? 200 : section.depth);
    addLumber(lumber, {
      category: 'header',
      label: `Перемычка ${o.width} мм`,
      sectionMm: { width: section.width, depth: headerDepth },
      lengthMm: o.width + section.width * 2,
      floor: wall.floor,
      wallId: wall.id,
      qty: 2,
    });

    if (o.type === 'window' && o.sillHeight > 100) {
      // Cripples below sill
      const n = Math.max(1, Math.floor(o.width / spacing));
      addLumber(lumber, {
        category: 'cripple',
        label: 'Коротыш под подоконником',
        sectionMm: section,
        lengthMm: o.sillHeight,
        floor: wall.floor,
        wallId: wall.id,
        qty: n + 1,
      });
      // sill plate of opening
      addLumber(lumber, {
        category: 'bottom_plate',
        label: 'Подоконная доска проёма',
        sectionMm: section,
        lengthMm: o.width,
        floor: wall.floor,
        wallId: wall.id,
      });
    }

    // Cripples above header to top plate
    const above = height - (o.sillHeight + o.height) - section.depth * topPlies - headerDepth;
    if (above > 100) {
      const n = Math.max(1, Math.floor(o.width / spacing));
      addLumber(lumber, {
        category: 'cripple',
        label: 'Коротыш над перемычкой',
        sectionMm: section,
        lengthMm: above,
        floor: wall.floor,
        wallId: wall.id,
        qty: n + 1,
      });
    }
  }
}

function generateFloorSystem(
  project: Project,
  floor: FloorLevel,
  lumber: LumberPiece[],
  sheets: SheetItem[],
) {
  const walls = project.walls.filter((w) => w.floor === floor || (floor === 0 && w.floor === 0));
  const exterior = walls.filter((w) => w.kind === 'exterior' && w.floor === (floor === 1 ? 1 : 0));
  // For floor 0 joists: use floor 0 exterior; for floor 1 ceiling/joists use floor 0 footprint or floor 1 walls
  const refWalls =
    floor === 0
      ? project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior')
      : project.walls.filter((w) => w.floor === 1 && w.kind === 'exterior').length
        ? project.walls.filter((w) => w.floor === 1 && w.kind === 'exterior')
        : project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior');

  if (refWalls.length === 0) return;

  const { bounds } = (() => {
    const pts = refWalls.flatMap((w) => [w.a, w.b]);
    return {
      bounds: {
        minX: Math.min(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)),
        maxX: Math.max(...pts.map((p) => p.x)),
        maxY: Math.max(...pts.map((p) => p.y)),
      },
    };
  })();

  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const area = polygonAreaFromExterior(refWalls.length ? refWalls : exterior);
  const joist = project.settings.joistSectionMm;
  const spacing = project.settings.joistSpacingMm;

  // Assume joists span the shorter direction
  const span = Math.min(spanX, spanY);
  const run = Math.max(spanX, spanY);
  const count = Math.floor(run / spacing) + 1;

  if (floor === 0) {
    // Sill plate on foundation SP 6.2.8 — min ~38×89, use stud width × joist depth board
    const perimeter = refWalls.reduce((s, w) => s + wallLength(w), 0);
    addLumber(lumber, {
      category: 'sill',
      label: 'Обвязка фундамента (лежень)',
      sectionMm: { width: 50, depth: 150 },
      lengthMm: Math.round(perimeter),
      floor: 'foundation',
      qty: 1,
    });
  }

  addLumber(lumber, {
    category: 'joist',
    label: floor === 0 ? 'Балка черного пола' : 'Балка перекрытия',
    sectionMm: joist,
    lengthMm: Math.round(span),
    floor,
    qty: count,
  });

  // Rim joists
  addLumber(lumber, {
    category: 'rim_joist',
    label: 'Обвязочная балка перекрытия',
    sectionMm: joist,
    lengthMm: Math.round(run),
    floor,
    qty: 2,
  });
  addLumber(lumber, {
    category: 'rim_joist',
    label: 'Торцевая обвязка перекрытия',
    sectionMm: joist,
    lengthMm: Math.round(span),
    floor,
    qty: 2,
  });

  const finish = FLOOR_FINISH[project.settings.floorFinish];
  const sheetArea = area * project.settings.wasteFactor;
  const sheetW = 1250;
  const sheetH = 2500;
  const sheetM2 = (sheetW * sheetH) / 1e6;
  addSheet(sheets, {
    category: 'subfloor',
    label: finish.name,
    thicknessMm: finish.thicknessMm ?? 18,
    widthMm: sheetW,
    heightMm: sheetH,
    areaM2: sheetArea,
    qty: Math.ceil(sheetArea / sheetM2),
  });
}

function addSheet(sheets: SheetItem[], partial: Omit<SheetItem, 'id'>) {
  sheets.push({ id: uid('sheet'), ...partial });
}

function generateRoof(
  project: Project,
  lumber: LumberPiece[],
  sheets: SheetItem[],
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

  const run = Math.min(width, depth) / 2 + overhang;
  const rafterLen = Math.round(run / Math.cos(pitch));
  const ridgeLen = Math.max(width, depth) + overhang * 2;
  const rafterCount = Math.floor((Math.max(width, depth) + overhang * 2) / spacing) + 1;

  if (project.settings.roofType === 'flat') {
    addLumber(lumber, {
      category: 'joist',
      label: 'Балка плоской кровли',
      sectionMm: section,
      lengthMm: Math.round(Math.min(width, depth) + overhang * 2),
      floor: 'roof',
      qty: rafterCount,
    });
  } else if (project.settings.roofType === 'shed') {
    const shedLen = Math.round((Math.min(width, depth) + overhang * 2) / Math.cos(pitch));
    addLumber(lumber, {
      category: 'rafter',
      label: 'Стропило односкатной кровли',
      sectionMm: section,
      lengthMm: shedLen,
      floor: 'roof',
      qty: rafterCount,
    });
  } else if (project.settings.roofType === 'hip') {
    addLumber(lumber, {
      category: 'rafter',
      label: 'Рядовое стропило',
      sectionMm: section,
      lengthMm: rafterLen,
      floor: 'roof',
      qty: Math.max(4, rafterCount),
    });
    addLumber(lumber, {
      category: 'rafter',
      label: 'Накосное стропило (вальма)',
      sectionMm: { width: section.width, depth: section.depth + 50 },
      lengthMm: Math.round(rafterLen * 1.15),
      floor: 'roof',
      qty: 4,
    });
    addLumber(lumber, {
      category: 'ridge',
      label: 'Конёк',
      sectionMm: section,
      lengthMm: Math.round(Math.abs(width - depth)),
      floor: 'roof',
      qty: 1,
    });
  } else {
    // gable
    addLumber(lumber, {
      category: 'rafter',
      label: 'Стропило двускатной кровли',
      sectionMm: section,
      lengthMm: rafterLen,
      floor: 'roof',
      qty: rafterCount * 2,
    });
    addLumber(lumber, {
      category: 'ridge',
      label: 'Коньковый брус',
      sectionMm: section,
      lengthMm: Math.round(ridgeLen),
      floor: 'roof',
      qty: 1,
    });
  }

  const roofArea =
    project.settings.roofType === 'flat'
      ? ((width + overhang * 2) * (depth + overhang * 2)) / 1e6
      : project.settings.roofType === 'shed'
        ? ((width + overhang * 2) * (depth + overhang * 2)) / Math.cos(pitch) / 1e6
        : project.settings.roofType === 'hip'
          ? (2 * (width * run + depth * run)) / Math.cos(pitch) / 1e6
          : (2 * (Math.max(width, depth) + overhang * 2) * rafterLen) / 1e6;

  const sheetM2 = (1250 * 2500) / 1e6;
  const areaWithWaste = roofArea * project.settings.wasteFactor;
  addSheet(sheets, {
    category: 'roof_sheathing',
    label: 'Обрешётка/ОСП кровли 12 мм',
    thicknessMm: 12,
    widthMm: 1250,
    heightMm: 2500,
    areaM2: areaWithWaste,
    qty: Math.ceil(areaWithWaste / sheetM2),
  });
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

    // subtract openings roughly
    const openingArea = project.openings
      .filter((o) => walls.some((w) => w.id === o.wallId))
      .reduce((s, o) => s + (o.width * o.height) / 1e6, 0);

    const exteriorArea = Math.max(0, (exteriorLen * height) / 1e6 - openingArea) * project.settings.wasteFactor;
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

    // choose stock length that fits longest piece
    const maxPiece = expanded[0]?.lengthMm ?? 0;
    const stockLengthMm =
      STOCK_LENGTHS_MM.find((l) => l >= maxPiece) ??
      Math.ceil(maxPiece / 1000) * 1000;

    const bins: number[] = [];
    const binContents: { lengthMm: number; label: string }[][] = [];
    for (const piece of expanded) {
      let placed = false;
      for (let i = 0; i < bins.length; i++) {
        if (bins[i] + piece.lengthMm <= stockLengthMm) {
          bins[i] += piece.lengthMm;
          binContents[i].push(piece);
          placed = true;
          break;
        }
      }
      if (!placed) {
        bins.push(piece.lengthMm);
        binContents.push([piece]);
      }
    }

    const boardsNeeded = Math.ceil(bins.length * wasteFactor);
    const used = bins.reduce((s, b) => s + b, 0);
    const wasteMm = boardsNeeded * stockLengthMm - used;

    // aggregate piece counts
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
        ? EXTERIOR_CLADDING[project.settings.exteriorCladding].priceRubPerM2 ?? project.settings.sheetPriceRubPerM2
        : s.category === 'interior'
          ? INTERIOR_FINISH[project.settings.interiorFinish].priceRubPerM2 ?? project.settings.sheetPriceRubPerM2
          : s.category === 'subfloor'
            ? FLOOR_FINISH[project.settings.floorFinish].priceRubPerM2 ?? project.settings.sheetPriceRubPerM2
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

  // Insulation volumes
  const area0 = polygonAreaFromExterior(project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior'));
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

  // Fasteners rough estimate
  const lumberVol = lumber.reduce(
    (s, p) => s + volumeM3(p.sectionMm, p.lengthMm, p.qty),
    0,
  );
  const fastenerKg = lumberVol * 25; // empirical
  push({
    group: 'Крепёж',
    name: 'Гвозди/саморезы (укрупнённо)',
    unit: 'кг',
    qty: Number(fastenerKg.toFixed(1)),
    unitPrice: project.settings.fastenerPriceRubPerKg,
  });

  // Anchor bolts for sill ≤2.4 m SP 6.2.8
  const sillLen = lumber
    .filter((p) => p.category === 'sill')
    .reduce((s, p) => s + p.lengthMm * p.qty, 0);
  const anchors = Math.max(4, Math.ceil(sillLen / 2400) + 4);
  push({
    group: 'Крепёж',
    name: 'Анкерные болты Ø12 мм (обвязка фундамента)',
    unit: 'шт',
    qty: anchors,
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

  const uWin = 1.4; // typical double glazing
  surfaces.push({
    id: 'windows',
    name: 'Окна',
    areaM2: windowArea,
    uValue: uWin,
    deltaT,
    lossW: windowArea * uWin * deltaT,
  });

  const uDoor = 2.0;
  surfaces.push({
    id: 'doors',
    name: 'Двери наружные',
    areaM2: doorArea,
    uValue: uDoor,
    deltaT,
    lossW: doorArea * uDoor * deltaT,
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
    deltaT: deltaT * 0.6, // reduced for ground
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
  // Ventilation: Q = 0.34 * n * V * ΔT (approx, W)
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

function buildProjections(project: Project): FrameModel['projections'] {
  const walls = project.walls.filter((w) => w.floor === project.activeFloor);
  const pts = walls.flatMap((w) => [w.a, w.b]);
  const pad = 800;
  const minX = (pts.length ? Math.min(...pts.map((p) => p.x)) : 0) - pad;
  const minY = (pts.length ? Math.min(...pts.map((p) => p.y)) : 0) - pad;
  const maxX = (pts.length ? Math.max(...pts.map((p) => p.x)) : 6000) + pad;
  const maxY = (pts.length ? Math.max(...pts.map((p) => p.y)) : 4000) + pad;
  const w = maxX - minX;
  const h = maxY - minY;
  const scale = 400 / Math.max(w, h, 1);

  const to = (x: number, y: number) => [(x - minX) * scale, (y - minY) * scale];

  const wallLines = walls
    .map((wall) => {
      const [x1, y1] = to(wall.a.x, wall.a.y);
      const [x2, y2] = to(wall.b.x, wall.b.y);
      const stroke = wall.kind === 'exterior' ? '#1f3a2e' : '#6b7280';
      const sw = wall.kind === 'exterior' ? 4 : 2;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"/>`;
    })
    .join('');

  const openings = project.openings
    .filter((o) => walls.some((w) => w.id === o.wallId))
    .map((o) => {
      const wall = walls.find((w) => w.id === o.wallId)!;
      const len = wallLength(wall);
      const t0 = o.offset / len;
      const t1 = (o.offset + o.width) / len;
      const x1 = wall.a.x + (wall.b.x - wall.a.x) * t0;
      const y1 = wall.a.y + (wall.b.y - wall.a.y) * t0;
      const x2 = wall.a.x + (wall.b.x - wall.a.x) * t1;
      const y2 = wall.a.y + (wall.b.y - wall.a.y) * t1;
      const [a, b] = [to(x1, y1), to(x2, y2)];
      const color = o.type === 'window' ? '#2563eb' : '#b45309';
      return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="6"/>`;
    })
    .join('');

  const planSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * scale} ${h * scale}" width="100%" height="100%">${wallLines}${openings}</svg>`;

  const elevW = 520;
  const elevH = 280;
  const floorH = 120;
  const floors = settingsFloors(project);
  const elevWalls = Array.from({ length: floors }, (_, i) => {
    const y = elevH - 40 - (i + 1) * floorH;
    return `<rect x="40" y="${y}" width="440" height="${floorH}" fill="none" stroke="#1f3a2e" stroke-width="3"/>`;
  }).join('');
  const roofY = elevH - 40 - floors * floorH;
  const roof =
    project.settings.roofType === 'flat'
      ? `<line x1="30" y1="${roofY}" x2="490" y2="${roofY}" stroke="#7c2d12" stroke-width="4"/>`
      : project.settings.roofType === 'shed'
        ? `<polyline points="30,${roofY + 30} 490,${roofY - 20}" fill="none" stroke="#7c2d12" stroke-width="4"/>`
        : `<polyline points="30,${roofY} 260,${roofY - 50} 490,${roofY}" fill="none" stroke="#7c2d12" stroke-width="4"/>`;

  const elevationFrontSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${elevW} ${elevH}" width="100%" height="100%"><line x1="20" y1="${elevH - 40}" x2="500" y2="${elevH - 40}" stroke="#94a3b8"/>${elevWalls}${roof}<text x="40" y="24" fill="#334155" font-size="14">Фасад (схема)</text></svg>`;
  const elevationSideSvg = elevationFrontSvg.replace('Фасад (схема)', 'Торец (схема)');

  const roofSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" width="100%" height="100%">
    <text x="16" y="24" fill="#334155" font-size="14">Кровля: ${project.settings.roofType}, ${project.settings.roofPitchDeg}°</text>
    <polygon points="40,180 200,40 360,180" fill="#f8fafc" stroke="#7c2d12" stroke-width="3"/>
    <line x1="200" y1="40" x2="200" y2="180" stroke="#b45309" stroke-dasharray="4 3"/>
  </svg>`;

  return { planSvg, elevationFrontSvg, elevationSideSvg, roofSvg };
}

function settingsFloors(project: Project): number {
  return project.settings.floors;
}

export function generateFrameModel(project: Project): FrameModel {
  const lumber: LumberPiece[] = [];
  const sheets: SheetItem[] = [];

  const floors: FloorLevel[] = project.settings.floors === 2 ? [0, 1] : [0];

  // Foundation + floors
  for (const fl of floors) {
    generateFloorSystem(project, fl, lumber, sheets);
  }
  // Ceiling joists under roof for single-story already in floor 0 as attic? Add dedicated ceiling for top
  // Walls
  for (const wall of project.walls) {
    if (project.settings.floors === 1 && wall.floor === 1) continue;
    generateWallFraming(wall, project.openings, project.settings, lumber);
  }

  generateRoof(project, lumber, sheets);
  generateSheathing(project, sheets);

  const cutting = nestCutting(lumber, project.settings.wasteFactor);
  const bom = buildBom(project, lumber, sheets, cutting);
  const heatLoss = computeHeatLoss(project);
  const projections = buildProjections(project);

  const footprint = polygonAreaFromExterior(
    project.walls.filter((w) => w.floor === 0 && w.kind === 'exterior'),
  );
  const perimeter =
    project.walls
      .filter((w) => w.floor === 0 && w.kind === 'exterior')
      .reduce((s, w) => s + wallLength(w), 0) / 1000;
  const wallLengthM =
    project.walls.reduce((s, w) => s + wallLength(w), 0) / 1000;
  const studCount = lumber
    .filter((p) => p.category === 'stud' || p.category === 'king_stud')
    .reduce((s, p) => s + p.qty, 0);
  const lumberVolumeM3 = lumber.reduce(
    (s, p) => s + volumeM3(p.sectionMm, p.lengthMm, p.qty),
    0,
  );

  return {
    lumber,
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
