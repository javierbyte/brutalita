/** Rightward italic angle in degrees; zero keeps the font upright. */
export const MAX_SLANT = 20;

export function isValidSlant(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_SLANT;
}

export function slantFactor(angle = 0): number {
  return Math.tan(angle * Math.PI / 180);
}
