console.log("🧩 ENV CHECK START");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_KEY:", process.env.SUPABASE_KEY);
console.log("SUPABASE_SERVICE_KEY:", process.env.SUPABASE_SERVICE_KEY);
console.log("CRON_TOKEN:", process.env.CRON_TOKEN);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("🧩 ENV CHECK END");

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

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------------------------
// Helper: Cron token security
// ---------------------------
function checkCronToken(req) {
  const token = req.query.cron_token || req.headers["x-cron-token"];
  if (!process.env.CRON_TOKEN) return true; // ako nije postavljen, dopuštamo sve
  return token === process.env.CRON_TOKEN;
}

// ---------------------------
// Health check
// ---------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---------------------------
// POST /api/report
// Dodaje pojedinačni zapis u Supabase
// ---------------------------
app.post("/api/report", async (req, res) => {
  try {
    const { id, address } = req.body;
    const { error } = await supabase.from("reports").insert([{ id, address }]);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error("Error /report:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------
// POST /api/import
// Uvoz CSV s URL-a (opći endpoint)
// ---------------------------
app.post("/api/import", async (req, res) => {
  try {
    const { url, source_name, mapping } = req.body;
    const result = await importCsvFromUrl({ url, source_name, mapping });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("Error /import:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------
// POST /api/geocode
// Popuni koordinate ako ih nema
// ---------------------------
app.post("/api/geocode", async (req, res) => {
  try {
    if (!checkCronToken(req)) return res.status(401).json({ error: "Invalid cron token" });
    const result = await geocodeMissing();
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("Error /geocode:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------
// POST /api/import/geipan-auto
// Automatski dohvaća najnoviji GEIPAN CSV i uvozi ga
// ---------------------------
app.post("/api/import/geipan-auto", async (req, res) => {
  try {
    if (!checkCronToken(req)) return res.status(401).json({ error: "Invalid cron token" });

    console.log("🚀 Starting GEIPAN automatic import...");
    const result = await importGeipanAuto();
    res.json({ success: true, source: "GEIPAN", ...result });
  } catch (e) {
    console.error("GEIPAN auto import error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------
// Server start
// ---------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
