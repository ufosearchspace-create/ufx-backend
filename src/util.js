// src/util.js
export function ensureString(v) {
  return typeof v === "string" ? v : (v === null || v === undefined ? "" : String(v));
}

export function parseNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
