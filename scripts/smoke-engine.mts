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
    floors: 2,
    roofType: 'gable',
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
    { id: 'w5', a: { x: 0, y: 0 }, b: { x: 6000, y: 0 }, thickness: 200, kind: 'exterior', height: 2700, floor: 1 },
    { id: 'w6', a: { x: 6000, y: 0 }, b: { x: 6000, y: 6000 }, thickness: 200, kind: 'exterior', height: 2700, floor: 1 },
    { id: 'w7', a: { x: 6000, y: 6000 }, b: { x: 0, y: 6000 }, thickness: 200, kind: 'exterior', height: 2700, floor: 1 },
    { id: 'w8', a: { x: 0, y: 6000 }, b: { x: 0, y: 0 }, thickness: 200, kind: 'exterior', height: 2700, floor: 1 },
  ],
  openings: [
    { id: 'o1', wallId: 'w1', type: 'window', offset: 1500, width: 1200, height: 1400, sillHeight: 900 },
    { id: 'o2', wallId: 'w3', type: 'door', offset: 2500, width: 900, height: 2100, sillHeight: 0 },
  ],
  furniture: [],
};

const model = generateFrameModel(project);
console.log(
  JSON.stringify(
    {
      footprint: model.summary.footprintM2,
      studs: model.summary.studCount,
      lumberM3: Number(model.summary.lumberVolumeM3.toFixed(3)),
      bomLines: model.bom.length,
      cuttingGroups: model.cutting.length,
      heatKw: Number((model.heatLoss.totalW / 1000).toFixed(2)),
      hasSill: model.lumber.some((l) => l.category === 'sill'),
      hasRafters: model.lumber.some((l) => l.category === 'rafter'),
    },
    null,
    2,
  ),
);

if (model.summary.footprintM2 < 30 || model.summary.studCount < 20 || !model.lumber.some((l) => l.category === 'sill')) {
  process.exit(1);
}
