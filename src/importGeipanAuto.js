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
 * Robust CSV parsing for GEIPAN with relaxed rules.
 */
function parseGeipanCsv(csvData) {
  try {
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,        // 👈 fixes invalid quote issues
      relax_column_count: true,  // 👈 allows inconsistent row lengths
      relax: true,               // 👈 general relaxed mode
      trim: true,
      bom: true,
      delimiter: ",",
    });
    return records;
  } catch (error) {
    console.error("❌ CSV parsing failed:", error.message);
    throw new Error(`CSV parsing failed: ${error.message}`);
  }
}

/**
 * Maps and normalizes GEIPAN CSV record structure
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
 * GEIPAN auto-import endpoint
 * Example: /api/import/geipan-auto?cron_token=uFX2025secure!
 */
router.post("/geipan-auto", async (req, res) => {
  const cronToken = req.query.cron_token;

  if (cronToken !== process.env.CRON_TOKEN) {
    return res.status(403).json({ success: false, error: "Invalid token" });
  }

  console.log("🚀 Starting GEIPAN automatic import...");
  console.log("📦 Using fixed GEIPAN CSV:", GEIPAN_CSV_URL);

  try {
    const csvResponse = await fetch(GEIPAN_CSV_URL);
    const csvText = await csvResponse.text();

    console.log("🔗 Fetching CSV:", GEIPAN_CSV_URL);
    const parsed = parseGeipanCsv(csvText);
    console.log(`📄 Parsed ${parsed.length} records from GEIPAN`);

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
