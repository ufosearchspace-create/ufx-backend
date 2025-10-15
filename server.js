console.log("🧩 ENV CHECK START");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("CRON_TOKEN:", process.env.CRON_TOKEN);
console.log("LOCATIONIQ_API_KEY:", process.env.LOCATIONIQ_API_KEY ? "✅ Set" : "❌ Missing");
console.log("🧩 ENV CHECK END");

// --------------------------------------------------------
// server.js
// --------------------------------------------------------

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";

import { importCsvFromUrl } from "./src/importCsv.js";
import { importGeipanAuto } from "./src/importGeipanAuto.js";  // ✅ FIXED LINE
import { geocodeMissing } from "./src/geocode.js";

dotenv.config();
const app = express();
app.use(bodyParser.json());

// --------------------------------------------------------
// Supabase client
// --------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --------------------------------------------------------
// Helper: Cron token security
// --------------------------------------------------------
function checkCronToken(req) {
  const token = req.query.cron_token || req.headers["x-cron-token"];
  if (!process.env.CRON_TOKEN) return true;
  return token === process.env.CRON_TOKEN;
}

// --------------------------------------------------------
// Health check
// --------------------------------------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// --------------------------------------------------------
// POST /api/report
// --------------------------------------------------------
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

// --------------------------------------------------------
// POST /api/import
// --------------------------------------------------------
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

// --------------------------------------------------------
// POST /api/geocode
// --------------------------------------------------------
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

// --------------------------------------------------------
// Mount GEIPAN auto-import router ✅
// --------------------------------------------------------
app.use("/api/import", importGeipanAutoRouter);

// --------------------------------------------------------
// Server start
// --------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ UFX backend running on port ${PORT}`);
});
