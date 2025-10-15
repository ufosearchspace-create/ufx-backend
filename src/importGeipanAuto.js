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

  // 🔄 Učitaj CSV kao buffer i konvertiraj u UTF-8 (često je ISO-8859-1)
  const buffer = fs.readFileSync(csvPath);
  let csvData = iconv.decode(buffer, "utf-8");

  // 🧠 "Smart" parser – linija po linija
  const lines = csvData.split(/\r?\n/);
  const headerLine = lines.shift();
  const headers = headerLine.split(";").map((h) => h.trim());
  const validRecords = [];
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    try {
      const parsed = parse(line, {
        columns: headers,
        delimiter: ";",
        relax_quotes: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      })[0];

      if (!parsed["Numéro cas"] || !parsed["Date d'observation"]) {
        skipped++;
        continue;
      }

      validRecords.push({
        case_id: parsed["Numéro cas"]?.trim() || null,
        date_obs: parsed["Date d'observation"]?.trim() || null,
        dep_code: parsed["Département"]?.trim() || null,
        dep_name: parsed["Département (nom)"]?.trim() || null,
        class: parsed["Classification GEIPAN"]?.trim() || null,
        shape: parsed["Forme objet"]?.trim() || null,
        details: parsed["Résumé"]?.trim() || null,
        title: parsed["Titre"]?.trim() || null,
        source: "GEIPAN",
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`⚠️ Skipping broken line ${i + 2}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`📄 Parsed ${validRecords.length} valid records`);
  console.log(`🧹 Skipped ${skipped} broken or empty lines`);

  // 🧹 Ukloni duplikate
  const uniqueRecords = [];
  const seen = new Set();
  for (const rec of validRecords) {
    if (!seen.has(rec.case_id)) {
      seen.add(rec.case_id);
      uniqueRecords.push(rec);
    }
  }

  console.log(`🧹 Removed ${validRecords.length - uniqueRecords.length} duplicates`);
  console.log(`✅ Ready to insert ${uniqueRecords.length} unique records`);

  // 🧾 Upsert u Supabase
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
