import { Line, Circle, Text, Group } from 'react-konva';
import {
  WALL_MAGNET_MM,
  orthoCornerMarkers,
  draftOrthoMarker,
} from '../../../domain/geometry';
import type { Point, Tool, Wall } from '../../../domain/types';
import type { MagnetFeedback, MeasureDraft } from '../interaction/types';

type Props = {
  allWalls: Wall[];
  activeFloor: 0 | 1;
  tool: Tool;
  draftStart: Point | null;
  hover: Point | null;
  magnetAt: MagnetFeedback | null;
  measure: MeasureDraft;
};

export function OverlayLayer({
  allWalls,
  activeFloor,
  tool,
  draftStart,
  hover,
  magnetAt,
  measure,
}: Props) {
  const orthoMarks = orthoCornerMarkers(allWalls, activeFloor);
  const draftOrtho =
    draftStart && hover && tool === 'wall' ? draftOrthoMarker(draftStart, hover) : null;

  const measureA = measure.a;
  const measureB = measure.b ?? hover;
  const measureLen =
    measureA && measureB
      ? Math.hypot(measureB.x - measureA.x, measureB.y - measureA.y)
      : null;

  return (
    <Group listening={false}>
      {orthoMarks.map((m, i) => {
        const c = Math.cos(m.angle);
        const s = Math.sin(m.angle);
        const sz = m.size;
        const p0 = { x: m.x, y: m.y };
        const p1 = { x: m.x + c * sz, y: m.y + s * sz };
        const p2 = {
          x: m.x + c * sz - s * sz,
          y: m.y + s * sz + c * sz,
        };
        const p3 = { x: m.x - s * sz, y: m.y + c * sz };
        return (
          <Line
            key={`ortho-${i}`}
            points={[p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]}
            stroke="#2563eb"
            strokeWidth={18}
            opacity={0.85}
          />
        );
      })}

      {draftOrtho && (
        <Line
          points={[
            draftOrtho.x,
            draftOrtho.y,
            draftOrtho.x + Math.cos(draftOrtho.angle) * draftOrtho.size,
            draftOrtho.y + Math.sin(draftOrtho.angle) * draftOrtho.size,
            draftOrtho.x +
              Math.cos(draftOrtho.angle) * draftOrtho.size -
              Math.sin(draftOrtho.angle) * draftOrtho.size,
            draftOrtho.y +
              Math.sin(draftOrtho.angle) * draftOrtho.size +
              Math.cos(draftOrtho.angle) * draftOrtho.size,
            draftOrtho.x - Math.sin(draftOrtho.angle) * draftOrtho.size,
            draftOrtho.y + Math.cos(draftOrtho.angle) * draftOrtho.size,
          ]}
          stroke="#2563eb"
          strokeWidth={22}
          opacity={0.9}
        />
      )}

      {magnetAt && (tool === 'wall' || tool === 'select' || tool === 'measure') && (
        <Group>
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
        <>
          <Line
            points={[draftStart.x, draftStart.y, hover.x, hover.y]}
            stroke="#c45c26"
            strokeWidth={120}
            dash={[200, 120]}
          />
          <Circle x={draftStart.x} y={draftStart.y} radius={80} fill="#c45c26" />
          <Text
            x={(draftStart.x + hover.x) / 2}
            y={(draftStart.y + hover.y) / 2 - 160}
            text={`${(Math.hypot(hover.x - draftStart.x, hover.y - draftStart.y) / 1000).toFixed(2)} м`}
            fontSize={130}
            fill="#c45c26"
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
