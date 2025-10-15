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

/**
 * 🧹 Binary-safe cleaner — briše sve neprintljive i ne-UTF8 znakove
 */
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
      // Dozvoli samo “normalne” ASCII znakove + newline
      if (code === 10 || (code >= 32 && code <= 126)) return ch;
      return " ";
    })
    .join("");
}

/**
 * ⚙️ Super jednostavan fallback parser bez biblioteka
 * Dijeli redove ručno i splita po |
 */
function primitiveCsvParser(csvText) {
  const lines = csvText.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split("|").map((h) => h.trim());
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split("|");
    if (parts.length !== header.length) {
      // preskoči red ako ne valja
      continue;
    }

    const record = {};
    for (let j = 0; j < header.length; j++) {
      record[header[j]] = parts[j]?.trim() ?? null;
    }
    records.push(record);
  }

  return records;
}

/**
 * Mapa CSV → reports tablica
 */
function mapGeipanRecord(row) {
  return {
    case_id: row["N° dossier"]?.trim(),
    date_event: row["Date observation"] || null,
    dep_name: row["Département"] || null,
    country: "France",
    classification: row["Type"] || null,
    title: row["Titre"] || row["Résumé du cas"] || "Cas GEIPAN",
    details: row["Résumé du cas"] || null,
    lat: row["Latitude"] || null,
    lon: row["Longitude"] || null,
    source: "GEIPAN",
    updated_at: new Date().toISOString(),
  };
}

/**
 * 🚀 Glavni endpoint
 */
router.post("/geipan-auto", async (req, res) => {
  const cronToken = req.query.cron_token;
  if (cronToken !== process.env.CRON_TOKEN)
    return res.status(403).json({ success: false, error: "Invalid token" });

  console.log("🚀 Starting GEIPAN automatic import...");
  console.log("📦 Using fixed GEIPAN CSV:", GEIPAN_CSV_URL);

  try {
    const response = await fetch(GEIPAN_CSV_URL);
    const rawText = await response.text();

    // Pretvori i očisti CSV
    const cleaned = cleanCsv(rawText);
    const parsed = primitiveCsvParser(cleaned);
    console.log(`📄 Parsed ${parsed.length} records manually`);

    const cleanData = parsed
      .map(mapGeipanRecord)
      .filter((r) => r.case_id && r.title);

    console.log(`🧹 Cleaned ${cleanData.length} valid records`);

    const { error: dbError } = await supabase
      .from("reports")
      .upsert(cleanData, { onConflict: "case_id" });

    if (dbError) {
      console.error("❌ Supabase insert error:", dbError);
      return res.status(200).json({
        success: false,
        source: "GEIPAN",
        error: dbError.message || dbError,
      });
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
