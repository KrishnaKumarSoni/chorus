/** Turn-limit choices, always including the current value so the picker never shows blank. */
export function turnOptions(current: number): number[] {
  const base = [2, 4, 6, 8, 10, 12, 16, 20];
  return base.includes(current) ? base : [...base, current].sort((a, b) => a - b);
}
