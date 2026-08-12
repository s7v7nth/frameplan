import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS } from '../domain/materials';
import {
  projectPointOnSegment,
  snapPoint,
  uid,
  wallLength,
  magnetSnapPoint,
  wallSegmentCollides,
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

const HISTORY_LIMIT = 50;

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
    settings: {
      ...DEFAULT_SETTINGS,
      insulation: { ...DEFAULT_SETTINGS.insulation },
      climate: { ...DEFAULT_SETTINGS.climate },
      studSectionMm: { ...DEFAULT_SETTINGS.studSectionMm },
      joistSectionMm: { ...DEFAULT_SETTINGS.joistSectionMm },
    },
    walls: [
      { id: w1, a: { x: 0, y: 0 }, b: { x: 8000, y: 0 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
      { id: w2, a: { x: 8000, y: 0 }, b: { x: 8000, y: 6000 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
      { id: w3, a: { x: 8000, y: 6000 }, b: { x: 0, y: 6000 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
      { id: w4, a: { x: 0, y: 6000 }, b: { x: 0, y: 0 }, thickness: 200, kind: 'exterior', height: 2700, floor: 0 },
      { id: w5, a: { x: 4000, y: 0 }, b: { x: 4000, y: 6000 }, thickness: 120, kind: 'interior', height: 2700, floor: 0 },
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

function cloneProject(p: Project): Project {
  return structuredClone(p);
}

interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  tool: Tool;
  wallKind: WallKind;
  selectedId: string | null;
  draftStart: Point | null;
  scale: number;
  offset: Point;
  tab: 'editor' | 'frame' | 'cutting' | 'estimate' | 'thermal';
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
  /** Snapshot current project before a gesture (drag) or batch edit */
  captureHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

type SetFn = (
  partial:
    | Partial<EditorState>
    | ((s: EditorState) => Partial<EditorState>),
) => void;
type GetFn = () => EditorState;

function pushPast(get: GetFn, set: SetFn) {
  const { project, past } = get();
  const nextPast = [...past, cloneProject(project)].slice(-HISTORY_LIMIT);
  set({ past: nextPast, future: [] });
}

function setProject(get: GetFn, set: SetFn, project: Project, extra: Partial<EditorState> = {}) {
  pushPast(get, set);
  set({ project: touch(project), ...extra });
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      project: demoProject(),
      past: [],
      future: [],
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
      setProjectName: (name) =>
        set((s) => ({ project: touch({ ...s.project, name }) })),
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
        const { project } = get();
        const walls = project.walls.filter((w) => w.floor === project.activeFloor);
        const hit = magnetSnapPoint(p, walls, { freeWhenFar: false });
        set({ draftStart: hit.point });
      },
      cancelDraft: () => set({ draftStart: null }),
      finishWall: (p) => {
        const start = get().draftStart;
        if (!start) return;
        const { project, wallKind } = get();
        const walls = project.walls.filter((w) => w.floor === project.activeFloor);
        const hit = magnetSnapPoint(p, walls, { freeWhenFar: false });
        let end = hit.point;
        if (Math.hypot(end.x - start.x, end.y - start.y) < 200) {
          set({ draftStart: null });
          return;
        }
        if (wallSegmentCollides(start, end, walls)) {
          const endOnly = magnetSnapPoint(p, walls, { freeWhenFar: true, magnetMm: 400 });
          if (endOnly.kind === 'endpoint' && !wallSegmentCollides(start, endOnly.point, walls)) {
            end = endOnly.point;
          } else {
            set({ draftStart: null });
            return;
          }
        }
        const wall: Wall = {
          id: uid('wall'),
          a: start,
          b: end,
          thickness: wallKind === 'exterior' ? 200 : 120,
          kind: wallKind,
          height: project.settings.floorHeightMm,
          floor: project.activeFloor,
        };
        setProject(
          get,
          set,
          { ...project, walls: [...project.walls, wall] },
          { draftStart: null, selectedId: wall.id },
        );
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
        setProject(
          get,
          set,
          { ...project, openings: [...project.openings, opening] },
          { selectedId: opening.id },
        );
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
        setProject(
          get,
          set,
          {
            ...project,
            walls: project.walls.filter((w) => w.id !== selectedId),
            openings: project.openings.filter(
              (o) => o.id !== selectedId && o.wallId !== selectedId,
            ),
            furniture: project.furniture.filter((f) => f.id !== selectedId),
          },
          { selectedId: null },
        );
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
        setProject(
          get,
          set,
          { ...get().project, furniture: [...get().project.furniture, item] },
          { selectedId: item.id },
        );
      },
      // Continuous drags: history captured via captureHistory() from canvas
      moveFurniture: (id, x, y) =>
        set((s) => ({
          project: touch({
            ...s.project,
            furniture: s.project.furniture.map((f) =>
              f.id === id ? { ...f, x: snapPoint({ x, y }).x, y: snapPoint({ x, y }).y } : f,
            ),
          }),
        })),
      moveWallEndpoint: (id, end, point) =>
        set((s) => {
          const wall = s.project.walls.find((w) => w.id === id);
          if (!wall) return s;
          const others = s.project.walls.filter(
            (w) => w.floor === s.project.activeFloor && w.id !== id,
          );
          const hit = magnetSnapPoint(point, others, { ignoreWallId: id, freeWhenFar: true });
          let p =
            hit.kind === 'grid'
              ? { x: Math.round(point.x), y: Math.round(point.y) }
              : hit.point;
          const fixed = end === 'a' ? wall.b : wall.a;
          if (wallSegmentCollides(fixed, p, others)) {
            if (hit.kind !== 'grid' && !wallSegmentCollides(fixed, hit.point, others)) {
              p = hit.point;
            } else {
              const retry = magnetSnapPoint(point, others, {
                ignoreWallId: id,
                freeWhenFar: true,
                magnetMm: 400,
              });
              if (retry.kind !== 'grid' && !wallSegmentCollides(fixed, retry.point, others)) {
                p = retry.point;
              } else {
                return s;
              }
            }
          }
          if (Math.hypot(p.x - fixed.x, p.y - fixed.y) < 200) return s;
          return {
            project: touch({
              ...s.project,
              walls: s.project.walls.map((w) => (w.id === id ? { ...w, [end]: p } : w)),
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
        const hit = magnetSnapPoint(point, others, { ignoreWallId: id, freeWhenFar: true });
        let p =
          hit.kind === 'grid'
            ? { x: Math.round(point.x), y: Math.round(point.y) }
            : hit.point;
        const fixed = end === 'a' ? wall.b : wall.a;
        if (wallSegmentCollides(fixed, p, others)) {
          return wall[end];
        }
        return p;
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
            const hit = magnetSnapPoint(raw, others, { freeWhenFar: true });
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
          }
          const nextA = { x: Math.round(wall.a.x + adx), y: Math.round(wall.a.y + ady) };
          const nextB = { x: Math.round(wall.b.x + adx), y: Math.round(wall.b.y + ady) };
          if (wallSegmentCollides(nextA, nextB, others)) return s;
          return {
            project: touch({
              ...s.project,
              walls: s.project.walls.map((w) => {
                if (w.id !== id) return w;
                return { ...w, a: nextA, b: nextB };
              }),
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
      resetDemo: () => {
        pushPast(get, set);
        set({ project: demoProject(), selectedId: null, draftStart: null, future: [] });
      },
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
        setProject(
          get,
          set,
          {
            ...project,
            walls: [...withoutTarget.walls, ...walls],
            openings: [...withoutTarget.openings, ...openings],
            activeFloor: to,
          },
          { selectedId: null },
        );
      },
      loadProject: (project) =>
        set({
          project: touch(project),
          selectedId: null,
          draftStart: null,
          past: [],
          future: [],
        }),
      exportJson: () => JSON.stringify(get().project, null, 2),
      captureHistory: () => pushPast(get, set),
      undo: () => {
        const { past, project, future } = get();
        if (!past.length) return;
        const prev = past[past.length - 1];
        set({
          past: past.slice(0, -1),
          future: [cloneProject(project), ...future].slice(0, HISTORY_LIMIT),
          project: prev,
          selectedId: null,
          draftStart: null,
        });
      },
      redo: () => {
        const { past, project, future } = get();
        if (!future.length) return;
        const next = future[0];
        set({
          future: future.slice(1),
          past: [...past, cloneProject(project)].slice(-HISTORY_LIMIT),
          project: next,
          selectedId: null,
          draftStart: null,
        });
      },
      canUndo: () => get().past.length > 0,
      canRedo: () => get().future.length > 0,
    }),
    {
      name: 'frameplan-project-v2',
      partialize: (s) => ({
        project: s.project,
        scale: s.scale,
        offset: s.offset,
        tab: s.tab,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<EditorState> | undefined;
        if (!p?.project) return current;
        // Migrate older projects missing foundationType
        const settings = {
          ...DEFAULT_SETTINGS,
          ...p.project.settings,
          insulation: {
            ...DEFAULT_SETTINGS.insulation,
            ...p.project.settings?.insulation,
          },
          climate: {
            ...DEFAULT_SETTINGS.climate,
            ...p.project.settings?.climate,
          },
          studSectionMm: {
            ...DEFAULT_SETTINGS.studSectionMm,
            ...p.project.settings?.studSectionMm,
          },
          joistSectionMm: {
            ...DEFAULT_SETTINGS.joistSectionMm,
            ...p.project.settings?.joistSectionMm,
          },
          foundationType: p.project.settings?.foundationType ?? DEFAULT_SETTINGS.foundationType,
        };
        return {
          ...current,
          ...p,
          project: { ...p.project, settings },
          past: [],
          future: [],
        };
      },
    },
  ),
);

export function useFrameModel() {
  const project = useEditorStore((s) => s.project);
  return generateFrameModel(project);
}
