import { Line, Text, Circle, Group } from 'react-konva';
import {
  wallAngle,
  wallLength,
  pointAlongWall,
  projectPointOnSegment,
} from '../../../domain/geometry';
import type { Opening, Tool, Wall } from '../../../domain/types';
import { useEditorStore } from '../../../store/editorStore';

type Props = {
  openings: Opening[];
  walls: Wall[];
  tool: Tool;
  selectedId: string | null;
  spacePan: boolean;
  panning: boolean;
};

export function OpeningsLayer({
  openings,
  walls,
  tool,
  selectedId,
  spacePan,
  panning,
}: Props) {
  const select = useEditorStore((s) => s.select);
  const moveOpening = useEditorStore((s) => s.moveOpening);
  const updateOpening = useEditorStore((s) => s.updateOpening);
  const checkpoint = useEditorStore((s) => s.checkpoint);

  return (
    <>
      {openings.map((o) => {
        const wall = walls.find((w) => w.id === o.wallId);
        if (!wall) return null;
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
              x={mid.x + nx * 0.4 - 50}
              y={mid.y + ny * 0.4 - 55}
              text={o.type === 'window' ? 'О' : 'Д'}
              fontSize={110}
              fill="#fff7ed"
              stroke="#0f172a"
              strokeWidth={8}
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
                  onDragStart={() => checkpoint()}
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
                      onDragStart={() => checkpoint()}
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
    </>
  );
}
