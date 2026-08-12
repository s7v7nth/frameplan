import { DEFAULT_SETTINGS } from './materials';
import type {
  FurnitureItem,
  Opening,
  Point,
  Project,
  ProjectSettings,
  Wall,
} from './types';
import { uid } from './geometry';

function isPoint(v: unknown): v is Point {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Point).x === 'number' &&
    typeof (v as Point).y === 'number' &&
    Number.isFinite((v as Point).x) &&
    Number.isFinite((v as Point).y)
  );
}

function isWall(v: unknown): v is Wall {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Wall;
  return (
    typeof w.id === 'string' &&
    isPoint(w.a) &&
    isPoint(w.b) &&
    typeof w.thickness === 'number' &&
    (w.kind === 'exterior' || w.kind === 'interior') &&
    typeof w.height === 'number' &&
    (w.floor === 0 || w.floor === 1)
  );
}

function isOpening(v: unknown): v is Opening {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Opening;
  return (
    typeof o.id === 'string' &&
    typeof o.wallId === 'string' &&
    (o.type === 'window' || o.type === 'door') &&
    typeof o.offset === 'number' &&
    typeof o.width === 'number' &&
    typeof o.height === 'number' &&
    typeof o.sillHeight === 'number'
  );
}

function isFurniture(v: unknown): v is FurnitureItem {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as FurnitureItem;
  return (
    typeof f.id === 'string' &&
    (f.floor === 0 || f.floor === 1) &&
    typeof f.x === 'number' &&
    typeof f.y === 'number' &&
    typeof f.width === 'number' &&
    typeof f.depth === 'number' &&
    typeof f.rotation === 'number' &&
    typeof f.kind === 'string' &&
    typeof f.label === 'string'
  );
}

function mergeSettings(raw: unknown): ProjectSettings {
  const base: ProjectSettings = {
    ...DEFAULT_SETTINGS,
    insulation: { ...DEFAULT_SETTINGS.insulation },
    climate: { ...DEFAULT_SETTINGS.climate },
    studSectionMm: { ...DEFAULT_SETTINGS.studSectionMm },
    joistSectionMm: { ...DEFAULT_SETTINGS.joistSectionMm },
  };
  if (typeof raw !== 'object' || raw === null) return base;
  const s = raw as Partial<ProjectSettings>;
  return {
    ...base,
    ...s,
    insulation: { ...base.insulation, ...(s.insulation ?? {}) },
    climate: { ...base.climate, ...(s.climate ?? {}) },
    studSectionMm: { ...base.studSectionMm, ...(s.studSectionMm ?? {}) },
    joistSectionMm: { ...base.joistSectionMm, ...(s.joistSectionMm ?? {}) },
    floors: s.floors === 2 ? 2 : 1,
    studSpacingMm: s.studSpacingMm === 400 ? 400 : 600,
    joistSpacingMm: s.joistSpacingMm === 400 ? 400 : 600,
    foundationType:
      s.foundationType === 'strip' || s.foundationType === 'slab' || s.foundationType === 'pile'
        ? s.foundationType
        : base.foundationType,
  };
}

export type ParseProjectResult =
  | { ok: true; project: Project }
  | { ok: false; error: string };

/** Parse and validate a FramePlan project JSON string. */
export function parseProjectJson(text: string): ParseProjectResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл не является корректным JSON.' };
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'Корень JSON должен быть объектом проекта.' };
  }
  const raw = data as Record<string, unknown>;
  if (!Array.isArray(raw.walls) || !raw.walls.every(isWall)) {
    return { ok: false, error: 'Нужен массив walls с корректными стенами.' };
  }
  if (!Array.isArray(raw.openings) || !raw.openings.every(isOpening)) {
    return { ok: false, error: 'Нужен массив openings с окнами/дверями.' };
  }
  const furniture = Array.isArray(raw.furniture) ? raw.furniture : [];
  if (!furniture.every(isFurniture)) {
    return { ok: false, error: 'Массив furniture содержит некорректные элементы.' };
  }
  const wallIds = new Set((raw.walls as Wall[]).map((w) => w.id));
  for (const o of raw.openings as Opening[]) {
    if (!wallIds.has(o.wallId)) {
      return { ok: false, error: `Проём ${o.id} ссылается на несуществующую стену.` };
    }
  }

  const project: Project = {
    id: typeof raw.id === 'string' ? raw.id : uid('proj'),
    name: typeof raw.name === 'string' ? raw.name : 'Импортированный проект',
    units: 'mm',
    walls: raw.walls as Wall[],
    openings: raw.openings as Opening[],
    furniture: furniture as FurnitureItem[],
    settings: mergeSettings(raw.settings),
    activeFloor: raw.activeFloor === 1 ? 1 : 0,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
  return { ok: true, project };
}
