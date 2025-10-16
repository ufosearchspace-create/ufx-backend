import { parse } from "csv-parse/sync";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function importCsvFromUrl({ url, source_name = "NUFORC" }) {
  try {
    console.log(`📦 Fetching CSV from: ${url}`);
    const response = await fetch(url);
    const csvText = await response.text();

    const delimiter = csvText.includes(";") ? ";" : ",";
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      delimiter,
      relax_quotes: true,
      relax_column_count: true,
    });

    console.log(`📄 Parsed ${records.length} NUFORC records`);

    const cleanRecords = records
      .filter((r) => r.Summary || r.Description || r.City)
      .map((r) => ({
        description: (r.Summary || r.Description || "").trim(),
        address: r.City || null,
        country: "US",
        date_event: r.Date || null,
        source_name,
        source_url: url,
        created_at: new Date().toISOString(),
      }));

    if (cleanRecords.length === 0) {
      console.warn("⚠️ No valid NUFORC records found.");
      return { success: true, count: 0 };
    }

    const { data, error } = await supabase
      .from("reports")
      .insert(cleanRecords);

    if (error) throw error;

    console.log(`✅ Imported ${cleanRecords.length} NUFORC records.`);
    return { success: true, count: cleanRecords.length };
  } catch (err) {
    console.error("❌ CSV import failed:", err.message);
    throw err;
  }
}
