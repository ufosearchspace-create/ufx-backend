// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";

import nuforcGithubRouter from "./src/importNuforcGithub.js"; // NUFORC importer (GitHub CSV ili web CSV)
import camerasRouter from "./src/cameras.js";                 // nove kamere rute
import aiVerifyRouter from "./src/aiVerify.js";               // AI verifikacija (placeholder)
import { supabase } from "./src/supabase.js";
import { isValidLat, isValidLon, adminGuard, ok } from "./src/util.js";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// ---- ENV logs (sanitizirano) ----
console.log("🧩 ENV CHECK START");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ Set" : "❌ Missing");
console.log("CRON_TOKEN:", process.env.CRON_TOKEN || "❌ Missing");
console.log("ADMIN_TOKEN:", process.env.ADMIN_TOKEN ? "✅ Set" : "❌ Missing (required for POST /api/cameras)");
console.log("NODE_ENV:", process.env.NODE_ENV || "dev");
console.log("🧩 ENV CHECK END");

// ---- Health ----
app.get("/health", (req, res) => res.json({ ok: true }));

// ---- Reports: GET (list) ----
app.get("/api/reports", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json({ success: true, count: data?.length || 0, data });
  } catch (err) {
    console.error("GET /api/reports error:", err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// ---- Reports: POST (user submit) ----
app.post("/api/reports", async (req, res) => {
  try {
    const {
      description,
      latitude,
      longitude,
      location,
      media_url,
      thumbnail_url,
      date_event, // ISO string ili null
    } = req.body || {};

    if (!description || typeof description !== "string") {
      return res.status(400).json({ success: false, error: "description is required" });
    }
    if (latitude != null && !isValidLat(latitude)) {
      return res.status(400).json({ success: false, error: "invalid latitude" });
    }
    if (longitude != null && !isValidLon(longitude)) {
      return res.status(400).json({ success: false, error: "invalid longitude" });
    }

    const payload = {
      description,
      lat: latitude ?? null,
      lon: longitude ?? null,
      address: location ?? null,
      media_url: media_url ?? null,
      thumbnail_url: thumbnail_url ?? null,
      date_event: date_event ? new Date(date_event).toISOString() : null,
      source_name: "USER",
      source_type: "USER",
      verified_by_ai: false,
    };

    const { data, error } = await supabase.from("reports").insert([payload]).select();
    if (error) throw error;

    res.json({ success: true, data: data?.[0] ?? null });
  } catch (err) {
    console.error("POST /api/reports error:", err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// ---- NUFORC import (GitHub / web CSV) ----
// Cron zaštita preko ?cron_token=...
app.use("/api/import", nuforcGithubRouter);

// ---- Kamere (GET public, POST admin) ----
app.use("/api/cameras", camerasRouter);

// ---- AI verifikacija (placeholder endpointi) ----
app.use("/api", aiVerifyRouter);

// ---- Start ----
app.listen(PORT, () => {
  console.log(`✅ UFX backend running on port ${PORT}`);
  console.log("     ==> Your service is live 🎉");
  console.log("     ==> ");
  console.log("     ==> ///////////////////////////////////////////////////////////");
  console.log("     ==> ");
  console.log("     ==> Available at your primary URL https://ufx-backend-1.onrender.com");
  console.log("     ==> ");
  console.log("     ==> ///////////////////////////////////////////////////////////");
});
