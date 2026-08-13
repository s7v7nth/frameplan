import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS } from '../domain/materials';
import {
  projectPointOnSegment,
  snapPoint,
  uid,
  wallLength,
  wallSegmentCollides,
  resolveTranslateSnap,
  EDIT_GRID_MM,
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

export type FinishWallResult = 'ok' | 'too_short' | 'collision' | 'none';

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
  tab: 'editor' | 'frame' | 'structural' | 'cutting' | 'estimate' | 'thermal';
  setTool: (t: Tool) => void;
  setWallKind: (k: WallKind) => void;
  setTab: (t: EditorState['tab']) => void;
  setActiveFloor: (f: FloorLevel) => void;
  select: (id: string | null) => void;
  setScale: (s: number) => void;
  setOffset: (o: Point) => void;
  /** Snapshot current project before a drag gesture / multi-step edit */
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  fitView: (size: { width: number; height: number }) => void;
  updateSettings: (patch: Partial<ProjectSettings>) => void;
  updateInsulation: (patch: Partial<ProjectSettings['insulation']>) => void;
  updateClimate: (patch: Partial<ProjectSettings['climate']>) => void;
  setProjectName: (name: string) => void;
  beginWall: (p: Point) => void;
  finishWall: (p: Point) => FinishWallResult;
  cancelDraft: () => void;
  addOpeningAt: (world: Point, type: 'window' | 'door') => void;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  deleteSelected: () => void;
  addFurniture: (kind: string) => void;
  moveFurniture: (id: string, x: number, y: number) => void;
  rotateFurniture: (id: string, deltaDeg: number) => void;
  moveWallEndpoint: (id: string, end: 'a' | 'b', point: Point) => void;
  /** Returns false when move rejected (collision). */
  moveWallBy: (id: string, dx: number, dy: number) => boolean;
  /** Preview rigid translate — for live drag feedback. */
  previewMoveWallBy: (
    id: string,
    dx: number,
    dy: number,
  ) => { dx: number; dy: number; ok: boolean; kind: string };
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

function cloneProject(project: Project): Project {
  return structuredClone(project);
}

function pushPast(past: Project[], project: Project): Project[] {
  return [...past, cloneProject(project)].slice(-HISTORY_LIMIT);
}

function contentBounds(project: Project): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  const walls = project.walls.filter((w) => w.floor === project.activeFloor);
  const furniture = project.furniture.filter((f) => f.floor === project.activeFloor);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const w of walls) {
    any = true;
    minX = Math.min(minX, w.a.x, w.b.x);
    minY = Math.min(minY, w.a.y, w.b.y);
    maxX = Math.max(maxX, w.a.x, w.b.x);
    maxY = Math.max(maxY, w.a.y, w.b.y);
  }
  for (const f of furniture) {
    any = true;
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.width);
    maxY = Math.max(maxY, f.y + f.depth);
  }
  if (!any) return null;
  return { minX, minY, maxX, maxY };
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
      setTool: (tool) => {
        const next = tool === 'delete' ? 'select' : tool;
        set({ tool: next, draftStart: null });
      },
      setWallKind: (wallKind) => set({ wallKind }),
      setTab: (tab) => set({ tab }),
      setActiveFloor: (activeFloor) =>
        set((s) => ({
          project: touch({ ...s.project, activeFloor }),
          selectedId: null,
          draftStart: null,
        })),
      select: (selectedId) => set({ selectedId }),
      setScale: (scale) => set({ scale }),
      setOffset: (offset) => set({ offset }),
      checkpoint: () => {
        const { project, past } = get();
        set({ past: pushPast(past, project), future: [] });
      },
      undo: () => {
        const { past, project, future } = get();
        if (past.length === 0) return;
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
        if (future.length === 0) return;
        const next = future[0];
        set({
          past: pushPast(past, project),
          future: future.slice(1),
          project: next,
          selectedId: null,
          draftStart: null,
        });
      },
      fitView: (size) => {
        const { project } = get();
        const bounds = contentBounds(project);
        if (!bounds || size.width < 40 || size.height < 40) {
          set({ scale: 0.08, offset: { x: 80, y: 80 } });
          return;
        }
        const pad = 600;
        const bw = Math.max(1000, bounds.maxX - bounds.minX + pad * 2);
        const bh = Math.max(1000, bounds.maxY - bounds.minY + pad * 2);
        const scale = Math.min(0.4, Math.max(0.02, Math.min(size.width / bw, size.height / bh)));
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        set({
          scale,
          offset: {
            x: size.width / 2 - cx * scale,
            y: size.height / 2 - cy * scale,
          },
        });
      },
      setProjectName: (name) =>
        set((s) => ({ project: touch({ ...s.project, name }) })),
      updateSettings: (patch) => {
        const { project, past } = get();
        set({
          past: pushPast(past, project),
          future: [],
          project: touch({
            ...project,
            settings: { ...project.settings, ...patch },
          }),
        });
      },
      updateInsulation: (patch) => {
        const { project, past } = get();
        set({
          past: pushPast(past, project),
          future: [],
          project: touch({
            ...project,
            settings: {
              ...project.settings,
              insulation: { ...project.settings.insulation, ...patch },
            },
          }),
        });
      },
      updateClimate: (patch) => {
        const { project, past } = get();
        set({
          past: pushPast(past, project),
          future: [],
          project: touch({
            ...project,
            settings: {
              ...project.settings,
              climate: { ...project.settings.climate, ...patch },
            },
          }),
        });
      },
      beginWall: (p) => {
        set({ draftStart: snapPoint(p, EDIT_GRID_MM) });
      },
      cancelDraft: () => set({ draftStart: null }),
      finishWall: (p) => {
        const start = get().draftStart;
        if (!start) return 'none';
        const { project, wallKind, past } = get();
        const walls = project.walls.filter((w) => w.floor === project.activeFloor);
        const selfThickness = wallKind === 'exterior' ? 200 : 120;
        const end = snapPoint(p, EDIT_GRID_MM);
        if (Math.hypot(end.x - start.x, end.y - start.y) < 200) {
          return 'too_short';
        }
        if (wallSegmentCollides(start, end, walls)) {
          return 'collision';
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
        set({
          past: pushPast(past, project),
          future: [],
          draftStart: end,
          selectedId: wall.id,
          project: touch({ ...project, walls: [...project.walls, wall] }),
        });
        return 'ok';
      },
      addOpeningAt: (world, type) => {
        const { project, past } = get();
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
          past: pushPast(past, project),
          future: [],
          selectedId: opening.id,
          project: touch({ ...project, openings: [...project.openings, opening] }),
        });
      },
      // No auto-history: used during drag; SidePanel should checkpoint() before edits
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
        const { selectedId, project, past } = get();
        if (!selectedId) return;
        set({
          past: pushPast(past, project),
          future: [],
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
        const { project, past } = get();
        set({
          past: pushPast(past, project),
          future: [],
          selectedId: item.id,
          project: touch({ ...project, furniture: [...project.furniture, item] }),
        });
      },
      moveFurniture: (id, x, y) =>
        set((s) => {
          const snapped = snapPoint({ x, y }, EDIT_GRID_MM);
          return {
            project: touch({
              ...s.project,
              furniture: s.project.furniture.map((f) =>
                f.id === id ? { ...f, x: snapped.x, y: snapped.y } : f,
              ),
            }),
          };
        }),
      rotateFurniture: (id, deltaDeg) => {
        const { project, past } = get();
        const item = project.furniture.find((f) => f.id === id);
        if (!item) return;
        const rotation = ((item.rotation + deltaDeg) % 360 + 360) % 360;
        set({
          past: pushPast(past, project),
          future: [],
          project: touch({
            ...project,
            furniture: project.furniture.map((f) => (f.id === id ? { ...f, rotation } : f)),
          }),
        });
      },
      moveWallEndpoint: (id, end, point) =>
        set((s) => {
          const wall = s.project.walls.find((w) => w.id === id);
          if (!wall) return s;
          const others = s.project.walls.filter(
            (w) => w.floor === s.project.activeFloor && w.id !== id,
          );
          const fixed = end === 'a' ? wall.b : wall.a;
          const p = snapPoint(point, EDIT_GRID_MM);
          if (wallSegmentCollides(fixed, p, others)) {
            return s;
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
        const fixed = end === 'a' ? wall.b : wall.a;
        const p = snapPoint(point, EDIT_GRID_MM);
        if (wallSegmentCollides(fixed, p, others)) return wall[end];
        return p;
      },
      previewMoveWallBy: (id, dx, dy) => {
        const s = get();
        const wall = s.project.walls.find((w) => w.id === id);
        if (!wall) return { dx, dy, ok: false, kind: 'grid' };
        const others = s.project.walls.filter(
          (w) => w.floor === s.project.activeFloor && w.id !== id,
        );
        const snap = resolveTranslateSnap(wall, dx, dy, others, { scale: s.scale });
        return { dx: snap.dx, dy: snap.dy, ok: snap.ok, kind: snap.kind };
      },
      moveWallBy: (id, dx, dy) => {
        const s = get();
        const wall = s.project.walls.find((w) => w.id === id);
        if (!wall) return false;
        const others = s.project.walls.filter(
          (w) => w.floor === s.project.activeFloor && w.id !== id,
        );
        const snap = resolveTranslateSnap(wall, dx, dy, others, { scale: s.scale });
        if (!snap.ok) return false;
        const nextA = { x: Math.round(wall.a.x + snap.dx), y: Math.round(wall.a.y + snap.dy) };
        const nextB = { x: Math.round(wall.b.x + snap.dx), y: Math.round(wall.b.y + snap.dy) };
        const walls = s.project.walls.map((w) =>
          w.id === id ? { ...w, a: nextA, b: nextB } : w,
        );
        set({
          project: touch({ ...s.project, walls }),
        });
        return true;
      },
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
      resetDemo: () =>
        set({
          project: demoProject(),
          past: [],
          future: [],
          selectedId: null,
          draftStart: null,
        }),
      copyFloorPlan: (from, to) => {
        const { project, past } = get();
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
          past: pushPast(past, project),
          future: [],
          project: touch({
            ...project,
            walls: [...withoutTarget.walls, ...walls],
            openings: [...withoutTarget.openings, ...openings],
            activeFloor: to,
          }),
          selectedId: null,
        });
      },
      loadProject: (project) =>
        set({ project, past: [], future: [], selectedId: null, draftStart: null }),
      exportJson: () => JSON.stringify(get().project, null, 2),
    }),
    {
      name: 'frameplan-project-v2',
      partialize: (s) => ({
        project: s.project,
        tool: s.tool === 'delete' ? 'select' : s.tool,
        wallKind: s.wallKind,
        scale: s.scale,
        offset: s.offset,
        tab: s.tab,
      }),
    },
  ),
);

export function useFrameModel() {
  const project = useEditorStore((s) => s.project);
  return generateFrameModel(project);
}
