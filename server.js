// server.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";

import { importCsvFromUrl } from "./src/importCsv.js";
import { importGeipanAuto } from "./src/importGeipanAuto.js";
import { geocodeMissing } from "./src/geocode.js";

dotenv.config();
const app = express();
app.use(bodyParser.json());

// ----------------------------------------------------
// ENV CHECK
// ----------------------------------------------------
console.log("🧩 ENV CHECK START");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("CRON_TOKEN:", process.env.CRON_TOKEN);
console.log("LOCATIONIQ_API_KEY:", process.env.LOCATIONIQ_API_KEY ? "✅ Set" : "❌ Missing");
console.log("🧩 ENV CHECK END");

// ----------------------------------------------------
// Supabase Client
// ----------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ----------------------------------------------------
// Helper: Cron Token Validation
// ----------------------------------------------------
function checkCronToken(req) {
  const token = req.query.cron_token || req.headers["x-cron-token"];
  if (!process.env.CRON_TOKEN) return true; // allow all if not set
  return token === process.env.CRON_TOKEN;
}

// ----------------------------------------------------
// Health Check
// ----------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ----------------------------------------------------
// POST /api/report
// Insert single report record
// ----------------------------------------------------
app.post("/api/report", async (req, res) => {
  try {
    const { id, address } = req.body;
    const { error } = await supabase.from("reports").insert([{ id, address }]);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error("❌ Error /api/report:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ----------------------------------------------------
// POST /api/import
// Manual CSV import (with URL and mapping)
// ----------------------------------------------------
app.post("/api/import", async (req, res) => {
  try {
    const { url, source_name, mapping } = req.body;
    const result = await importCsvFromUrl({ url, source_name, mapping });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("❌ Error /api/import:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ----------------------------------------------------
// POST /api/geocode
// Fill missing coordinates
// ----------------------------------------------------
app.post("/api/geocode", async (req, res) => {
  try {
    if (!checkCronToken(req))
      return res.status(401).json({ error: "Invalid cron token" });

    const result = await geocodeMissing();
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("❌ Error /api/geocode:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ----------------------------------------------------
// POST /api/import/geipan-auto
// Automatically import GEIPAN CSV (local or online)
// ----------------------------------------------------
app.post("/api/import/geipan-auto", async (req, res) => {
  try {
    if (!checkCronToken(req))
      return res.status(401).json({ error: "Invalid cron token" });

    console.log("🚀 Starting GEIPAN automatic import...");
    const result = await importGeipanAuto();
    res.json({ success: true, source: "GEIPAN", ...result });
  } catch (e) {
    console.error("❌ GEIPAN auto import error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ----------------------------------------------------
// Start Server
// ----------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ UFX backend running on port ${PORT}`);
});
