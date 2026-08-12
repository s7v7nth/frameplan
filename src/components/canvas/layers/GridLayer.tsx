import { Line, Group } from 'react-konva';
import { gridStepForScale } from '../../../domain/geometry';

type Props = {
  scale: number;
  /** World-space center roughly under viewport for tiling */
  viewCenter: { x: number; y: number };
  viewSizeMm: { w: number; h: number };
};

export function GridLayer({ scale, viewCenter, viewSizeMm }: Props) {
  const step = gridStepForScale(scale);
  const pad = Math.max(viewSizeMm.w, viewSizeMm.h) * 0.6;
  const minX = Math.floor((viewCenter.x - pad) / step) * step;
  const maxX = Math.ceil((viewCenter.x + pad) / step) * step;
  const minY = Math.floor((viewCenter.y - pad) / step) * step;
  const maxY = Math.ceil((viewCenter.y + pad) / step) * step;

  const verts: number[] = [];
  const hors: number[] = [];
  for (let x = minX; x <= maxX; x += step) verts.push(x);
  for (let y = minY; y <= maxY; y += step) hors.push(y);

  const stroke = step >= 1000 ? '#c5d2c7' : '#d7e0d8';
  const sw = 1 / scale;

  return (
    <Group listening={false}>
      {hors.map((y) => (
        <Line key={`h${y}`} points={[minX, y, maxX, y]} stroke={stroke} strokeWidth={sw} />
      ))}
      {verts.map((x) => (
        <Line key={`v${x}`} points={[x, minY, x, maxY]} stroke={stroke} strokeWidth={sw} />
      ))}
    </Group>
  );
}
