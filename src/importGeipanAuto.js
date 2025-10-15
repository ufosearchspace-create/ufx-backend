// src/importGeipanAuto.js
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

/**
 * Robust date parser for DD/MM/YYYY -> YYYY-MM-DD (or null).
 */
function parseFrDate(d) {
  if (!d) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  // Basic sanity check
  const iso = `${yyyy}-${mm}-${dd}`;
  return iso;
}

/**
 * Build a single report record from 15 pipe-delimited columns.
 * Cols mapping (0-based), inferred from the GEIPAN export:
 *  0 case_id
 *  1 title
 *  2 date_str (DD/MM/YYYY)
 *  3 dep_code
 *  4 dep_name
 *  5 <unused/empty>
 *  6 region_name
 *  7 details_main (HTML)
 *  8 link1 (often empty)
 *  9 details_extra (more HTML)
 * 10 link2 (often empty)
 * 11 link3 (often empty)
 * 12 class (A/B/C/D)
 * 13 updated_at (DD/MM/YYYY)
 * 14 source (usually "GPN")
 */
function buildRecord(cols) {
  const detailsPieces = [];
  if (cols[7]) detailsPieces.push(cols[7]);
  if (cols[9]) detailsPieces.push(cols[9]);
  if (cols[10]) detailsPieces.push(cols[10]);
  if (cols[11]) detailsPieces.push(cols[11]);
  const details = detailsPieces.join("\n\n").trim() || null;

  return {
    // required/identity
    case_id: cols[0]?.trim() || null,

    // primary content
    title: cols[1]?.trim() || null,
    date: parseFrDate(cols[2]),
    dep_code: cols[3]?.trim() || null,
    dep_name: cols[4]?.trim() || null,
    region: cols[6]?.trim() || null,
    details,

    // classification/source/meta
    class: cols[12]?.trim() || null,
    updated_at: parseFrDate(cols[13]),
    source: cols[14]?.trim() || "GPN",

    // keep for future use (optional)
    // pdf_url: cols[8]?.trim() || null, // if you later want to store links
  };
}

/**
 * Main importer – reads local CSV and upserts into Supabase.
 */
export async function importGeipanAuto() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Local CSV path (as discussed): src/data/geipan.csv
  const csvPath = path.join(process.cwd(), "src", "data", "geipan.csv");
  console.log("🚀 Starting GEIPAN import from local file…");
  console.log("📦 CSV path:", csvPath);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at ${csvPath}. Upload it to the repo: src/data/geipan.csv`);
  }

  // Read whole file (UTF-8). We ignore quotes and just split on '|'.
  const raw = fs.readFileSync(csvPath, "utf8");

  const lines = raw.split(/\r?\n/);
  let parsed = 0;
  let skipped = 0;

  const records = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];

    // Skip blank lines (there is a blank first line in your file)
    if (!line || !line.trim()) continue;

    // Split strictly on pipes
    const cols = line.split("|");

    if (cols.length !== 15) {
      // Log and skip malformed line counts (very rare in your file)
      console.warn(`⚠️ Skipping line ${lineNo}: expected 15 columns, got ${cols.length}`);
      skipped++;
      continue;
    }

    const rec = buildRecord(cols);

    // Basic validity: must have case_id
    if (!rec.case_id) {
      console.warn(`⚠️ Skipping line ${lineNo}: missing case_id`);
      skipped++;
      continue;
    }

    parsed++;
    records.push(rec);
  }

  console.log(`📄 Parsed ${parsed} rows from CSV`);
  console.log(`🧹 Skipped ${skipped} malformed/blank rows`);

  if (records.length === 0) {
    console.log("ℹ️ No valid records to import.");
    return { count: 0 };
  }

  // Upsert in batches (to avoid payload limits)
  const BATCH_SIZE = 500;
  let imported = 0;

  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const chunk = records.slice(start, start + BATCH_SIZE);
    const { error, count } = await supabase
      .from("reports")
      .upsert(chunk, { onConflict: "case_id" });

    if (error) {
      console.error("❌ Failed to insert into Supabase:", error);
      throw error;
    }
    imported += count ?? chunk.length; // Supabase may not always return count
  }

  console.log(`✅ Imported/Upserted ${imported} GEIPAN records`);
  return { count: imported };
}
