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
 * 🔧 Ultra-safe cleaner: pretvara sve u ASCII, uklanja binarne bajtove, “pametne” navodnike i sve nečitljive znakove
 */
function binarySafeClean(csvText) {
  return csvText
    .replace(/\r\n/g, "\n")
    .replace(/\uFEFF/g, "")
    .replace(/[“”„‟«»‹›]/g, '"')
    .replace(/[’‘‚‛]/g, "'")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (
        code === 9 || // tab
        code === 10 || // newline
        code === 13 || // carriage return
        (code >= 32 && code <= 126) || // ASCII
        (code >= 160 && code <= 255) // Latin-1 Extended
      ) {
        return ch;
      } else {
        return " "; // zamijeni neprintljive znakove prazninom
      }
    })
    .join("")
    .replace(/""/g, '"')
    .trim();
}

/**
 * 🔍 Robustno parsiranje s automatskim fallbackom
 */
function safeParseCsv(csvText) {
  const cleaned = binarySafeClean(csvText);

  try {
    return parse(cleaned, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      relax: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    console.warn("⚠️ Primary CSV parse failed, trying per-line fallback...");

    const lines = cleaned.split("\n");
    const validLines = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        parse(lines[i], { relax_quotes: true });
        validLines.push(lines[i]);
      } catch {
        console.warn(`⚠️ Skipping corrupted CSV line ${i + 1}`);
      }
    }

    const finalCsv = validLines.join("\n");
    return parse(finalCsv, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      relax: true,
      trim: true,
      bom: true,
    });
  }
}

/**
 * GEIPAN → struktura baze
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
    const response = await fetch(GEIPAN_CSV_URL);
    const rawCsv = await response.text();

    const parsed = safeParseCsv(rawCsv);
    console.log(`📄 Parsed ${parsed.length} records from GEIPAN`);

    const cleanData = parsed
      .map(mapGeipanRecord)
      .filter((r) => r.case_id && r.title);

    console.log(`🧹 Cleaned ${cleanData.length} valid records`);

    const { error: dbError } = await supabase
      .from("reports")
      .upsert(cleanData, { onConflict: "case_id", ignoreDuplicates: false });

    if (dbError) {
      console.error("❌ Supabase insert error:", dbError);
      return res.status(200).json({
        success: false,
        source: "GEIPAN",
        error: dbError.message || dbError,
      });
    }

    console.log(`✅ Successfully imported ${cleanData.length} GEIPAN reports`);
    res.json({ success: true, count: cleanData.length });
  } catch (error) {
    console.error("❌ GEIPAN auto import error:", error);
    res
      .status(200)
      .json({ success: false, source: "GEIPAN", error: error.message });
  }
});

export default router;
