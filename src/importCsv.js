import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync"; // ✅ Ispravno — koristi named export "parse"
import dotenv from "dotenv";

dotenv.config();

// ---------------------------
// Supabase client with fallback
// ---------------------------
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY;

if (!process.env.SUPABASE_URL || !supabaseKey) {
  console.error("❌ Missing Supabase credentials in importCsv.js");
  console.error("SUPABASE_URL:", process.env.SUPABASE_URL);
  console.error("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.error("SUPABASE_SERVICE_KEY:", process.env.SUPABASE_SERVICE_KEY);
  console.error("SUPABASE_KEY:", process.env.SUPABASE_KEY);
  throw new Error("Supabase credentials missing.");
}

const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

// ---------------------------
// Main import function
// ---------------------------
export async function importCsvFromUrl({ url, source_name = "GEIPAN", mapping }) {
  console.log(`🔗 Fetching CSV: ${url}`);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);

  const csvText = await response.text();

  // ✅ Parse CSV (radi i za ; i za ,)
  const records = parse(csvText, {
    delimiter: [";", ","],
    skip_empty_lines: true,
  });

  console.log(`📄 Parsed ${records.length} records from ${source_name}`);

  // Mapiraj kolone prema našem modelu
  const rows = records.slice(1).map((cols, idx) => ({
    case_id: cols[0] || `case_${idx}`,
    date: cols[2] || null,
    department: cols[3] || null,
    region: cols[5] || null,
    city: cols[6] || null,
    summary: cols[8] || null,
    description: cols[9] || null,
    classification: cols[cols.length - 3] || null,
    source: source_name,
  }));

  // ✅ Upsert u Supabase
  const { error } = await supabase.from("reports").upsert(rows);
  if (error) {
    console.error("❌ Supabase insert error:", error);
    throw error;
  }

  console.log(`✅ Imported ${rows.length} rows from ${source_name}`);
  return { insertedCount: rows.length };
}
