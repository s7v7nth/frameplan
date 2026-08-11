import { DEFAULT_SETTINGS } from '../src/domain/materials';
import { generateFrameModel } from '../src/engine/frameEngine';
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
  sampleBoard: model.cutting[0]?.boards[0],
  buyQty: bomStock.map((b) => ({ name: b.name, qty: b.qty })),
};

console.log(JSON.stringify(report, null, 2));

if (
  report.jacks < 4 ||
  report.kings < 4 ||
  report.headers < 4 ||
  report.california < 8 ||
  !report.stock6000 ||
  !report.hasBoardCuts ||
  report.bomStockLines < 1
) {
  console.error('Smoke failed');
  process.exit(1);
}
