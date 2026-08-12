import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Stage, Layer, Line, Rect, Text, Circle, Group } from 'react-konva';
import {
  wallAngle,
  wallLength,
  pointAlongWall,
  projectPointOnSegment,
  resolveDraftSnap,
  WALL_MAGNET_MM,
  GRID_MM,
  wallPolygonPoints,
  wallCenterlinePoints,
} from '../domain/geometry';
import { useEditorStore } from '../store/editorStore';
import type { Tool } from '../domain/types';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Выбор', hint: 'ЛКМ по пустому — панорама' },
  { id: 'wall', label: 'Стена', hint: 'Два клика · сетка 100 мм · магнит к стенам' },
  { id: 'window', label: 'Окно', hint: 'Клик по стене' },
  { id: 'door', label: 'Дверь', hint: 'Клик по стене' },
  { id: 'delete', label: 'Удалить', hint: 'Клик по объекту' },
];

export function PlanCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wallDragRef = useRef({ id: '', x: 0, y: 0 });
  const panRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [spacePan, setSpacePan] = useState(false);
  const [panning, setPanning] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [magnetAt, setMagnetAt] = useState<{
    x: number;
    y: number;
    kind: 'endpoint' | 'segment' | 'grid';
  } | null>(null);

  const {
    project,
    tool,
    selectedId,
    draftStart,
    scale,
    offset,
    select,
    setTool,
    beginWall,
    finishWall,
    addOpeningAt,
    deleteSelected,
    moveFurniture,
    moveWallEndpoint,
    moveWallBy,
    moveOpening,
    updateOpening,
    previewEndpointSnap,
    setOffset,
    setScale,
  } = useEditorStore();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePan(true);
      }
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'w' || e.key === 'W') setTool('wall');
      if (e.key === 'o' || e.key === 'O') setTool('window');
      if (e.key === 'd' || e.key === 'D') setTool('door');
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        deleteSelected();
      }
      if (e.key === 'Escape') useEditorStore.getState().cancelDraft();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePan(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [deleteSelected, setTool]);

  const toWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - offset.x) / scale,
      y: (sy - offset.y) / scale,
    }),
    [offset, scale],
  );

  const walls = useMemo(
    () => project.walls.filter((w) => w.floor === project.activeFloor),
    [project.walls, project.activeFloor],
  );
  const furniture = useMemo(
    () => project.furniture.filter((f) => f.floor === project.activeFloor),
    [project.furniture, project.activeFloor],
  );

  const startPan = (clientX: number, clientY: number) => {
    panRef.current = {
      active: true,
      startX: clientX,
      startY: clientY,
      origX: offset.x,
      origY: offset.y,
    };
    setPanning(true);
  };

  const onStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const evt = e.evt;
    // RMB / MMB — always pan, never browser menu
    if (evt.button === 1 || evt.button === 2 || spacePan) {
      evt.preventDefault();
      startPan(evt.clientX, evt.clientY);
      return;
    }
    if (evt.button !== 0) return;

    const stage = e.target.getStage();
    if (!stage) return;
    const isEmpty = e.target === stage;

    // Select tool + empty canvas → pan (natural planner navigation)
    if (tool === 'select' && isEmpty) {
      startPan(evt.clientX, evt.clientY);
      select(null);
      return;
    }

    if (!isEmpty) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;
    const world = toWorld(pos.x, pos.y);

    if (tool === 'wall') {
      if (!draftStart) beginWall(world);
      else finishWall(resolveDraftSnap(world, walls, { from: draftStart }).point);
      return;
    }
    if (tool === 'window') {
      addOpeningAt(world, 'window');
      return;
    }
    if (tool === 'door') {
      addOpeningAt(world, 'door');
      return;
    }
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const pan = panRef.current;
      if (!pan?.active) return;
      setOffset({
        x: pan.origX + (e.clientX - pan.startX),
        y: pan.origY + (e.clientY - pan.startY),
      });
    };
    const onUp = () => {
      if (panRef.current?.active) {
        panRef.current = null;
        setPanning(false);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setOffset]);

  const activeHint = TOOLS.find((t) => t.id === tool)?.hint ?? '';

  return (
    <div
      className="canvas-wrap"
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="canvas-toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tool === t.id ? 'canvas-tool active' : 'canvas-tool'}
            onClick={() => setTool(t.id)}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
        <span className="canvas-tool-hint">{activeHint}</span>
      </div>

      <Stage
        width={size.width}
        height={size.height}
        onMouseDown={onStageMouseDown}
        onMouseMove={(e) => {
          const stage = e.target.getStage();
          const pos = stage?.getPointerPosition();
          if (!pos) return;
          const world = toWorld(pos.x, pos.y);
          if (tool === 'wall') {
            const hit = resolveDraftSnap(world, walls, {
              from: draftStart ?? undefined,
            });
            setHover(hit.point);
            setMagnetAt({ x: hit.point.x, y: hit.point.y, kind: hit.kind });
          } else {
            setHover(world);
            setMagnetAt(null);
          }
        }}
        onWheel={(e) => {
          e.evt.preventDefault();
          const stage = e.target.getStage();
          const pointer = stage?.getPointerPosition();
          if (!pointer) return;
          const direction = e.evt.deltaY > 0 ? 0.9 : 1.1;
          const newScale = Math.min(0.4, Math.max(0.02, scale * direction));
          const world = toWorld(pointer.x, pointer.y);
          setScale(newScale);
          setOffset({
            x: pointer.x - world.x * newScale,
            y: pointer.y - world.y * newScale,
          });
        }}
        style={{
          cursor: panning || spacePan
            ? 'grabbing'
            : tool === 'wall' || tool === 'window' || tool === 'door'
              ? 'crosshair'
              : 'default',
        }}
      >
        <Layer x={offset.x} y={offset.y} scaleX={scale} scaleY={scale}>
          {Array.from({ length: 40 }, (_, i) => {
            const v = (i - 5) * 1000;
            return (
              <Group key={`g${i}`} listening={false}>
                <Line points={[-5000, v, 20000, v]} stroke="#d7e0d8" strokeWidth={1 / scale} />
                <Line points={[v, -5000, v, 20000]} stroke="#d7e0d8" strokeWidth={1 / scale} />
              </Group>
            );
          })}

          {walls.map((wall) => {
            const selected = selectedId === wall.id;
            const poly = wallPolygonPoints(wall, walls);
            const fill = selected
              ? '#c45c26'
              : wall.kind === 'exterior'
                ? '#1f3a2e'
                : '#64748b';
            const stroke = selected ? '#9a3412' : wall.kind === 'exterior' ? '#14231c' : '#475569';
            const center = wallCenterlinePoints(wall, walls);
            return (
              <Group key={wall.id}>
                <Line
                  points={poly}
                  closed
                  fill={fill}
                  stroke={stroke}
                  // Thin outline only — thick stroke re-creates corner overlap on miters
                  strokeWidth={selected ? 10 : 3}
                  lineJoin="miter"
                  miterLimit={2}
                  perfectDrawEnabled={false}
                  draggable={tool === 'select' && !spacePan && !panning}
                  onDragStart={(e) => {
                    wallDragRef.current = { id: wall.id, x: e.target.x(), y: e.target.y() };
                    select(wall.id);
                  }}
                  onDragEnd={(e) => {
                    const dx = e.target.x() - wallDragRef.current.x;
                    const dy = e.target.y() - wallDragRef.current.y;
                    e.target.position({ x: 0, y: 0 });
                    if (Math.hypot(dx, dy) > 1) moveWallBy(wall.id, dx, dy);
                  }}
                  onMouseDown={(e) => {
                    if (e.evt.button === 1 || e.evt.button === 2 || spacePan) return;
                    e.cancelBubble = true;
                    if (tool === 'window' || tool === 'door') {
                      const stage = e.target.getStage();
                      const pos = stage?.getPointerPosition();
                      if (pos) addOpeningAt(toWorld(pos.x, pos.y), tool);
                      return;
                    }
                    if (tool === 'wall') {
                      const stage = e.target.getStage();
                      const pos = stage?.getPointerPosition();
                      if (!pos) return;
                      const world = toWorld(pos.x, pos.y);
                      if (!draftStart) beginWall(world);
                      else finishWall(resolveDraftSnap(world, walls, { from: draftStart }).point);
                      return;
                    }
                    select(wall.id);
                    if (tool === 'delete') deleteSelected();
                  }}
                />
                {/* Inset centerline — never crosses into the miter square */}
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
                        onDragMove={(e) => {
                          e.cancelBubble = true;
                          const raw = { x: e.target.x(), y: e.target.y() };
                          const snapped = previewEndpointSnap(wall.id, end, raw);
                          const magnetized =
                            Math.hypot(snapped.x - raw.x, snapped.y - raw.y) > 0.5;
                          e.target.position(snapped);
                          setMagnetAt(
                            magnetized
                              ? { x: snapped.x, y: snapped.y, kind: 'endpoint' }
                              : { x: snapped.x, y: snapped.y, kind: 'grid' },
                          );
                          moveWallEndpoint(wall.id, end, raw);
                        }}
                        onDragEnd={() => setMagnetAt(null)}
                      />
                    );
                  })}
              </Group>
            );
          })}

          {project.openings
            .filter((o) => walls.some((w) => w.id === o.wallId))
            .map((o) => {
              const wall = walls.find((w) => w.id === o.wallId)!;
              const p1 = pointAlongWall(wall, o.offset);
              const p2 = pointAlongWall(wall, o.offset + o.width);
              const ang = wallAngle(wall);
              const nx = Math.cos(ang + Math.PI / 2) * (wall.thickness / 2 + 40);
              const ny = Math.sin(ang + Math.PI / 2) * (wall.thickness / 2 + 40);
              const selected = selectedId === o.id;
              const mid = pointAlongWall(wall, o.offset + o.width / 2);
              return (
                <Group
                  key={o.id}
                  onMouseDown={(e) => {
                    if (e.evt.button !== 0) return;
                    e.cancelBubble = true;
                    select(o.id);
                    if (tool === 'delete') deleteSelected();
                  }}
                >
                  <Line
                    points={[p1.x, p1.y, p2.x, p2.y]}
                    stroke={selected ? '#c45c26' : o.type === 'window' ? '#2563eb' : '#b45309'}
                    strokeWidth={wall.thickness + 40}
                    lineCap="butt"
                    hitStrokeWidth={350}
                  />
                  {o.type === 'window' && (
                    <Line
                      points={[p1.x + nx, p1.y + ny, p2.x + nx, p2.y + ny]}
                      stroke="#93c5fd"
                      strokeWidth={30}
                      listening={false}
                    />
                  )}
                  <Text
                    x={mid.x - 80}
                    y={mid.y - 200}
                    text={o.type === 'window' ? 'О' : 'Д'}
                    fontSize={160}
                    fill="#0f172a"
                    listening={false}
                  />
                  {selected && tool === 'select' && (
                    <>
                      <Circle
                        x={mid.x}
                        y={mid.y}
                        radius={100}
                        fill="#2563eb"
                        stroke="#fff"
                        strokeWidth={16}
                        draggable={!spacePan && !panning}
                        onMouseDown={(e) => {
                          e.cancelBubble = true;
                        }}
                        onDragMove={(e) => {
                          e.cancelBubble = true;
                          const hit = projectPointOnSegment(
                            { x: e.target.x(), y: e.target.y() },
                            wall.a,
                            wall.b,
                          );
                          const nextOffset = hit.t * wallLength(wall) - o.width / 2;
                          moveOpening(o.id, nextOffset);
                          const m = pointAlongWall(
                            wall,
                            Math.max(0, Math.min(wallLength(wall) - o.width, nextOffset)) +
                              o.width / 2,
                          );
                          e.target.position(m);
                        }}
                      />
                      {([0, 1] as const).map((side) => {
                        const pt = side === 0 ? p1 : p2;
                        return (
                          <Circle
                            key={side}
                            x={pt.x}
                            y={pt.y}
                            radius={90}
                            fill="#0f766e"
                            stroke="#fff"
                            strokeWidth={14}
                            draggable={!spacePan && !panning}
                            onMouseDown={(e) => {
                              e.cancelBubble = true;
                            }}
                            onDragMove={(e) => {
                              e.cancelBubble = true;
                              const hit = projectPointOnSegment(
                                { x: e.target.x(), y: e.target.y() },
                                wall.a,
                                wall.b,
                              );
                              const along = hit.t * wallLength(wall);
                              if (side === 0) {
                                const right = o.offset + o.width;
                                const newOffset = Math.min(along, right - 400);
                                updateOpening(o.id, {
                                  offset: Math.round(newOffset),
                                  width: Math.round(right - newOffset),
                                });
                              } else {
                                updateOpening(o.id, {
                                  width: Math.round(Math.max(400, along - o.offset)),
                                });
                              }
                            }}
                          />
                        );
                      })}
                    </>
                  )}
                </Group>
              );
            })}

          {furniture.map((f) => (
            <Group
              key={f.id}
              x={f.x}
              y={f.y}
              draggable={tool === 'select' && !spacePan && !panning}
              onDragEnd={(e) => moveFurniture(f.id, e.target.x(), e.target.y())}
              onMouseDown={(e) => {
                if (e.evt.button !== 0) return;
                e.cancelBubble = true;
                select(f.id);
              }}
            >
              <Rect
                width={f.width}
                height={f.depth}
                fill={selectedId === f.id ? 'rgba(196,92,38,0.25)' : 'rgba(47,93,80,0.15)'}
                stroke={selectedId === f.id ? '#c45c26' : '#2f5d50'}
                strokeWidth={40}
                cornerRadius={40}
              />
              <Text x={80} y={f.depth / 2 - 60} text={f.label} fontSize={140} fill="#1f3a2e" />
            </Group>
          ))}

          {magnetAt && tool === 'wall' && (
            <Group listening={false}>
              {magnetAt.kind === 'grid' ? (
                <>
                  <Line
                    points={[magnetAt.x - 120, magnetAt.y, magnetAt.x + 120, magnetAt.y]}
                    stroke="#2563eb"
                    strokeWidth={24}
                  />
                  <Line
                    points={[magnetAt.x, magnetAt.y - 120, magnetAt.x, magnetAt.y + 120]}
                    stroke="#2563eb"
                    strokeWidth={24}
                  />
                  <Circle x={magnetAt.x} y={magnetAt.y} radius={50} fill="#2563eb" opacity={0.85} />
                </>
              ) : (
                <>
                  <Circle
                    x={magnetAt.x}
                    y={magnetAt.y}
                    radius={WALL_MAGNET_MM}
                    stroke="#c45c26"
                    strokeWidth={20}
                    dash={[80, 60]}
                    opacity={0.45}
                  />
                  <Circle x={magnetAt.x} y={magnetAt.y} radius={70} fill="#c45c26" opacity={0.9} />
                </>
              )}
            </Group>
          )}

          {draftStart && hover && tool === 'wall' && (
            <Line
              points={[draftStart.x, draftStart.y, hover.x, hover.y]}
              stroke="#c45c26"
              strokeWidth={120}
              dash={[200, 120]}
              listening={false}
            />
          )}
          {draftStart && tool === 'wall' && (
            <Circle x={draftStart.x} y={draftStart.y} radius={80} fill="#c45c26" listening={false} />
          )}
          {draftStart && hover && tool === 'wall' && (
            <Text
              x={(draftStart.x + hover.x) / 2}
              y={(draftStart.y + hover.y) / 2 - 160}
              text={`${(Math.hypot(hover.x - draftStart.x, hover.y - draftStart.y) / 1000).toFixed(2)} м`}
              fontSize={130}
              fill="#c45c26"
              listening={false}
            />
          )}
        </Layer>
      </Stage>

      <div className="canvas-hint">
        Сетка {GRID_MM} мм (синий крест) · магнит к торцу/грани стены (оранжевый) · без X-пересечений ·
        V/W/O/D — инструменты
      </div>
    </div>
  );
}
