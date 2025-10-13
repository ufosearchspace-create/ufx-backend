import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
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
  console.error("❌ Missing Supabase credentials in importGeipanAuto.js");
  console.error("SUPABASE_URL:", process.env.SUPABASE_URL);
  console.error("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.error("SUPABASE_SERVICE_KEY:", process.env.SUPABASE_SERVICE_KEY);
  console.error("SUPABASE_KEY:", process.env.SUPABASE_KEY);
  throw new Error("Supabase credentials missing.");
}

const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

// ---------------------------
// GEIPAN automatic CSV import
// ---------------------------
export async function importGeipanAuto() {
  try {
    console.log("🚀 Fetching latest GEIPAN CSV...");

    // GEIPAN CSV URL — uvijek aktualna verzija
    const csvUrl =
      "https://www.cnes-geipan.fr/fileadmin/data.csv";

    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error(`Failed to fetch GEIPAN CSV: ${response.statusText}`);

    const csvText = await response.text();
    const records = parse(csvText, {
      delimiter: [";", ","],
      skip_empty_lines: true,
    });

    console.log(`📄 Parsed ${records.length} GEIPAN rows`);

    // Header skip
    const dataRows = records.slice(1).map((cols, idx) => ({
      case_id: cols[0] || `geipan_case_${idx}`,
      date: cols[2] || null,
      department: cols[3] || null,
      region: cols[5] || null,
      city: cols[6] || null,
      summary: cols[8] || null,
      description: cols[9] || null,
      classification: cols[cols.length - 3] || null,
      source: "GEIPAN",
    }));

    // ---------------------------
    // Insert or upsert into Supabase
    // ---------------------------
    const { error } = await supabase.from("reports").upsert(dataRows);
    if (error) {
      console.error("❌ Supabase upsert error:", error);
      throw error;
    }

    console.log(`✅ Successfully imported ${dataRows.length} GEIPAN reports`);
    return { insertedCount: dataRows.length };
  } catch (err) {
    console.error("❌ GEIPAN import failed:", err);
    throw err;
  }
}
