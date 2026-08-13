import { Line, Text, Circle, Group } from 'react-konva';
import {
  wallLength,
  wallPolygonPoints,
  wallCenterlinePoints,
  type MagnetHit,
} from '../../../domain/geometry';
import type { Point, Tool, Wall } from '../../../domain/types';
import { useEditorStore } from '../../../store/editorStore';
import type { MagnetFeedback } from '../interaction/types';
import { useRef } from 'react';

type Props = {
  walls: Wall[];
  tool: Tool;
  selectedId: string | null;
  spacePan: boolean;
  panning: boolean;
  dragInvalid: boolean;
  dragRejectFlash: boolean;
  toWorld: (sx: number, sy: number) => Point;
  wallDragRef: React.MutableRefObject<{
    id: string;
    x: number;
    y: number;
    lastDx: number;
    lastDy: number;
    invalid: boolean;
  }>;
  setDragInvalid: (v: boolean) => void;
  setDragRejectFlash: (v: boolean) => void;
  setMagnetAt: (m: MagnetFeedback | null) => void;
  showToast: (msg: string) => void;
  onWallPlace: (world: Point) => void;
};

export function WallsLayer({
  walls,
  tool,
  selectedId,
  spacePan,
  panning,
  dragInvalid,
  dragRejectFlash,
  toWorld,
  wallDragRef,
  setDragInvalid,
  setDragRejectFlash,
  setMagnetAt,
  showToast,
  onWallPlace,
}: Props) {
  const select = useEditorStore((s) => s.select);
  const addOpeningAt = useEditorStore((s) => s.addOpeningAt);
  const previewMoveWallBy = useEditorStore((s) => s.previewMoveWallBy);
  const moveWallBy = useEditorStore((s) => s.moveWallBy);
  const moveWallEndpoint = useEditorStore((s) => s.moveWallEndpoint);
  const previewEndpointSnap = useEditorStore((s) => s.previewEndpointSnap);
  const checkpoint = useEditorStore((s) => s.checkpoint);
  const commitWallEndpoint = useEditorStore((s) => s.commitWallEndpoint);
  const endpointSnapPrev = useRef<MagnetHit | null>(null);

  const placeFromEvent = (e: { target: { getStage: () => { getPointerPosition: () => { x: number; y: number } | null } | null } }) => {
    const stage = e.target.getStage();
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const world = toWorld(pos.x, pos.y);
    if (tool === 'window' || tool === 'door') {
      addOpeningAt(world, tool);
      return;
    }
    if (tool === 'wall') onWallPlace(world);
  };

  return (
    <>
      {walls.map((wall) => {
        const selected = selectedId === wall.id;
        const poly = wallPolygonPoints(wall, walls);
        const fill =
          selected && (dragInvalid || dragRejectFlash)
            ? '#dc2626'
            : selected
              ? '#c45c26'
              : wall.kind === 'exterior'
                ? '#1f3a2e'
                : '#64748b';
        const stroke =
          selected && (dragInvalid || dragRejectFlash)
            ? '#991b1b'
            : selected
              ? '#9a3412'
              : wall.kind === 'exterior'
                ? '#14231c'
                : '#475569';
        const center = wallCenterlinePoints(wall, walls);
        return (
          <Group key={wall.id}>
            <Line
              points={poly}
              closed
              fill={fill}
              stroke={stroke}
              strokeWidth={selected ? 10 : 3}
              lineJoin="miter"
              miterLimit={2}
              perfectDrawEnabled={false}
              opacity={selected && dragInvalid ? 0.7 : 1}
              draggable={tool === 'select' && !spacePan && !panning}
              onDragStart={(e) => {
                checkpoint();
                wallDragRef.current = {
                  id: wall.id,
                  x: e.target.x(),
                  y: e.target.y(),
                  lastDx: 0,
                  lastDy: 0,
                  invalid: false,
                };
                setDragInvalid(false);
                setDragRejectFlash(false);
                select(wall.id);
              }}
              onDragMove={(e) => {
                const rawDx = e.target.x() - wallDragRef.current.x;
                const rawDy = e.target.y() - wallDragRef.current.y;
                const preview = previewMoveWallBy(wall.id, rawDx, rawDy);
                if (preview.ok) {
                  wallDragRef.current.lastDx = preview.dx;
                  wallDragRef.current.lastDy = preview.dy;
                  wallDragRef.current.invalid = false;
                  setDragInvalid(false);
                  e.target.position({
                    x: wallDragRef.current.x + preview.dx,
                    y: wallDragRef.current.y + preview.dy,
                  });
                  if (preview.kind !== 'grid') {
                    setMagnetAt({
                      x: wall.a.x + preview.dx,
                      y: wall.a.y + preview.dy,
                      kind: preview.kind as MagnetHit['kind'],
                    });
                  } else {
                    setMagnetAt(null);
                  }
                } else {
                  wallDragRef.current.invalid = true;
                  setDragInvalid(true);
                  e.target.position({
                    x: wallDragRef.current.x + wallDragRef.current.lastDx,
                    y: wallDragRef.current.y + wallDragRef.current.lastDy,
                  });
                  setMagnetAt(null);
                }
              }}
              onDragEnd={(e) => {
                const dx = wallDragRef.current.lastDx;
                const dy = wallDragRef.current.lastDy;
                const attemptedInvalid = wallDragRef.current.invalid;
                e.target.position({ x: 0, y: 0 });
                setMagnetAt(null);
                setDragInvalid(false);
                if (Math.hypot(dx, dy) <= 1) {
                  if (attemptedInvalid) {
                    setDragRejectFlash(true);
                    showToast('Нельзя сюда');
                    window.setTimeout(() => setDragRejectFlash(false), 450);
                  }
                  return;
                }
                const ok = moveWallBy(wall.id, dx, dy);
                if (!ok || attemptedInvalid) {
                  setDragRejectFlash(true);
                  showToast('Нельзя сюда');
                  window.setTimeout(() => setDragRejectFlash(false), 450);
                }
              }}
              onMouseDown={(e) => {
                if (e.evt.button === 1 || e.evt.button === 2 || spacePan) return;
                e.cancelBubble = true;
                if (tool === 'window' || tool === 'door' || tool === 'wall') {
                  placeFromEvent(e);
                  return;
                }
                select(wall.id);
              }}
            />
            <Line
              points={center}
              stroke="rgba(244,247,242,0.35)"
              strokeWidth={10}
              lineCap="butt"
              listening={false}
            />
            <Text
              x={(wall.a.x + wall.b.x) / 2}
              y={(wall.a.y + wall.b.y) / 2 - 180}
              text={`${(wallLength(wall) / 1000).toFixed(2)} м`}
              fontSize={140}
              fill="#334155"
              listening={false}
            />
            {selected &&
              tool === 'select' &&
              (['a', 'b'] as const).map((end) => {
                const p = wall[end];
                return (
                  <Circle
                    key={end}
                    x={p.x}
                    y={p.y}
                    radius={120}
                    fill="#c45c26"
                    stroke="#fff"
                    strokeWidth={20}
                    draggable={!spacePan && !panning}
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                    }}
                    onDragStart={() => {
                      checkpoint();
                      endpointSnapPrev.current = null;
                    }}
                    onDragMove={(e) => {
                      e.cancelBubble = true;
                      const raw = { x: e.target.x(), y: e.target.y() };
                      const prev = endpointSnapPrev.current;
                      const hit = previewEndpointSnap(wall.id, end, raw, { prev });
                      endpointSnapPrev.current = hit;
                      e.target.position(hit.point);
                      setMagnetAt({ x: hit.point.x, y: hit.point.y, kind: hit.kind });
                      moveWallEndpoint(wall.id, end, raw, { prev });
                    }}
                    onDragEnd={() => {
                      commitWallEndpoint(wall.id, end);
                      endpointSnapPrev.current = null;
                      setMagnetAt(null);
                    }}
                  />
                );
              })}
          </Group>
        );
      })}
    </>
  );
}
