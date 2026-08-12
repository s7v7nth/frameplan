import { Rect, Text, Group } from 'react-konva';
import type { FurnitureItem, Tool } from '../../../domain/types';
import { useEditorStore } from '../../../store/editorStore';

type Props = {
  furniture: FurnitureItem[];
  tool: Tool;
  selectedId: string | null;
  spacePan: boolean;
  panning: boolean;
};

export function FurnitureLayer({ furniture, tool, selectedId, spacePan, panning }: Props) {
  const select = useEditorStore((s) => s.select);
  const moveFurniture = useEditorStore((s) => s.moveFurniture);
  const checkpoint = useEditorStore((s) => s.checkpoint);

  return (
    <>
      {furniture.map((f) => (
        <Group
          key={f.id}
          x={f.x}
          y={f.y}
          rotation={f.rotation}
          draggable={tool === 'select' && !spacePan && !panning}
          onDragStart={() => {
            checkpoint();
            select(f.id);
          }}
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
    </>
  );
}
