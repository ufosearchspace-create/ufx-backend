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

  const logDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  const logFile = path.join(logDir, "bad_lines.txt");
  fs.writeFileSync(logFile, "BAD CSV LINES LOG\n\n");

  // ✅ Read and decode properly (GEIPAN is ISO-8859-1 encoded!)
  const buffer = fs.readFileSync(csvPath);
  let csvData = iconv.decode(buffer, "ISO-8859-1")
    .replace(/\uFEFF/g, "") // remove BOM
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/“|”/g, '"')
    .trim();

  // ✅ Detect delimiter automatically
  const sample = csvData.split("\n")[0];
  const delimiter = sample.includes(";") ? ";" : ",";
  console.log(`🔍 Detected delimiter: '${delimiter}'`);

  let records = [];
  try {
    records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    });
  } catch (err) {
    console.error("❌ CSV parsing failed globally:", err.message);
    throw new Error(`CSV parsing failed: ${err.message}`);
  }

  console.log(`📄 Parsed ${records.length} raw records`);

  // ✅ Validate and clean
  const validRecords = [];
  let skipped = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    try {
      if (!r["Numéro cas"] || !r["Date d'observation"]) {
        skipped++;
        continue;
      }

      validRecords.push({
        case_id: r["Numéro cas"].trim(),
        date_obs: r["Date d'observation"]?.trim() || null,
        dep_code: r["Département"]?.trim() || null,
        dep_name: r["Département (nom)"]?.trim() || null,
        class: r["Classification GEIPAN"]?.trim() || null,
        shape: r["Forme objet"]?.trim() || null,
        details: r["Résumé"]?.trim() || null,
        title: r["Titre"]?.trim() || null,
        source: "GEIPAN",
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      fs.appendFileSync(logFile, `Line ${i + 2}: ${err.message}\n`);
      skipped++;
    }
  }

  console.log(`🧹 Skipped ${skipped} malformed rows (logged in logs/bad_lines.txt)`);
  console.log(`✅ Valid records ready: ${validRecords.length}`);

  // 🧹 Deduplicate
  const seen = new Set();
  const uniqueRecords = validRecords.filter((r) => {
    if (seen.has(r.case_id)) return false;
    seen.add(r.case_id);
    return true;
  });

  console.log(`🧹 Cleaned ${validRecords.length - uniqueRecords.length} duplicates`);
  console.log(`✅ Ready to insert ${uniqueRecords.length} unique records`);

  // 🧾 Upsert to Supabase
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
