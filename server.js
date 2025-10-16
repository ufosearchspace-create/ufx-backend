// server.js
import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { createHash } from "crypto";

import { supabase } from "./src/supabase.js";
import { importNuforcGithub } from "./src/importNuforcGithub.js";
import { ensureString } from "./src/util.js";

dotenv.config();

const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

// ---------- Helper: secure cron ----------
function checkCronToken(req) {
  const token = req.query.cron_token || req.headers["x-cron-token"];
  if (!process.env.CRON_TOKEN) return true; // ako nije postavljen, pusti (dev)
  return token === process.env.CRON_TOKEN;
}

// ---------- Health ----------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---------- GET /api/reports (list) ----------
app.get("/api/reports", async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const { data, error, count } = await supabase
      .from("reports")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;
    res.json({ success: true, count, data });
  } catch (e) {
    console.error("GET /api/reports error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- POST /api/reports (user submit) ----------
app.post("/api/reports", async (req, res) => {
  try {
    const {
      description,
      latitude,
      longitude,
      location,      // npr. "Zagreb, Croatia"
      date_event,    // ISO string ili null
      image_url,     // opcionalno
      media_url      // kompatibilnost s ranijim poljem
    } = req.body || {};

    // Minimal validation
    const desc = ensureString(description).trim();
    if (!desc) return res.status(400).json({ success: false, error: "description is required" });

    const lat = latitude !== undefined ? Number(latitude) : null;
    const lon = longitude !== undefined ? Number(longitude) : null;
    const loc = ensureString(location).trim() || null;
    const when = ensureString(date_event).trim() || null;
    const img = ensureString(image_url || media_url).trim() || null;

    // Stabilan hash za dedupe (user-source):
    const hash = createHash("sha256")
      .update(`user|${when || ""}|${lat || ""}|${lon || ""}|${desc}`)
      .digest("hex");

    const payload = {
      description: desc,
      latitude: lat,
      longitude: lon,
      location: loc,
      date_event: when,
      image_url: img,
      source: "user",
      source_type: "user",
      hash
    };

    const { data, error } = await supabase
      .from("reports")
      .upsert([payload], { onConflict: "hash" });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    console.error("POST /api/reports error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- POST /api/import/nuforc-github ----------
app.post("/api/import/nuforc-github", async (req, res) => {
  try {
    if (!checkCronToken(req)) return res.status(401).json({ success: false, error: "Invalid cron token" });

    const result = await importNuforcGithub();
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("NUFORC GitHub import error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/** ===========================
 *  FUTURE ENDPOINT HOOKS (OFF)
 *  ===========================
 *  // 1) Public sky cams (read-only registry of cameras)
 *  // 2) AI media verification (Google AI / Vertex / Gemini)
 *  Ostavio sam hookove ispod — ne aktiviramo dok ne odlučiš:
 */

// Example placeholders (disabled):
/*
app.get("/api/cams", async (req, res) => {
  // TODO: return list of public cams (from 'cams' table)
});
app.post("/api/ai/verify-media", async (req, res) => {
  // TODO: upload image_url -> AI service -> return verdict
});
*/

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🧩 ENV CHECK START");
  console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
  console.log("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ Set" : "❌ Missing");
  console.log("CRON_TOKEN:", process.env.CRON_TOKEN || "(not set)");
  console.log("NODE_ENV:", process.env.NODE_ENV || "(not set)");
  console.log("🧩 ENV CHECK END");
  console.log(`✅ UFX backend running on port ${PORT}`);
});
