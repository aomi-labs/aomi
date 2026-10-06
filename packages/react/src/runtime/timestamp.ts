export const parseTimestamp = (value?: string | number) => {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }

  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
};
