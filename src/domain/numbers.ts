/** Smallest practical framed-wall thickness (mm). 0 is not a wall. */
export const MIN_WALL_THICKNESS_MM = 50;

/**
 * Parse a wall-thickness field. Leading zeros are stripped (`0150` → 150).
 * Empty, non-numeric, and values below `min` (including 0) are rejected.
 */
export function parseWallThicknessMm(
  raw: string,
  min = MIN_WALL_THICKNESS_MM,
): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const cleaned = trimmed.replace(/^0+(?=\d)/, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < min) return null;
  return Math.round(n);
}
