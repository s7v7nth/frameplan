import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Stage, Layer, Line, Rect, Text, Circle, Group } from 'react-konva';
import { wallAngle, wallLength, pointAlongWall } from '../domain/geometry';
import { useEditorStore } from '../store/editorStore';

export function PlanCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if (e.key === 'Escape') useEditorStore.getState().cancelDraft();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  const onPointer = (e: KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
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
    if (tool === 'select') {
      if (e.target === stage) select(null);
    }
  };

  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <Stage
        width={size.width}
        height={size.height}
        onClick={onPointer}
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
        draggable={tool === 'select'}
        onDragEnd={(e) => {
          if (e.target.getClassName() === 'Stage') {
            setOffset({ x: e.target.x(), y: e.target.y() });
            e.target.position({ x: 0, y: 0 });
          }
        }}
        style={{ cursor: tool === 'wall' ? 'crosshair' : 'default' }}
      >
        <Layer x={offset.x} y={offset.y} scaleX={scale} scaleY={scale}>
          {/* grid */}
          {Array.from({ length: 40 }, (_, i) => {
            const v = (i - 5) * 1000;
            return (
              <Group key={`g${i}`}>
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
                  strokeWidth={(selected ? 220 : wall.thickness) }
                  lineCap="square"
                  onClick={(e) => {
                    e.cancelBubble = true;
                    if (tool === 'select' || tool === 'delete') {
                      select(wall.id);
                      if (tool === 'delete') deleteSelected();
                    }
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
                  y={(wall.a.y + wall.b.y) / 2 - 180 / scale}
                  text={`${(wallLength(wall) / 1000).toFixed(2)} м`}
                  fontSize={140}
                  fill="#334155"
                  listening={false}
                />
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
              return (
                <Group
                  key={o.id}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    select(o.id);
                  }}
                >
                  <Line
                    points={[p1.x, p1.y, p2.x, p2.y]}
                    stroke={selected ? '#c45c26' : o.type === 'window' ? '#2563eb' : '#b45309'}
                    strokeWidth={wall.thickness + 40}
                    lineCap="butt"
                  />
                  {o.type === 'window' && (
                    <Line
                      points={[p1.x + nx, p1.y + ny, p2.x + nx, p2.y + ny]}
                      stroke="#93c5fd"
                      strokeWidth={30}
                    />
                  )}
                  <Text
                    x={(p1.x + p2.x) / 2 - 200}
                    y={(p1.y + p2.y) / 2 - 250}
                    text={o.type === 'window' ? 'О' : 'Д'}
                    fontSize={160}
                    fill="#0f172a"
                  />
                </Group>
              );
            })}

          {furniture.map((f) => (
            <Group
              key={f.id}
              x={f.x}
              y={f.y}
              draggable={tool === 'select'}
              onDragEnd={(e) => moveFurniture(f.id, e.target.x(), e.target.y())}
              onClick={(e) => {
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

          {draftStart && hover && (
            <Line
              points={[draftStart.x, draftStart.y, hover.x, hover.y]}
              stroke="#c45c26"
              strokeWidth={120}
              dash={[200, 120]}
            />
          )}
          {draftStart && <Circle x={draftStart.x} y={draftStart.y} radius={80} fill="#c45c26" />}
        </Layer>
      </Stage>
      <div className="canvas-hint">
        Сетка 1 м · колёсико — масштаб · перетаскивание сцены в режиме «Выбор» · Delete — удалить
      </div>
    </div>
  );
}
