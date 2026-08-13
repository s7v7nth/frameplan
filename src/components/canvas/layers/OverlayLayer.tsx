import { Line, Circle, Text, Rect, Group } from 'react-konva';
import { detectWallJoints, isAxisAlignedSegment } from '../../../domain/geometry';
import type { Point, Tool, Wall } from '../../../domain/types';
import type { MeasureDraft } from '../interaction/types';

type Props = {
  allWalls: Wall[];
  activeFloor: 0 | 1;
  tool: Tool;
  draftStart: Point | null;
  hover: Point | null;
  measure: MeasureDraft;
};

export function OverlayLayer({
  allWalls,
  activeFloor,
  tool,
  draftStart,
  hover,
  measure,
}: Props) {
  const joints = detectWallJoints(allWalls, activeFloor);
  const draftAxis =
    draftStart && hover && tool === 'wall' && isAxisAlignedSegment(draftStart, hover);

  const measureA = measure.a;
  const measureB = measure.b ?? hover;
  const measureLen =
    measureA && measureB
      ? Math.hypot(measureB.x - measureA.x, measureB.y - measureA.y)
      : null;

  return (
    <Group listening={false}>
      {joints.map((j) => (
        <Group key={j.id}>
          <Rect
            x={j.point.x - 90}
            y={j.point.y - 90}
            width={180}
            height={180}
            fill={j.kind === 'L' ? 'rgba(245, 158, 11, 0.35)' : 'rgba(14, 165, 233, 0.35)'}
            stroke={j.kind === 'L' ? '#d97706' : '#0284c7'}
            strokeWidth={16}
            cornerRadius={20}
          />
        </Group>
      ))}

      {draftStart && hover && tool === 'wall' && (
        <>
          <Line
            points={[draftStart.x, draftStart.y, hover.x, hover.y]}
            stroke={draftAxis ? '#0d9488' : '#c45c26'}
            strokeWidth={draftAxis ? 160 : 120}
            dash={[200, 120]}
          />
          <Circle x={draftStart.x} y={draftStart.y} radius={80} fill="#c45c26" />
          <Text
            x={(draftStart.x + hover.x) / 2}
            y={(draftStart.y + hover.y) / 2 - 160}
            text={`${(Math.hypot(hover.x - draftStart.x, hover.y - draftStart.y) / 1000).toFixed(2)} м`}
            fontSize={130}
            fill={draftAxis ? '#0f766e' : '#c45c26'}
          />
        </>
      )}
      {draftStart && tool === 'wall' && !hover && (
        <Circle x={draftStart.x} y={draftStart.y} radius={80} fill="#c45c26" />
      )}

      {tool === 'measure' && measureA && measureB && (
        <>
          <Line
            points={[measureA.x, measureA.y, measureB.x, measureB.y]}
            stroke="#0f766e"
            strokeWidth={40}
            dash={[120, 80]}
          />
          <Circle x={measureA.x} y={measureA.y} radius={60} fill="#0f766e" />
          <Circle x={measureB.x} y={measureB.y} radius={60} fill="#0f766e" />
          {measureLen != null && (
            <Text
              x={(measureA.x + measureB.x) / 2}
              y={(measureA.y + measureB.y) / 2 - 160}
              text={`${(measureLen / 1000).toFixed(2)} м · ${Math.round(measureLen)} мм`}
              fontSize={130}
              fill="#0f766e"
            />
          )}
        </>
      )}
    </Group>
  );
}
