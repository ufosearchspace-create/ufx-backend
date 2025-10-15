import express from "express";
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
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
 * 🔧 Brutalno robusna funkcija koja čisti i parsira CSV
 */
function safeParseCsv(csvText) {
  try {
    let cleaned = csvText
      // Normalizacija kodiranja, linija, BOM-ova
      .replace(/\r\n/g, "\n")
      .replace(/\uFEFF/g, "")
      // Pretvori sve francuske, pametne i čudne navodnike u ASCII
      .replace(/[“”„‟«»‹›]/g, '"')
      .replace(/[’‘‚‛]/g, "'")
      // Makni HTML oznake
      .replace(/<\/?[^>]+(>|$)/g, "")
      // Makni sve kontrolne znakove i ne-ASCII bajtove
      .split("")
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return (
          code === 9 || // tab
          code === 10 || // newline
          code === 13 || // carriage return
          (code >= 32 && code <= 126) || // ASCII printables
          (code >= 128 && code <= 255) // extended latin
        );
      })
      .join("")
      // Riješi duple navodnike i razmake
      .replace(/""/g, '"')
      .trim();

    const lines = cleaned.split("\n");
    const goodLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      try {
        // testno parsiraj svaku liniju
        parse(line, { relax_quotes: true });
        goodLines.push(line);
      } catch {
        console.warn(`⚠️ Skipping bad CSV line ${i + 1}`);
      }
    }

    const finalCsv = goodLines.join("\n");
    const records = parse(finalCsv, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    });

    return records;
  } catch (err) {
    console.error("❌ CSV parsing failed globally:", err.message);
    throw new Error(`CSV parsing failed: ${err.message}`);
  }
}

/**
 * Mapiraj GEIPAN → naš format
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
 * Glavni endpoint
 */
router.post("/geipan-auto", async (req, res) => {
  const cronToken = req.query.cron_token;
  if (cronToken !== process.env.CRON_TOKEN)
    return res.status(403).json({ success: false, error: "Invalid token" });

  console.log("🚀 Starting GEIPAN automatic import...");
  console.log("📦 Using fixed GEIPAN CSV:", GEIPAN_CSV_URL);

  try {
    const csvResponse = await fetch(GEIPAN_CSV_URL);
    const csvText = await csvResponse.text();

    console.log("🔗 Fetching CSV:", GEIPAN_CSV_URL);
    const parsed = safeParseCsv(csvText);
    console.log(`📄 Parsed ${parsed.length} valid records`);

    const cleanData = parsed
      .map(mapGeipanRecord)
      .filter((r) => r.case_id && r.title);

    console.log(`🧹 Cleaned ${cleanData.length} valid records`);

    const { error: dbError } = await supabase
      .from("reports")
      .upsert(cleanData, {
        onConflict: "case_id",
        ignoreDuplicates: false,
      });

    if (dbError) {
      console.error("❌ Failed to insert into Supabase:", dbError);
      return res.status(200).json({
        success: false,
        source: "GEIPAN",
        error: dbError.message || dbError,
      });
    }

    console.log(`✅ Successfully imported ${cleanData.length} GEIPAN reports`);
    return res.json({
      success: true,
      source: "GEIPAN",
      count: cleanData.length,
    });
  } catch (error) {
    console.error("❌ GEIPAN auto import error:", error);
    return res.status(200).json({
      success: false,
      source: "GEIPAN",
      error: error.message || error,
    });
  }
});

export default router;
