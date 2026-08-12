import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS } from '../domain/materials';
import {
  projectPointOnSegment,
  snapPoint,
  uid,
  wallLength,
  resolveDraftSnap,
  wallSegmentCollides,
  finalizeWallJoins,
  gridStepForScale,
} from '../domain/geometry';
import type {
  FloorLevel,
  FurnitureItem,
  Opening,
  Point,
  Project,
  ProjectSettings,
  Tool,
  Wall,
  WallKind,
} from '../domain/types';
import { generateFrameModel } from '../engine/frameEngine';

function demoProject(): Project {
  const w1 = uid('wall');
  const w2 = uid('wall');
  const w3 = uid('wall');
  const w4 = uid('wall');
  const w5 = uid('wall');
  return {
    id: uid('proj'),
    name: 'Дом 6×8',
    units: 'mm',
    activeFloor: 0,
    updatedAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS, insulation: { ...DEFAULT_SETTINGS.insulation }, climate: { ...DEFAULT_SETTINGS.climate }, studSectionMm: { ...DEFAULT_SETTINGS.studSectionMm }, joistSectionMm: { ...DEFAULT_SETTINGS.joistSectionMm } },
    walls: [
      // Planner-style outer 8×6 m, t=200: through H = 8000, butt V = 7600
      { id: w1, a: { x: 0, y: 100 }, b: { x: 8000, y: 100 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
      { id: w2, a: { x: 7900, y: 200 }, b: { x: 7900, y: 5800 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
      { id: w3, a: { x: 8000, y: 5900 }, b: { x: 0, y: 5900 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
      { id: w4, a: { x: 100, y: 5800 }, b: { x: 100, y: 200 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
      { id: w5, a: { x: 4000, y: 200 }, b: { x: 4000, y: 5800 }, thickness: 120, kind: 'interior', height: 2700, floor: 0 },
    ],
    openings: [
      { id: uid('op'), wallId: w1, type: 'window', offset: 1200, width: 1200, height: 1400, sillHeight: 900, label: 'Окно 1' },
      { id: uid('op'), wallId: w1, type: 'window', offset: 5200, width: 1200, height: 1400, sillHeight: 900, label: 'Окно 2' },
      { id: uid('op'), wallId: w3, type: 'door', offset: 3200, width: 900, height: 2100, sillHeight: 0, label: 'Вход' },
      { id: uid('op'), wallId: w2, type: 'window', offset: 2000, width: 1000, height: 1400, sillHeight: 900 },
    ],
    furniture: [
      { id: uid('fur'), floor: 0, x: 1200, y: 3500, width: 2000, depth: 900, rotation: 0, kind: 'sofa', label: 'Диван' },
      { id: uid('fur'), floor: 0, x: 5200, y: 800, width: 1800, depth: 600, rotation: 0, kind: 'bed', label: 'Кровать' },
    ],
  };
}

interface EditorState {
  project: Project;
  tool: Tool;
  wallKind: WallKind;
  selectedId: string | null;
  draftStart: Point | null;
  scale: number;
  offset: Point;
  tab: 'editor' | 'frame' | 'structural' | 'cutting' | 'estimate' | 'thermal';
  setTool: (t: Tool) => void;
  setWallKind: (k: WallKind) => void;
  setTab: (t: EditorState['tab']) => void;
  setActiveFloor: (f: FloorLevel) => void;
  select: (id: string | null) => void;
  setScale: (s: number) => void;
  setOffset: (o: Point) => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;
  updateInsulation: (patch: Partial<ProjectSettings['insulation']>) => void;
  updateClimate: (patch: Partial<ProjectSettings['climate']>) => void;
  setProjectName: (name: string) => void;
  beginWall: (p: Point) => void;
  finishWall: (p: Point) => void;
  cancelDraft: () => void;
  addOpeningAt: (world: Point, type: 'window' | 'door') => void;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  deleteSelected: () => void;
  addFurniture: (kind: string) => void;
  moveFurniture: (id: string, x: number, y: number) => void;
  moveWallEndpoint: (id: string, end: 'a' | 'b', point: Point) => void;
  moveWallBy: (id: string, dx: number, dy: number) => void;
  /** Returns snapped point for UI feedback while dragging */
  previewEndpointSnap: (id: string, end: 'a' | 'b', point: Point) => Point;
  moveOpening: (id: string, offset: number) => void;
  resetDemo: () => void;
  copyFloorPlan: (from: FloorLevel, to: FloorLevel) => void;
  loadProject: (p: Project) => void;
  exportJson: () => string;
}

function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      project: demoProject(),
      tool: 'select',
      wallKind: 'exterior',
      selectedId: null,
      draftStart: null,
      scale: 0.08,
      offset: { x: 80, y: 80 },
      tab: 'editor',
      setTool: (tool) => set({ tool, draftStart: null }),
      setWallKind: (wallKind) => set({ wallKind }),
      setTab: (tab) => set({ tab }),
      setActiveFloor: (activeFloor) =>
        set((s) => ({ project: touch({ ...s.project, activeFloor }) })),
      select: (selectedId) => set({ selectedId }),
      setScale: (scale) => set({ scale }),
      setOffset: (offset) => set({ offset }),
      setProjectName: (name) => set((s) => ({ project: touch({ ...s.project, name }) })),
      updateSettings: (patch) =>
        set((s) => ({
          project: touch({
            ...s.project,
            settings: { ...s.project.settings, ...patch },
          }),
        })),
      updateInsulation: (patch) =>
        set((s) => ({
          project: touch({
            ...s.project,
            settings: {
              ...s.project.settings,
              insulation: { ...s.project.settings.insulation, ...patch },
            },
          }),
        })),
      updateClimate: (patch) =>
        set((s) => ({
          project: touch({
            ...s.project,
            settings: {
              ...s.project.settings,
              climate: { ...s.project.settings.climate, ...patch },
            },
          }),
        })),
      beginWall: (p) => {
        const { project, scale, wallKind } = get();
        const walls = project.walls.filter((w) => w.floor === project.activeFloor);
        const selfThickness = wallKind === 'exterior' ? 200 : 120;
        const hit = resolveDraftSnap(p, walls, { scale, selfThickness });
        set({ draftStart: hit.point });
      },
      cancelDraft: () => set({ draftStart: null }),
      finishWall: (p) => {
        const start = get().draftStart;
        if (!start) return;
        const { project, wallKind, scale } = get();
        const walls = project.walls.filter((w) => w.floor === project.activeFloor);
        const selfThickness = wallKind === 'exterior' ? 200 : 120;
        // p may already be snapped by canvas; resolve again for safety
        let end = resolveDraftSnap(p, walls, { from: start, scale, selfThickness }).point;
        if (Math.hypot(end.x - start.x, end.y - start.y) < 200) {
          set({ draftStart: null });
          return;
        }
        if (wallSegmentCollides(start, end, walls)) {
          const retry = resolveDraftSnap(p, walls, { from: start, scale, selfThickness });
          if (
            (retry.kind === 'endpoint' || retry.kind === 'endface' || retry.kind === 'face') &&
            !wallSegmentCollides(start, retry.point, walls)
          ) {
            end = retry.point;
          } else {
            set({ draftStart: null });
            return;
          }
        }
        const wall: Wall = {
          id: uid('wall'),
          a: start,
          b: end,
          thickness: selfThickness,
          kind: wallKind,
          height: project.settings.floorHeightMm,
          floor: project.activeFloor,
        };
        const joined = finalizeWallJoins([...project.walls, wall], project.activeFloor);
        set({
          draftStart: null,
          selectedId: wall.id,
          project: touch({ ...project, walls: joined }),
        });
      },
      addOpeningAt: (world, type) => {
        const { project } = get();
        const walls = project.walls.filter((w) => w.floor === project.activeFloor);
        let best: { wall: Wall; offset: number; dist: number } | null = null;
        for (const wall of walls) {
          const hit = projectPointOnSegment(world, wall.a, wall.b);
          if (!best || hit.dist < best.dist) {
            best = { wall, offset: hit.t * wallLength(wall), dist: hit.dist };
          }
        }
        if (!best || best.dist > 800) return;
        const opening: Opening = {
          id: uid('op'),
          wallId: best.wall.id,
          type,
          offset: Math.round(best.offset),
          width: type === 'window' ? 1200 : 900,
          height: type === 'window' ? 1400 : 2100,
          sillHeight: type === 'window' ? 900 : 0,
          label: type === 'window' ? 'Окно' : 'Дверь',
        };
        set({
          selectedId: opening.id,
          project: touch({ ...project, openings: [...project.openings, opening] }),
        });
      },
      updateOpening: (id, patch) =>
        set((s) => ({
          project: touch({
            ...s.project,
            openings: s.project.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          }),
        })),
      updateWall: (id, patch) =>
        set((s) => ({
          project: touch({
            ...s.project,
            walls: s.project.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)),
          }),
        })),
      deleteSelected: () => {
        const { selectedId, project } = get();
        if (!selectedId) return;
        set({
          selectedId: null,
          project: touch({
            ...project,
            walls: project.walls.filter((w) => w.id !== selectedId),
            openings: project.openings.filter(
              (o) => o.id !== selectedId && o.wallId !== selectedId,
            ),
            furniture: project.furniture.filter((f) => f.id !== selectedId),
          }),
        });
      },
      addFurniture: (kind) => {
        const labels: Record<string, string> = {
          sofa: 'Диван',
          bed: 'Кровать',
          table: 'Стол',
          wardrobe: 'Шкаф',
        };
        const sizes: Record<string, { width: number; depth: number }> = {
          sofa: { width: 2000, depth: 900 },
          bed: { width: 2000, depth: 1600 },
          table: { width: 1200, depth: 800 },
          wardrobe: { width: 1000, depth: 600 },
        };
        const item: FurnitureItem = {
          id: uid('fur'),
          floor: get().project.activeFloor,
          x: 1000,
          y: 1000,
          ...sizes[kind],
          rotation: 0,
          kind,
          label: labels[kind] ?? kind,
        };
        set((s) => ({
          selectedId: item.id,
          project: touch({ ...s.project, furniture: [...s.project.furniture, item] }),
        }));
      },
      moveFurniture: (id, x, y) =>
        set((s) => {
          const g = gridStepForScale(s.scale);
          const snapped = snapPoint({ x, y }, g);
          return {
            project: touch({
              ...s.project,
              furniture: s.project.furniture.map((f) =>
                f.id === id ? { ...f, x: snapped.x, y: snapped.y } : f,
              ),
            }),
          };
        }),
      moveWallEndpoint: (id, end, point) =>
        set((s) => {
          const wall = s.project.walls.find((w) => w.id === id);
          if (!wall) return s;
          const others = s.project.walls.filter(
            (w) => w.floor === s.project.activeFloor && w.id !== id,
          );
          const fixed = end === 'a' ? wall.b : wall.a;
          const hit = resolveDraftSnap(point, others, {
            ignoreWallId: id,
            from: fixed,
            scale: s.scale,
            selfThickness: wall.thickness,
          });
          let p = hit.point;
          if (wallSegmentCollides(fixed, p, others)) {
            if (
              (hit.kind === 'endpoint' || hit.kind === 'endface' || hit.kind === 'face') &&
              !wallSegmentCollides(fixed, hit.point, others)
            ) {
              p = hit.point;
            } else {
              return s;
            }
          }
          if (Math.hypot(p.x - fixed.x, p.y - fixed.y) < 200) return s;
          const walls = s.project.walls.map((w) =>
            w.id === id ? { ...w, [end]: p } : w,
          );
          return {
            project: touch({
              ...s.project,
              walls: finalizeWallJoins(walls, s.project.activeFloor),
            }),
          };
        }),
      previewEndpointSnap: (id, end, point) => {
        const s = get();
        const wall = s.project.walls.find((w) => w.id === id);
        if (!wall) return point;
        const others = s.project.walls.filter(
          (w) => w.floor === s.project.activeFloor && w.id !== id,
        );
        const fixed = end === 'a' ? wall.b : wall.a;
        const hit = resolveDraftSnap(point, others, {
          ignoreWallId: id,
          from: fixed,
          scale: s.scale,
          selfThickness: wall.thickness,
        });
        if (wallSegmentCollides(fixed, hit.point, others)) return wall[end];
        return hit.point;
      },
      moveWallBy: (id, dx, dy) =>
        set((s) => {
          const wall = s.project.walls.find((w) => w.id === id);
          if (!wall) return s;
          const others = s.project.walls.filter(
            (w) => w.floor === s.project.activeFloor && w.id !== id,
          );
          let adx = dx;
          let ady = dy;
          const candidates: { dx: number; dy: number; dist: number }[] = [];
          for (const end of ['a', 'b'] as const) {
            const raw = { x: wall[end].x + dx, y: wall[end].y + dy };
            const hit = resolveDraftSnap(raw, others, {
              scale: s.scale,
              selfThickness: wall.thickness,
            });
            if (hit.kind !== 'grid') {
              candidates.push({
                dx: hit.point.x - wall[end].x,
                dy: hit.point.y - wall[end].y,
                dist: hit.strength,
              });
            }
          }
          if (candidates.length) {
            candidates.sort((a, b) => a.dist - b.dist);
            adx = candidates[0].dx;
            ady = candidates[0].dy;
          } else {
            // Keep translation on grid
            const snapped = resolveDraftSnap(
              { x: wall.a.x + dx, y: wall.a.y + dy },
              others,
              { scale: s.scale, selfThickness: wall.thickness },
            ).point;
            adx = snapped.x - wall.a.x;
            ady = snapped.y - wall.a.y;
          }
          const nextA = { x: Math.round(wall.a.x + adx), y: Math.round(wall.a.y + ady) };
          const nextB = { x: Math.round(wall.b.x + adx), y: Math.round(wall.b.y + ady) };
          if (wallSegmentCollides(nextA, nextB, others)) return s;
          const walls = s.project.walls.map((w) =>
            w.id === id ? { ...w, a: nextA, b: nextB } : w,
          );
          return {
            project: touch({
              ...s.project,
              walls: finalizeWallJoins(walls, s.project.activeFloor),
            }),
          };
        }),
      moveOpening: (id, offset) =>
        set((s) => {
          const opening = s.project.openings.find((o) => o.id === id);
          if (!opening) return s;
          const wall = s.project.walls.find((w) => w.id === opening.wallId);
          if (!wall) return s;
          const max = Math.max(0, wallLength(wall) - opening.width);
          const next = Math.max(0, Math.min(max, Math.round(offset)));
          return {
            project: touch({
              ...s.project,
              openings: s.project.openings.map((o) =>
                o.id === id ? { ...o, offset: next } : o,
              ),
            }),
          };
        }),
      resetDemo: () => set({ project: demoProject(), selectedId: null, draftStart: null }),
      copyFloorPlan: (from, to) => {
        const { project } = get();
        const idMap = new Map<string, string>();
        const walls = project.walls
          .filter((w) => w.floor === from)
          .map((w) => {
            const id = uid('wall');
            idMap.set(w.id, id);
            return { ...w, id, floor: to, height: project.settings.floorHeightMm };
          });
        const openings = project.openings
          .filter((o) => idMap.has(o.wallId))
          .map((o) => ({
            ...o,
            id: uid('op'),
            wallId: idMap.get(o.wallId)!,
          }));
        const withoutTarget = {
          walls: project.walls.filter((w) => w.floor !== to),
          openings: project.openings.filter(
            (o) => !project.walls.some((w) => w.floor === to && w.id === o.wallId),
          ),
        };
        set({
          project: touch({
            ...project,
            walls: [...withoutTarget.walls, ...walls],
            openings: [...withoutTarget.openings, ...openings],
            activeFloor: to,
          }),
          selectedId: null,
        });
      },
      loadProject: (project) => set({ project, selectedId: null }),
      exportJson: () => JSON.stringify(get().project, null, 2),
    }),
    { name: 'frameplan-project-v2' },
  ),
);

export function useFrameModel() {
  const project = useEditorStore((s) => s.project);
  return generateFrameModel(project);
}
