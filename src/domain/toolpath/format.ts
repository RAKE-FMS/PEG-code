export function formatNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(5).replace(/\.?0+$/, "");
}

