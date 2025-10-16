// src/util.js

export const ok = () => ({ ok: true });

export function isValidLat(x) {
  const n = Number(x);
  return Number.isFinite(n) && n >= -90 && n <= 90;
}
export function isValidLon(x) {
  const n = Number(x);
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

/**
 * Jednostavna admin zaštita:
 *  - query: ?admin_token=...
 *  - ili header: x-admin-token: ...
 */
export function adminGuard(req, res, next) {
  const want = process.env.ADMIN_TOKEN;
  if (!want) {
    return res.status(500).json({ success: false, error: "ADMIN_TOKEN not configured" });
  }
  const got = req.query.admin_token || req.headers["x-admin-token"];
  if (got !== want) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }
  next();
}
// --- Compatibility helpers for NUFORC importer ---
export function ensureString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function parseNumberOrNull(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
