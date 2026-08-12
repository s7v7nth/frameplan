import { wallLength } from '../domain/geometry';
import type {
  FloorLevel,
  MemberForceSummary,
  Opening,
  Project,
  StructuralCheck,
  StructuralReport,
  Wall,
  CheckSeverity,
} from '../domain/types';
import {
  headerHeightMm,
  maxHeaderSpanM,
  maxJoistSpanM,
  maxRafterSpanM,
  suggestJoistDepthMm,
  suggestJoistSpacingMm,
} from './spanTables';
import { analyzeFloorBays, type FloorBayLayout } from './floorLayout';

export type { StructuralCheck, StructuralReport, MemberForceSummary, CheckSeverity };

/** Softwood E (grade 2), MPa — SP / typical pine */
const E_MPA = 10_000;
/** Floor live 2.4 kPa (SP 4.2.1) + dead finish/insulation ≈ 0.8 kPa */
const FLOOR_LIVE_KPA = 2.4;
const FLOOR_DEAD_KPA = 0.8;
/** Roof snow default when no region calc — conservative mid band */
const ROOF_SNOW_KPA = 1.8;
const ROOF_DEAD_KPA = 0.6;

function I_mm4(widthMm: number, depthMm: number): number {
  return (widthMm * depthMm ** 3) / 12;
}

/** Simply-supported uniform load: δ = 5 w L^4 / (384 E I) */
export function deflectionMm(
  lineLoadNPerMm: number,
  spanMm: number,
  widthMm: number,
  depthMm: number,
): number {
  const E = E_MPA; // N/mm²
  const I = I_mm4(widthMm, depthMm);
  if (I <= 0 || spanMm <= 0) return 0;
  return (5 * lineLoadNPerMm * spanMm ** 4) / (384 * E * I);
}

function lineLoadFromAreaKPa(areaKPa: number, spacingMm: number): number {
  return areaKPa * (spacingMm / 1000);
}

function memberSummary(
  id: string,
  label: string,
  spanM: number,
  section: { width: number; depth: number },
  spacingMm: number,
  areaLoadKPa: number,
  maxSpanTableM: number,
): MemberForceSummary {
  const spanMm = spanM * 1000;
  const wKNpm = lineLoadFromAreaKPa(areaLoadKPa, spacingMm);
  const wNperMm = wKNpm / 1000;
  const momentKNm = (wKNpm * spanM ** 2) / 8;
  const shearKN = (wKNpm * spanM) / 2;
  const defl = deflectionMm(wNperMm, spanMm, section.width, section.depth);
  const deflLimit = spanMm / 360;
  return {
    id,
    label,
    spanM,
    sectionMm: section,
    spacingMm,
    lineLoadKNpm: Number(wKNpm.toFixed(3)),
    momentKNm: Number(momentKNm.toFixed(3)),
    shearKN: Number(shearKN.toFixed(3)),
    deflectionMm: Number(defl.toFixed(2)),
    deflectionLimitMm: Number(deflLimit.toFixed(2)),
    okDeflection: defl <= deflLimit + 0.05,
    okSpanTable: spanM <= maxSpanTableM + 0.02,
    maxSpanTableM,
  };
}

function severityRank(s: CheckSeverity): number {
  return s === 'fail' ? 2 : s === 'warn' ? 1 : 0;
}

export function computeStructuralReport(project: Project): StructuralReport & {
  floorLayouts: FloorBayLayout[];
} {
  const checks: StructuralCheck[] = [];
  const members: MemberForceSummary[] = [];
  const { settings } = project;
  const floors: FloorLevel[] = settings.floors === 2 ? [0, 1] : [0];
  const floorLayouts: FloorBayLayout[] = floors.map((fl) => analyzeFloorBays(project, fl));

  const assumptions = [
    `Временная нагрузка на перекрытие ${FLOOR_LIVE_KPA} кПа (СП 31-105 п. 4.2.1)`,
    `Постоянная нагрузка перекрытия ≈ ${FLOOR_DEAD_KPA} кПа (обшивка + утеплитель)`,
    `Предельный прогиб балок L/360 (СП 31-105 п. 6.2.4)`,
    `E древесины ≈ ${E_MPA} МПа (хвоя 2 сорт, укрупнённо)`,
    `Пролёты по прил. Б СП 31-105 (таблицы Б-1, Б.13, стропила — консервативная оценка)`,
    `Снеговая нагрузка на кровлю ≈ ${ROOF_SNOW_KPA} кПа (без уточнения по региону СП 20)`,
  ];

  for (const layout of floorLayouts) {
    const maxBay = layout.maxBayM;
    const section = settings.joistSectionMm;
    const spacing = settings.joistSpacingMm;
    const tableMax = maxJoistSpanM(section.depth, spacing);
    const areaLoad = FLOOR_LIVE_KPA + FLOOR_DEAD_KPA;
    const m = memberSummary(
      `joist_f${layout.floor}`,
      `Балки перекрытия · этаж ${layout.floor + 1}`,
      maxBay,
      section,
      spacing,
      areaLoad,
      tableMax,
    );
    members.push(m);

    const deeper = suggestJoistDepthMm(maxBay, spacing);
    const tighter = suggestJoistSpacingMm(maxBay, section.depth);

    if (!m.okSpanTable) {
      const tips: string[] = [];
      if (deeper && deeper > section.depth) tips.push(`сечение ≥ 50×${deeper}`);
      if (tighter && tighter < spacing) tips.push(`шаг ${tighter} мм`);
      tips.push('внутренняя несущая стена поперёк пролёта балок');
      checks.push({
        id: `floor_span_${layout.floor}`,
        category: 'floor',
        severity: 'fail',
        title: `Пролёт балок этажа ${layout.floor + 1} превышает таблицу СП`,
        detail: `Максимальный пролёт между опорами ${maxBay.toFixed(2)} м при ${section.width}×${section.depth} @ ${spacing} мм. Опоры: ${layout.supportCount}, ориентация ${layout.spanAxis === 'x' ? 'по X' : 'по Y'}.`,
        actual: `${maxBay.toFixed(2)} м`,
        limit: `≤ ${tableMax.toFixed(2)} м (Б-1)`,
        suggestion: `Уменьшите пролёт или увеличьте сечение: ${tips.join('; ')}.`,
      });
    } else {
      checks.push({
        id: `floor_span_${layout.floor}`,
        category: 'floor',
        severity: 'ok',
        title: `Пролёт балок этажа ${layout.floor + 1} в пределах таблицы СП`,
        detail: `Пролёт ${maxBay.toFixed(2)} м ≤ ${tableMax.toFixed(2)} м для ${section.width}×${section.depth} @ ${spacing} мм.`,
        actual: `${maxBay.toFixed(2)} м`,
        limit: `≤ ${tableMax.toFixed(2)} м`,
      });
    }

    if (!m.okDeflection) {
      checks.push({
        id: `floor_defl_${layout.floor}`,
        category: 'floor',
        severity: 'fail',
        title: `Прогиб балок этажа ${layout.floor + 1} > L/360`,
        detail: `δ = ${m.deflectionMm} мм при q = ${areaLoad} кПа (полоса ${spacing} мм). M = ${m.momentKNm} кН·м, Q = ${m.shearKN} кН.`,
        actual: `${m.deflectionMm} мм`,
        limit: `≤ ${m.deflectionLimitMm} мм (L/360)`,
        suggestion: deeper
          ? `Увеличьте высоту сечения до ${deeper} мм или поставьте промежуточную опору.`
          : 'Нужна промежуточная несущая стена или прогон — табличные сечения не закрывают пролёт.',
      });
    } else if (m.okSpanTable) {
      checks.push({
        id: `floor_defl_${layout.floor}`,
        category: 'floor',
        severity: 'ok',
        title: `Прогиб балок этажа ${layout.floor + 1} ≤ L/360`,
        detail: `δ = ${m.deflectionMm} мм ≤ ${m.deflectionLimitMm} мм. Mmax = ${m.momentKNm} кН·м.`,
        actual: `${m.deflectionMm} мм`,
        limit: `≤ ${m.deflectionLimitMm} мм`,
      });
    }

    for (const wall of project.walls.filter((w) => w.floor === layout.floor && w.kind === 'exterior')) {
      const L = wallLength(wall) / 1000;
      if (L < 6.5) continue;
      const dx = Math.abs(wall.b.x - wall.a.x);
      const dy = Math.abs(wall.b.y - wall.a.y);
      const wallIsHorizontal = dx >= dy;
      const hasPerpInterior = project.walls.some((iw) => {
        if (iw.floor !== layout.floor || iw.id === wall.id) return false;
        if (iw.kind === 'exterior') return false;
        const idx = Math.abs(iw.b.x - iw.a.x);
        const idy = Math.abs(iw.b.y - iw.a.y);
        const iwHorizontal = idx >= idy;
        return iwHorizontal !== wallIsHorizontal && wallLength(iw) > 2000;
      });
      if (!hasPerpInterior && maxBay > tableMax) {
        checks.push({
          id: `wall_long_${wall.id}`,
          category: 'wall',
          severity: 'warn',
          title: `Длинная стена ${L.toFixed(1)} м без поперечной несущей перегородки`,
          detail:
            'Сама стена (стойки) несёт нагрузку вертикально; критичен пролёт перекрытия/стропил между параллельными опорами. Без поперечной стены пролёт равен ширине дома.',
          suggestion:
            'Добавьте внутреннюю несущую стену поперёк пролёта балок или усильте перекрытие прогоном.',
        });
      }
    }
  }

  for (const o of project.openings) {
    const wall = project.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    if (settings.floors === 1 && wall.floor === 1) continue;
    const clearW = o.width;
    const hDepth = headerHeightMm(clearW, settings.floors);
    const maxSpan = maxHeaderSpanM(hDepth, settings.floors);
    const spanM = clearW / 1000;
    const ok = spanM <= maxSpan + 0.02;
    checks.push({
      id: `header_${o.id}`,
      category: 'header',
      severity: ok ? 'ok' : 'fail',
      title: ok
        ? `Перемычка ${o.type === 'window' ? 'окна' : 'двери'} ${clearW} мм`
        : `Перемычка проёма ${clearW} мм сверх таблицы Б.13`,
      detail: `Сдвоенная перемычка высотой ${hDepth} мм на пролёт ${spanM.toFixed(2)} м (этажность ${settings.floors}).`,
      actual: `${spanM.toFixed(2)} м`,
      limit: `≤ ${maxSpan.toFixed(2)} м`,
      suggestion: ok
        ? undefined
        : 'Увеличьте высоту перемычки, поставьте колонну/столб в проёме или уменьшите ширину проёма.',
    });
  }

  {
    const exterior = project.walls.filter(
      (w) => w.kind === 'exterior' && w.floor === (settings.floors === 2 ? 1 : 0),
    );
    const base =
      exterior.length > 0
        ? exterior
        : project.walls.filter((w) => w.kind === 'exterior' && w.floor === 0);
    if (base.length) {
      const pts = base.flatMap((w) => [w.a, w.b]);
      const width = (Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))) / 1000;
      const section = settings.joistSectionMm;
      const spacing = settings.joistSpacingMm;
      let spanM: number;
      let label: string;
      if (settings.roofType === 'gable' || settings.roofType === 'hip') {
        // Clear span wall → ridge (overhang is cantilever beyond wall, not this span)
        spanM = width / 2;
        label = 'Стропила (пролёт стены → конёк)';
      } else {
        spanM = width;
        label = 'Стропила/балки кровли (пролёт между стенами)';
      }
      const tableMax = maxRafterSpanM(section.depth, spacing);
      const areaLoad = ROOF_SNOW_KPA + ROOF_DEAD_KPA;
      const m = memberSummary('rafter', label, spanM, section, spacing, areaLoad, tableMax);
      members.push(m);

      checks.push({
        id: 'roof_span',
        category: 'roof',
        severity: m.okSpanTable ? 'ok' : 'fail',
        title: m.okSpanTable
          ? 'Пролёт стропил в оценочном допуске'
          : 'Пролёт стропил превышает оценочную таблицу',
        detail: `${label}: ${spanM.toFixed(2)} м при ${section.width}×${section.depth} @ ${spacing} мм, снег ≈ ${ROOF_SNOW_KPA} кПа.`,
        actual: `${spanM.toFixed(2)} м`,
        limit: `≤ ${tableMax.toFixed(2)} м`,
        suggestion: m.okSpanTable
          ? undefined
          : 'Добавьте стойки под конёк / внутреннюю несущую стену, затяжки или фермы; уточните снег по СП 20 для региона.',
      });

      if (!m.okDeflection) {
        checks.push({
          id: 'roof_defl',
          category: 'roof',
          severity: 'fail',
          title: 'Прогиб стропил > L/360',
          detail: `δ = ${m.deflectionMm} мм > ${m.deflectionLimitMm} мм. M = ${m.momentKNm} кН·м.`,
          actual: `${m.deflectionMm} мм`,
          limit: `≤ ${m.deflectionLimitMm} мм`,
        });
      }
    }
  }

  checks.push({
    id: 'loads_assumed',
    category: 'loads',
    severity: 'warn',
    title: 'Нагрузки приняты укрупнённо',
    detail: assumptions.slice(0, 3).join(' · '),
    suggestion:
      'Для РД задайте снеговой/ветровой район по СП 20.13330 и уточните постоянные нагрузки пирога.',
  });

  const ok = checks.filter((c) => c.severity === 'ok').length;
  const warn = checks.filter((c) => c.severity === 'warn').length;
  const fail = checks.filter((c) => c.severity === 'fail').length;
  const worst: CheckSeverity = fail ? 'fail' : warn ? 'warn' : 'ok';

  checks.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return {
    checks,
    members,
    floorLayouts,
    summary: { ok, warn, fail, worst },
    assumptions,
  };
}

export function openingClearSpanM(o: Opening): number {
  return o.width / 1000;
}

export function wallIsNearlyAxisAligned(wall: Wall): 'x' | 'y' | 'skew' {
  const dx = Math.abs(wall.b.x - wall.a.x);
  const dy = Math.abs(wall.b.y - wall.a.y);
  if (dx >= dy * 3) return 'x';
  if (dy >= dx * 3) return 'y';
  return 'skew';
}
