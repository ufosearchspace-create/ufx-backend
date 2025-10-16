import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";
import { importCsvFromUrl } from "./src/importCsv.js";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// 🧩 ENV CHECK
console.log("🧩 ENV CHECK START");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log(
  "SUPABASE_SERVICE_ROLE_KEY:",
  process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ Set" : "❌ Missing"
);
console.log("CRON_TOKEN:", process.env.CRON_TOKEN || "❌ Missing");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("🧩 ENV CHECK END");

// SUPABASE CLIENT
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function checkCronToken(req) {
  const token = req.query.cron_token || req.headers["x-cron-token"];
  if (!process.env.CRON_TOKEN) return true;
  return token === process.env.CRON_TOKEN;
}

// HEALTH CHECK
app.get("/health", (req, res) => res.json({ ok: true }));

// NUFORC IMPORT
app.post("/api/import/nuforc-auto", async (req, res) => {
  try {
    if (!checkCronToken(req))
      return res.status(401).json({ error: "Invalid cron token" });

    console.log("🚀 Starting NUFORC automatic import...");
    const nuforcCsvUrl = "https://nuforc.org/webreports/ndxe2025.csv";

    const result = await importCsvFromUrl({
      url: nuforcCsvUrl,
      source_name: "NUFORC",
    });

    res.json({ success: true, ...result });
  } catch (e) {
    console.error("❌ NUFORC import error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// USER REPORTS
app.post("/api/reports", async (req, res) => {
  try {
    const { title, description, location, latitude, longitude, media_url } =
      req.body;

    if (!description)
      return res
        .status(400)
        .json({ success: false, error: "Missing description" });

    const { data, error } = await supabase.from("reports").insert([
      {
        description,
        address: location || null,
        lat: latitude || null,
        lon: longitude || null,
        media_url: media_url || null,
        source_name: "USER",
        country: "HR",
        created_at: new Date().toISOString(),
      },
    ]);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error("❌ Error saving user report:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/reports", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error("❌ Error fetching reports:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ UFX backend running on port ${PORT}`));
