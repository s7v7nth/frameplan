import type {
  ExteriorCladding,
  FloorFinish,
  InteriorFinish,
  ProjectSettings,
} from './types';

export interface MaterialSpec {
  id: string;
  name: string;
  lambda: number; // W/(m·K)
  thicknessMm?: number;
  priceRubPerM2?: number;
  priceRubPerM3?: number;
  densityKgM3?: number;
}

export const EXTERIOR_CLADDING: Record<ExteriorCladding, MaterialSpec> = {
  vinyl_siding: {
    id: 'vinyl_siding',
    name: 'Виниловый сайдинг',
    lambda: 0.16,
    thicknessMm: 1.1,
    priceRubPerM2: 450,
  },
  fiber_cement: {
    id: 'fiber_cement',
    name: 'Фиброцементные панели',
    lambda: 0.25,
    thicknessMm: 8,
    priceRubPerM2: 1200,
  },
  wood_board: {
    id: 'wood_board',
    name: 'Доска (имитация бруса)',
    lambda: 0.14,
    thicknessMm: 20,
    priceRubPerM2: 900,
  },
  osb_plaster: {
    id: 'osb_plaster',
    name: 'ОСП + штукатурка',
    lambda: 0.13,
    thicknessMm: 15,
    priceRubPerM2: 700,
  },
  metal_siding: {
    id: 'metal_siding',
    name: 'Металлосайдинг',
    lambda: 50,
    thicknessMm: 0.5,
    priceRubPerM2: 650,
  },
};

export const INTERIOR_FINISH: Record<InteriorFinish, MaterialSpec> = {
  gypsum_board: {
    id: 'gypsum_board',
    name: 'ГКЛ 12,5 мм',
    lambda: 0.21,
    thicknessMm: 12.5,
    priceRubPerM2: 280,
  },
  osb: {
    id: 'osb',
    name: 'ОСП-3 12 мм',
    lambda: 0.13,
    thicknessMm: 12,
    priceRubPerM2: 420,
  },
  wood_lining: {
    id: 'wood_lining',
    name: 'Вагонка',
    lambda: 0.14,
    thicknessMm: 14,
    priceRubPerM2: 650,
  },
  plywood: {
    id: 'plywood',
    name: 'Фанера ФК 12 мм',
    lambda: 0.15,
    thicknessMm: 12,
    priceRubPerM2: 550,
  },
};

export const FLOOR_FINISH: Record<FloorFinish, MaterialSpec> = {
  osb_subfloor: {
    id: 'osb_subfloor',
    name: 'Черновой пол ОСП-3 18 мм',
    lambda: 0.13,
    thicknessMm: 18,
    priceRubPerM2: 620,
  },
  plywood_subfloor: {
    id: 'plywood_subfloor',
    name: 'Черновой пол фанера 18 мм',
    lambda: 0.15,
    thicknessMm: 18,
    priceRubPerM2: 780,
  },
  tongue_groove: {
    id: 'tongue_groove',
    name: 'Шпунтованная доска 36 мм',
    lambda: 0.14,
    thicknessMm: 36,
    priceRubPerM2: 1100,
  },
  laminate_over_osb: {
    id: 'laminate_over_osb',
    name: 'ОСП 18 мм + ламинат',
    lambda: 0.12,
    thicknessMm: 26,
    priceRubPerM2: 1400,
  },
};

export const INSULATION_OPTIONS = [
  { id: 'rockwool', name: 'Каменная вата', lambda: 0.037, priceRubPerM3: 4500 },
  { id: 'glasswool', name: 'Стекловата', lambda: 0.04, priceRubPerM3: 3200 },
  { id: 'pir', name: 'ПИР-плиты', lambda: 0.022, priceRubPerM3: 12000 },
  { id: 'eps', name: 'Пенополистирол', lambda: 0.038, priceRubPerM3: 3800 },
] as const;

export const STOCK_LENGTHS_MM = [6000, 4500, 3000] as const;
/** Preferred stock length for nesting (typical lumber yard). */
export const PREFERRED_STOCK_MM = 6000;

export const DEFAULT_SETTINGS: ProjectSettings = {
  floors: 1,
  floorHeightMm: 2700,
  studSpacingMm: 600,
  joistSpacingMm: 600,
  studSectionMm: { width: 50, depth: 150 },
  joistSectionMm: { width: 50, depth: 250 },
  roofType: 'gable',
  roofPitchDeg: 30,
  overhangMm: 500,
  exteriorCladding: 'vinyl_siding',
  interiorFinish: 'gypsum_board',
  floorFinish: 'osb_subfloor',
  insulation: {
    wallThicknessMm: 150,
    floorThicknessMm: 200,
    ceilingThicknessMm: 200,
    wallLambda: 0.037,
    floorLambda: 0.037,
    ceilingLambda: 0.037,
  },
  climate: {
    designOutdoorC: -28,
    designIndoorC: 21,
    regionName: 'Москва',
    airExchangeRate: 0.5,
  },
  wasteFactor: 1.1,
  lumberPriceRubPerM3: 28000,
  sheetPriceRubPerM2: 550,
  insulationPriceRubPerM3: 4500,
  fastenerPriceRubPerKg: 180,
};

export const CLIMATE_PRESETS = [
  { regionName: 'Москва', designOutdoorC: -28 },
  { regionName: 'Санкт-Петербург', designOutdoorC: -26 },
  { regionName: 'Екатеринбург', designOutdoorC: -35 },
  { regionName: 'Новосибирск', designOutdoorC: -39 },
  { regionName: 'Краснодар', designOutdoorC: -19 },
  { regionName: 'Владивосток', designOutdoorC: -24 },
] as const;
