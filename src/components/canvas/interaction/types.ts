import type { Tool } from '../../../domain/types';

/** Tools shown in the canvas toolbar (no delete mode). */
export type CanvasTool = Exclude<Tool, 'delete'>;

export const CANVAS_TOOLS: { id: CanvasTool; label: string; hint: string; key: string }[] = [
  { id: 'select', label: 'Выбор', hint: 'ЛКМ по пустому — панорама', key: 'V' },
  { id: 'wall', label: 'Стена', hint: 'Цепочка кликов · Esc — стоп', key: 'W' },
  { id: 'window', label: 'Окно', hint: 'Клик по стене', key: 'O' },
  { id: 'door', label: 'Дверь', hint: 'Клик по стене', key: 'D' },
  { id: 'measure', label: 'Рулетка', hint: 'Два клика · длина', key: 'M' },
];

export type MagnetFeedback = {
  x: number;
  y: number;
  kind: 'endpoint' | 'face' | 'endface' | 'grid' | 'ortho' | string;
};

export type MeasureDraft = {
  a: { x: number; y: number } | null;
  b: { x: number; y: number } | null;
};
