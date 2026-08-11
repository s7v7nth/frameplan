import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Stage, Layer, Line, Rect, Text, Circle, Group } from 'react-konva';
import {
  wallAngle,
  wallLength,
  pointAlongWall,
  snapPoint,
  projectPointOnSegment,
} from '../domain/geometry';
import { useEditorStore } from '../store/editorStore';

export function PlanCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wallDragRef = useRef({ id: '', x: 0, y: 0 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [spacePan, setSpacePan] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const {
    project,
    tool,
    selectedId,
    draftStart,
    scale,
    offset,
    select,
    beginWall,
    finishWall,
    addOpeningAt,
    deleteSelected,
    moveFurniture,
    moveWallEndpoint,
    moveWallBy,
    moveOpening,
    updateOpening,
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
  }, [deleteSelected]);

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

  const handleStagePointer = (e: KonvaEventObject<MouseEvent>) => {
    if (spacePan) return;
    const stage = e.target.getStage();
    if (!stage) return;
    // Only empty-stage clicks start wall / clear selection
    if (e.target !== stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const world = toWorld(pos.x, pos.y);

    if (tool === 'wall') {
      if (!draftStart) beginWall(world);
      else finishWall(world);
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
    if (tool === 'select') select(null);
  };

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <Stage
        width={size.width}
        height={size.height}
        onMouseDown={handleStagePointer}
        onMouseMove={(e) => {
          const stage = e.target.getStage();
          const pos = stage?.getPointerPosition();
          if (pos) setHover(toWorld(pos.x, pos.y));
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
        draggable={spacePan}
        onDragEnd={(e) => {
          if (e.target.getClassName() === 'Stage') {
            setOffset({
              x: offset.x + e.target.x(),
              y: offset.y + e.target.y(),
            });
            e.target.position({ x: 0, y: 0 });
          }
        }}
        style={{
          cursor: spacePan
            ? 'grab'
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
            return (
              <Group key={wall.id}>
                <Line
                  points={[wall.a.x, wall.a.y, wall.b.x, wall.b.y]}
                  stroke={selected ? '#c45c26' : wall.kind === 'exterior' ? '#1f3a2e' : '#64748b'}
                  strokeWidth={selected ? 220 : wall.thickness}
                  lineCap="square"
                  hitStrokeWidth={300}
                  draggable={tool === 'select' && !spacePan}
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
                      else finishWall(world);
                      return;
                    }
                    select(wall.id);
                    if (tool === 'delete') deleteSelected();
                  }}
                />
                <Line
                  points={[wall.a.x, wall.a.y, wall.b.x, wall.b.y]}
                  stroke="#f4f7f2"
                  strokeWidth={Math.max(40, wall.thickness - 80)}
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
                {selected && tool === 'select' &&
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
                        draggable={!spacePan}
                        onMouseDown={(e) => {
                          e.cancelBubble = true;
                        }}
                        onDragMove={(e) => {
                          e.cancelBubble = true;
                          const np = snapPoint({ x: e.target.x(), y: e.target.y() });
                          e.target.position(np);
                          moveWallEndpoint(wall.id, end, np);
                        }}
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
                        draggable={!spacePan}
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
                            draggable={!spacePan}
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
              draggable={tool === 'select' && !spacePan}
              onDragEnd={(e) => moveFurniture(f.id, e.target.x(), e.target.y())}
              onMouseDown={(e) => {
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
        </Layer>
      </Stage>
      <div className="canvas-hint">
        Стена/окно/дверь — клик · Выбор: тянуть стену и оранжевые ручки · Проём: синяя = сдвиг,
        зелёные = ширина · Space — панорама · Delete — удалить
      </div>
    </div>
  );
}
