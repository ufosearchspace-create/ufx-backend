// src/importGeipanAuto.js
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Lokalni CSV path
const LOCAL_GEIPAN_PATH = path.join(__dirname, "data", "geipan.csv");

function safeParseCsv(text) {
  try {
    const cleanText = text
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/“|”/g, '"')
      .replace(/«|»/g, '"');

    const records = parse(cleanText, {
      columns: true,
      skip_empty_lines: true,
      delimiter: ";",
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
    });

    console.log(`📄 Parsed ${records.length} rows from local GEIPAN CSV`);
    return records;
  } catch (err) {
    console.error("❌ CSV parsing failed:", err.message);
    throw new Error("CSV parsing failed: " + err.message);
  }
}

export async function importGeipanAuto() {
  console.log("🚀 Starting GEIPAN import from local file...");
  console.log("📦 CSV path:", LOCAL_GEIPAN_PATH);

  try {
    // 1️⃣ Učitaj CSV lokalno
    const text = fs.readFileSync(LOCAL_GEIPAN_PATH, "utf8");

    // 2️⃣ Parsiraj
    const allRecords = safeParseCsv(text);

    // 3️⃣ Očisti i mapiraj
    const cleanRecords = allRecords
      .filter(r => r && r["num_cas"])
      .map(r => ({
        case_id: r["num_cas"],
        date: r["date_evenement"] || null,
        dep_code: r["departement_code"] || null,
        dep_name: r["departement"] || null,
        title: r["titre"] || null,
        details: r["details"] || null,
        category: r["categorie"] || null,
        classification: r["classification"] || null,
        lat: r["latitude"] ? parseFloat(r["latitude"]) : null,
        lon: r["longitude"] ? parseFloat(r["longitude"]) : null,
        source: "GEIPAN",
        updated_at: new Date().toISOString(),
      }));

    console.log(`🧹 Valid records ready: ${cleanRecords.length}`);

    if (cleanRecords.length === 0)
      return { success: true, count: 0 };

    // 4️⃣ Pošalji u Supabase
    const { error } = await supabase
      .from("reports")
      .upsert(cleanRecords, { onConflict: ["case_id"] });

    if (error) {
      console.error("❌ Failed to insert into Supabase:", error);
      throw error;
    }

    console.log(`✅ Imported ${cleanRecords.length} GEIPAN records`);
    return { success: true, count: cleanRecords.length };
  } catch (err) {
    console.error("❌ GEIPAN local import error:", err);
    return { success: false, source: "GEIPAN", error: err.message };
  }
}
