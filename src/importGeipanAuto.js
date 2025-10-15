import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import iconv from "iconv-lite";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function importGeipanAuto() {
  console.log("🚀 Starting GEIPAN import from local file…");

  const csvPath = path.join(process.cwd(), "src", "data", "geipan.csv");
  console.log("📦 CSV path:", csvPath);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at ${csvPath}`);
  }

  // ✅ Učitaj CSV kao buffer i konvertiraj u UTF-8 (podržava ISO-8859-1)
  const buffer = fs.readFileSync(csvPath);
  const csvData = iconv.decode(buffer, "utf-8").replace(/\r\n/g, "\n");

  let records = [];
  try {
    records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      delimiter: ";",
      trim: true,
      on_record: (record, { lines }) => {
        if (!record["Numéro cas"] || !record["Date d'observation"]) {
          console.warn(`⚠️ Skipping bad CSV line ${lines}`);
          return null;
        }

        return {
          case_id: record["Numéro cas"]?.trim() || null,
          date_obs: record["Date d'observation"]?.trim() || null,
          dep_code: record["Département"]?.trim() || null,
          dep_name: record["Département (nom)"]?.trim() || null,
          class: record["Classification GEIPAN"]?.trim() || null,
          shape: record["Forme objet"]?.trim() || null,
          details: record["Résumé"]?.trim() || null,
          title: record["Titre"]?.trim() || null,
          source: "GEIPAN",
          updated_at: new Date().toISOString(),
        };
      },
    });
  } catch (err) {
    console.error("❌ CSV parsing failed:", err.message);
    throw new Error(`CSV parsing failed: ${err.message}`);
  }

  console.log(`📄 Parsed ${records.length} rows from CSV`);

  const validRecords = records.filter((r) => r && r.case_id && r.date_obs);
  console.log(
    `🧹 Skipped ${records.length - validRecords.length} malformed/blank rows`
  );

  const uniqueRecords = [];
  const seen = new Set();
  for (const rec of validRecords) {
    if (!seen.has(rec.case_id)) {
      seen.add(rec.case_id);
      uniqueRecords.push(rec);
    }
  }

  console.log(
    `🧹 Cleaned ${validRecords.length - uniqueRecords.length} duplicate rows`
  );
  console.log(`✅ Ready to insert ${uniqueRecords.length} unique records`);

  const { error } = await supabase
    .from("reports")
    .upsert(uniqueRecords, { onConflict: "case_id" });

  if (error) {
    console.error("❌ Failed to insert into Supabase:", error);
    throw error;
  }

  console.log(`✅ Successfully upserted ${uniqueRecords.length} GEIPAN records`);
  return { success: true, count: uniqueRecords.length };
}
