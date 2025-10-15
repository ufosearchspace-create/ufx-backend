import express from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEIPAN_CSV_URL =
  "https://www.cnes-geipan.fr/sites/default/files/save_json_import_files/export_cas_pub_20250821093454.csv";

// 🧹 Binary-safe cleaner
function cleanCsv(rawText) {
  return rawText
    .replace(/\r\n/g, "\n")
    .replace(/\uFEFF/g, "")
    .replace(/[“”„‟«»‹›]/g, '"')
    .replace(/[’‘‚‛]/g, "'")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code === 10 || (code >= 32 && code <= 126)) return ch;
      return " ";
    })
    .join("");
}

// 🧩 Dinamični ručni CSV parser (| separator)
function primitiveCsvParser(csvText) {
  const lines = csvText.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0]
    .split("|")
    .map((h) => h.trim().toLowerCase().replace(/\s+/g, " ")); // normalize header

  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split("|");

    if (parts.length !== header.length) continue; // skip bad lines

    const record = {};
    for (let j = 0; j < header.length; j++) {
      record[header[j]] = parts[j]?.trim() ?? null;
    }
    records.push(record);
  }

  return records;
}

// 🗺️ Mapiranje — fleksibilno po nazivima stupaca
function mapGeipanRecord(row) {
  const get = (keys) =>
    keys.reduce((acc, key) => acc || row[key.toLowerCase()], null);

  return {
    case_id: get(["n° dossier", "n dossier", "ndossier", "num dossier"]),
    date_event: get(["date observation", "date"]),
    dep_name: get(["département", "departement"]),
    country: "France",
    classification: get(["type"]),
    title:
      get(["titre", "titre du cas", "titre observation"]) ||
      get(["résumé du cas", "resume du cas"]) ||
      "Cas GEIPAN",
    details: get(["résumé du cas", "resume du cas", "description"]),
    lat: get(["latitude"]),
    lon: get(["longitude"]),
    source: "GEIPAN",
    updated_at: new Date().toISOString(),
  };
}

// 🚀 Glavni endpoint
router.post("/geipan-auto", async (req, res) => {
  const cronToken = req.query.cron_token;
  if (cronToken !== process.env.CRON_TOKEN)
    return res.status(403).json({ success: false, error: "Invalid token" });

  console.log("🚀 Starting GEIPAN automatic import...");
  console.log("📦 Using fixed GEIPAN CSV:", GEIPAN_CSV_URL);

  try {
    const response = await fetch(GEIPAN_CSV_URL);
    const rawText = await response.text();

    const cleaned = cleanCsv(rawText);
    const parsed = primitiveCsvParser(cleaned);
    console.log(`📄 Parsed ${parsed.length} rows from CSV`);

    const cleanData = parsed
      .map(mapGeipanRecord)
      .filter((r) => r.case_id && r.title);

    console.log(`🧹 Valid records ready: ${cleanData.length}`);

    const { error: dbError } = await supabase
      .from("reports")
      .upsert(cleanData, { onConflict: "case_id" });

    if (dbError) {
      console.error("❌ Supabase insert error:", dbError);
      return res
        .status(200)
        .json({ success: false, source: "GEIPAN", error: dbError.message });
    }

    console.log(`✅ Imported ${cleanData.length} GEIPAN records`);
    res.json({ success: true, count: cleanData.length });
  } catch (error) {
    console.error("❌ GEIPAN auto import error:", error);
    res
      .status(200)
      .json({ success: false, source: "GEIPAN", error: error.message });
  }
});

export default router;
