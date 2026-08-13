import { Line, Text, Rect, Group } from 'react-konva';
import {
  wallPolygonPoints,
  wallCenterlinePoints,
  wallLengthLabelPose,
  type MagnetHit,
} from '../../../domain/geometry';
import type { Opening, Point, Tool, Wall } from '../../../domain/types';
import { useEditorStore } from '../../../store/editorStore';
import type { MagnetFeedback } from '../interaction/types';
import { useRef } from 'react';

type Props = {
  walls: Wall[];
  openings: Opening[];
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
  openings,
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
            {(() => {
              const label = wallLengthLabelPose(wall, openings);
              const tw = 620;
              const th = 200;
              return (
                <Group
                  x={label.x}
                  y={label.y}
                  rotation={label.rotationDeg}
                  listening={false}
                >
                  <Rect
                    x={-tw / 2}
                    y={-th / 2}
                    width={tw}
                    height={th}
                    fill="rgba(255, 252, 248, 0.94)"
                    stroke="#c9d6cb"
                    strokeWidth={8}
                    cornerRadius={40}
                  />
                  <Text
                    x={-tw / 2}
                    y={-th / 2 + 28}
                    width={tw}
                    height={th}
                    align="center"
                    text={label.text}
                    fontSize={130}
                    fill="#14231c"
                    fontStyle="600"
                  />
                </Group>
              );
            })()}
            {selected &&
              tool === 'select' &&
              (['a', 'b'] as const).map((end) => {
                const tip = wall[end];
                const fixed = end === 'a' ? wall.b : wall.a;
                const span = Math.hypot(fixed.x - tip.x, fixed.y - tip.y) || 1;
                const inset = Math.min(220, span * 0.18);
                const ux = (fixed.x - tip.x) / span;
                const uy = (fixed.y - tip.y) / span;
                const hx = tip.x + ux * inset;
                const hy = tip.y + uy * inset;
                const grip = 70;
                return (
                  <Group
                    key={end}
                    x={hx}
                    y={hy}
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
                      const handle = { x: e.target.x(), y: e.target.y() };
                      const rawTip = {
                        x: handle.x - ux * inset,
                        y: handle.y - uy * inset,
                      };
                      const prev = endpointSnapPrev.current;
                      const hit = previewEndpointSnap(wall.id, end, rawTip, { prev });
                      endpointSnapPrev.current = hit;
                      const nextFixed = end === 'a' ? wall.b : wall.a;
                      const nspan =
                        Math.hypot(nextFixed.x - hit.point.x, nextFixed.y - hit.point.y) || 1;
                      const nx = (nextFixed.x - hit.point.x) / nspan;
                      const ny = (nextFixed.y - hit.point.y) / nspan;
                      e.target.position({
                        x: hit.point.x + nx * inset,
                        y: hit.point.y + ny * inset,
                      });
                      setMagnetAt({ x: hit.point.x, y: hit.point.y, kind: hit.kind });
                      moveWallEndpoint(wall.id, end, rawTip, { prev });
                    }}
                    onDragEnd={() => {
                      commitWallEndpoint(wall.id, end);
                      endpointSnapPrev.current = null;
                      setMagnetAt(null);
                    }}
                  >
                    <Rect
                      x={-grip}
                      y={-grip}
                      width={grip * 2}
                      height={grip * 2}
                      fill="rgba(196,92,38,0.12)"
                      stroke="#fff"
                      strokeWidth={16}
                      cornerRadius={16}
                    />
                    <Rect
                      x={-grip}
                      y={-grip}
                      width={grip * 2}
                      height={grip * 2}
                      fillEnabled={false}
                      stroke="#c45c26"
                      strokeWidth={12}
                      cornerRadius={16}
                    />
                  </Group>
                );
              })}
          </Group>
        );
      })}
    </>
  );
}
