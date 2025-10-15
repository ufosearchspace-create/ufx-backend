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

  // ✅ Decode using ISO-8859-1 (true GEIPAN encoding)
  const buffer = fs.readFileSync(csvPath);
  let csvData = iconv.decode(buffer, "ISO-8859-1")
    .replace(/\uFEFF/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();

  const lines = csvData.split("\n");
  const header = lines.shift();
  const headers = header.split(";").map((h) => h.trim());
  const validRows = [];
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // 🚫 Skip lines with unbalanced quotes
    const quoteCount = (line.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      fs.appendFileSync(logFile, `Line ${i + 2}: Unbalanced quotes -> skipped\n`);
      skipped++;
      continue;
    }

    try {
      const parsed = parse(line, {
        columns: headers,
        delimiter: ";",
        relax_column_count: true,
        relax_quotes: true,
        skip_empty_lines: true,
        trim: true,
      })[0];

      if (!parsed["Numéro cas"] || !parsed["Date d'observation"]) {
        skipped++;
        continue;
      }

      validRows.push({
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

  console.log(`📄 Parsed ${validRows.length} valid rows`);
  console.log(`🧹 Skipped ${skipped} broken or malformed lines (see logs/bad_lines.txt)`);

  // 🧹 Remove duplicates
  const seen = new Set();
  const unique = validRows.filter((r) => {
    if (seen.has(r.case_id)) return false;
    seen.add(r.case_id);
    return true;
  });

  console.log(`🧹 Cleaned ${validRows.length - unique.length} duplicates`);
  console.log(`✅ Ready to insert ${unique.length} unique records`);

  const { error } = await supabase
    .from("reports")
    .upsert(unique, { onConflict: "case_id" });

  if (error) {
    console.error("❌ Failed to insert into Supabase:", error);
    throw error;
  }

  console.log(`✅ Successfully upserted ${unique.length} GEIPAN records`);
  return { success: true, count: unique.length };
}
