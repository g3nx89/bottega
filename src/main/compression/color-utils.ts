/**
 * Shared color conversion utility for compression modules.
 */

/** Convert Figma RGBA color (0-1 float range) to hex string #RRGGBB. */
export function rgbaToHex(color: { r: number; g: number; b: number; a?: number }): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const r = clamp(color.r);
  const g = clamp(color.g);
  const b = clamp(color.b);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');
}
