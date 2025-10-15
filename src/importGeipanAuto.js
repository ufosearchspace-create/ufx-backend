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

  // ✅ Create log dir for bad lines
  const logDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  const logFile = path.join(logDir, "bad_lines.txt");
  fs.writeFileSync(logFile, "BAD CSV LINES LOG\n\n");

  // ✅ Read & decode CSV safely
  const buffer = fs.readFileSync(csvPath);
  let csvData = iconv.decode(buffer, "utf-8");

  // 🔧 Step 1: Clean broken characters and quotes
  csvData = csvData
    .replace(/\u0000/g, "") // null chars
    .replace(/\r/g, "") // carriage returns
    .replace(/""+/g, '"') // multiple quotes
    .replace(/“|”/g, '"') // fancy quotes
    .replace(/;+$/gm, ""); // trailing delimiters

  const lines = csvData.split("\n");
  const headerLine = lines.shift();
  const headers = headerLine.split(";").map((h) => h.trim());
  const validRecords = [];
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const parsed = parse(line, {
        columns: headers,
        delimiter: ";",
        relax_quotes: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      })[0];

      if (!parsed || !parsed["Numéro cas"]) {
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
      fs.appendFileSync(logFile, `Line ${i + 2}: ${err.message}\n`);
      skipped++;
    }
  }

  console.log(`📄 Parsed ${validRecords.length} valid records`);
  console.log(`🧹 Skipped ${skipped} malformed or broken lines (logged in logs/bad_lines.txt)`);

  // ✅ Remove duplicates
  const seen = new Set();
  const uniqueRecords = validRecords.filter((r) => {
    if (!r.case_id || seen.has(r.case_id)) return false;
    seen.add(r.case_id);
    return true;
  });

  console.log(`🧹 Cleaned ${validRecords.length - uniqueRecords.length} duplicates`);
  console.log(`✅ Ready to insert ${uniqueRecords.length} unique records`);

  // ✅ Insert into Supabase
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
