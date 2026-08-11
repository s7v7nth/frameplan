/**
 * SP 31-105-2002 Appendix B span tables (simplified for metric stock).
 * Source sections 38×… mapped to yard stock 50×150/200/250/300.
 * Live load ≤ 2.4 kPa (clause 4.2.1 / table notes).
 */

export type SpacingMm = 300 | 400 | 600;

/** Softwood grade 2, horizontal ties at supports + cross bracing (Б-1, rightmost block). */
const JOIST_SPAN_M: Record<number, Record<SpacingMm, number>> = {
  89: { 300: 1.99, 400: 1.81, 600: 1.58 },
  140: { 300: 3.14, 400: 2.85, 600: 2.49 },
  150: { 300: 3.14, 400: 2.85, 600: 2.49 }, // ≈ 38×140
  184: { 300: 3.99, 400: 3.72, 600: 3.27 },
  200: { 300: 3.99, 400: 3.72, 600: 3.27 }, // ≈ 38×184
  235: { 300: 4.6, 400: 4.29, 600: 4.0 },
  250: { 300: 4.6, 400: 4.29, 600: 4.0 }, // ≈ 38×235
  286: { 300: 5.17, 400: 4.82, 600: 4.49 },
  300: { 300: 5.17, 400: 4.82, 600: 4.49 }, // ≈ 38×286
};

/** Roof rafters / roof joists, snow ≈ 1.5–2.0 kPa (approx. Б.6 / Б.4, conservative). */
const RAFTER_SPAN_M: Record<number, Record<SpacingMm, number>> = {
  140: { 300: 3.2, 400: 2.9, 600: 2.5 },
  150: { 300: 3.2, 400: 2.9, 600: 2.5 },
  184: { 300: 4.1, 400: 3.7, 600: 3.2 },
  200: { 300: 4.1, 400: 3.7, 600: 3.2 },
  235: { 300: 4.8, 400: 4.4, 600: 3.8 },
  250: { 300: 4.8, 400: 4.4, 600: 3.8 },
  286: { 300: 5.4, 400: 4.9, 600: 4.3 },
  300: { 300: 5.4, 400: 4.9, 600: 4.3 },
};

/** Header clear-span limits for 2× board on edge with rigid sheathing (Б.13, ~1.5–2.0 kPa). */
const HEADER_SPAN_M: Record<number, { oneFloor: number; twoFloor: number }> = {
  89: { oneFloor: 1.23, twoFloor: 1.08 },
  140: { oneFloor: 1.93, twoFloor: 1.6 },
  150: { oneFloor: 1.93, twoFloor: 1.6 },
  184: { oneFloor: 2.36, twoFloor: 1.95 },
  200: { oneFloor: 2.36, twoFloor: 1.95 },
  235: { oneFloor: 2.89, twoFloor: 2.38 },
  250: { oneFloor: 2.89, twoFloor: 2.38 },
  286: { oneFloor: 3.35, twoFloor: 2.76 },
  300: { oneFloor: 3.35, twoFloor: 2.76 },
};

function nearestDepthKey(depthMm: number, table: Record<number, unknown>): number {
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) {
    if (Math.abs(k - depthMm) < Math.abs(best - depthMm)) best = k;
  }
  // If section is shallower than nearest larger key by >15 mm, use the smaller key only
  return best;
}

function clampSpacing(spacingMm: number): SpacingMm {
  if (spacingMm <= 300) return 300;
  if (spacingMm <= 400) return 400;
  return 600;
}

export function maxJoistSpanM(depthMm: number, spacingMm: number): number {
  const key = nearestDepthKey(depthMm, JOIST_SPAN_M);
  const row = JOIST_SPAN_M[key];
  return row[clampSpacing(spacingMm)];
}

export function maxRafterSpanM(depthMm: number, spacingMm: number): number {
  const key = nearestDepthKey(depthMm, RAFTER_SPAN_M);
  const row = RAFTER_SPAN_M[key] ?? RAFTER_SPAN_M[200];
  return row[clampSpacing(spacingMm)];
}

export function maxHeaderSpanM(depthMm: number, floors: number): number {
  const key = nearestDepthKey(depthMm, HEADER_SPAN_M);
  const row = HEADER_SPAN_M[key] ?? HEADER_SPAN_M[200];
  return floors >= 2 ? row.twoFloor : row.oneFloor;
}

/** Suggest next deeper stock depth that can carry the span. */
export function suggestJoistDepthMm(spanM: number, spacingMm: number): number | null {
  const depths = [150, 200, 250, 300];
  for (const d of depths) {
    if (maxJoistSpanM(d, spacingMm) + 0.02 >= spanM) return d;
  }
  return null;
}

export function suggestJoistSpacingMm(spanM: number, depthMm: number): SpacingMm | null {
  for (const s of [300, 400, 600] as SpacingMm[]) {
    if (maxJoistSpanM(depthMm, s) + 0.02 >= spanM) return s;
  }
  return null;
}

/**
 * Header board height (on edge) from SP 31-105 app. B.13 (rigid sheathing).
 * Approximates tables for roof+attic [+one floor], wall load ~1.5–2.0 kPa.
 */
export function headerHeightMm(clearWMm: number, floors: number): number {
  const spanM = clearWMm / 1000;
  if (floors >= 2) {
    if (spanM <= 1.5) return 150;
    if (spanM <= 1.9) return 200;
    if (spanM <= 2.3) return 250;
    return 300;
  }
  if (spanM <= 1.9) return 150;
  if (spanM <= 2.3) return 200;
  if (spanM <= 2.8) return 250;
  return 300;
}
