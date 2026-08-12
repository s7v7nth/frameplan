export type Tool =
  | 'select'
  | 'wall'
  | 'window'
  | 'door'
  | 'delete'
  | 'measure';

export type WallKind = 'exterior' | 'interior';
export type FloorLevel = 0 | 1;
export type RoofType = 'gable' | 'hip' | 'shed' | 'flat';
export type FoundationType = 'pile' | 'strip' | 'slab';

export type ExteriorCladding =
  | 'vinyl_siding'
  | 'fiber_cement'
  | 'wood_board'
  | 'osb_plaster'
  | 'metal_siding';

export type InteriorFinish =
  | 'gypsum_board'
  | 'osb'
  | 'wood_lining'
  | 'plywood';

export type FloorFinish =
  | 'osb_subfloor'
  | 'plywood_subfloor'
  | 'tongue_groove'
  | 'laminate_over_osb';

export interface Point {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  thickness: number; // mm
  kind: WallKind;
  height: number; // mm
  floor: FloorLevel;
}

export interface Opening {
  id: string;
  wallId: string;
  type: 'window' | 'door';
  /** Offset along wall from point A, mm */
  offset: number;
  width: number; // mm
  height: number; // mm
  /** Sill height from finished floor, mm (windows). Doors typically 0 */
  sillHeight: number;
  label?: string;
}

export interface FurnitureItem {
  id: string;
  floor: FloorLevel;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
  kind: string;
  label: string;
}

export interface InsulationSettings {
  wallThicknessMm: number;
  floorThicknessMm: number;
  ceilingThicknessMm: number;
  wallLambda: number;
  floorLambda: number;
  ceilingLambda: number;
}

export interface ClimateSettings {
  designOutdoorC: number;
  designIndoorC: number;
  regionName: string;
  airExchangeRate: number; // 1/h
}

export interface ProjectSettings {
  floors: 1 | 2;
  floorHeightMm: number;
  studSpacingMm: 400 | 600;
  joistSpacingMm: 400 | 600;
  studSectionMm: { width: number; depth: number };
  joistSectionMm: { width: number; depth: number };
  roofType: RoofType;
  roofPitchDeg: number;
  overhangMm: number;
  foundationType: FoundationType;
  exteriorCladding: ExteriorCladding;
  interiorFinish: InteriorFinish;
  floorFinish: FloorFinish;
  insulation: InsulationSettings;
  climate: ClimateSettings;
  wasteFactor: number;
  lumberPriceRubPerM3: number;
  sheetPriceRubPerM2: number;
  insulationPriceRubPerM3: number;
  fastenerPriceRubPerKg: number;
}

export interface RoomInfo {
  id: string;
  floor: FloorLevel;
  label: string;
  areaM2: number;
  centroid: { x: number; y: number };
  polygon: { x: number; y: number }[];
}

export interface Project {
  id: string;
  name: string;
  units: 'mm';
  walls: Wall[];
  openings: Opening[];
  furniture: FurnitureItem[];
  settings: ProjectSettings;
  activeFloor: FloorLevel;
  updatedAt: string;
}

export interface LumberPiece {
  id: string;
  category:
    | 'sill'
    | 'bottom_plate'
    | 'top_plate'
    | 'stud'
    | 'jack_stud'
    | 'king_stud'
    | 'header'
    | 'cripple'
    | 'joist'
    | 'rim_joist'
    | 'rafter'
    | 'ridge'
    | 'blocking';
  label: string;
  sectionMm: { width: number; depth: number };
  lengthMm: number;
  floor: FloorLevel | 'roof' | 'foundation';
  wallId?: string;
  qty: number;
}

/** Geometric framing member for drawings (plan + elevation). */
export interface FrameMember {
  id: string;
  kind: LumberPiece['category'];
  label: string;
  sectionMm: { width: number; depth: number };
  lengthMm: number;
  floor: FloorLevel | 'roof' | 'foundation';
  wallId?: string;
  plan?: { x1: number; y1: number; x2: number; y2: number };
  planMark?: { x: number; y: number; angle: number };
  elev?: { s0: number; s1: number; z0: number; z1: number };
}

export interface SheetItem {
  id: string;
  category: 'subfloor' | 'wall_sheathing' | 'roof_sheathing' | 'interior' | 'cladding';
  label: string;
  thicknessMm: number;
  widthMm: number;
  heightMm: number;
  areaM2: number;
  qty: number;
}

export interface CuttingBoard {
  id: string;
  index: number;
  stockLengthMm: number;
  cuts: { label: string; lengthMm: number }[];
  usedMm: number;
  wasteMm: number;
}

export interface CuttingStock {
  sectionMm: { width: number; depth: number };
  stockLengthMm: number;
  /** Per physical stock board: how it is cut */
  boards: CuttingBoard[];
  /** Aggregated piece demand (for reference) */
  pieces: { lengthMm: number; label: string; qty: number }[];
  /** How many stock boards to buy (with waste factor) */
  boardsNeeded: number;
  wasteMm: number;
  utilization: number;
}

export interface BomLine {
  id: string;
  group: string;
  name: string;
  unit: 'шт' | 'м' | 'м²' | 'м³' | 'кг';
  qty: number;
  unitPrice: number;
  total: number;
  note?: string;
}

export interface HeatLossSurface {
  id: string;
  name: string;
  areaM2: number;
  uValue: number;
  deltaT: number;
  lossW: number;
}

export interface HeatLossResult {
  surfaces: HeatLossSurface[];
  transmissionW: number;
  ventilationW: number;
  totalW: number;
  specificWm2: number;
  heatedAreaM2: number;
  volumeM3: number;
}

export interface FrameModel {
  lumber: LumberPiece[];
  members: FrameMember[];
  sheets: SheetItem[];
  cutting: CuttingStock[];
  bom: BomLine[];
  heatLoss: HeatLossResult;
  projections: {
    planSvg: string;
    elevationFrontSvg: string;
    elevationSideSvg: string;
    roofSvg: string;
    wallElevations: { wallId: string; title: string; svg: string }[];
  };
  rooms: RoomInfo[];
  summary: {
    footprintM2: number;
    heatedAreaM2: number;
    perimeterM: number;
    wallLengthM: number;
    studCount: number;
    lumberVolumeM3: number;
  };
}
