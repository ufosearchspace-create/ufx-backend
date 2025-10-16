import { parse } from "csv-parse/sync";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeHeader(header) {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

export async function importCsvFromUrl({ url, source_name = "NUFORC" }) {
  try {
    console.log(`📦 Fetching CSV from: ${url}`);
    const response = await fetch(url);

    if (!response.ok) throw new Error(`Failed to fetch CSV (${response.status})`);

    const csvText = await response.text();

    // Automatski detektiraj delimiter
    const delimiter = csvText.includes(";") ? ";" : ",";
    console.log(`🔍 Detected delimiter: ${delimiter}`);

    // Parsiraj CSV u raw format
    const records = parse(csvText, {
      columns: (header) => header.map(normalizeHeader),
      skip_empty_lines: true,
      delimiter,
      relax_quotes: true,
      relax_column_count: true,
    });

    console.log(`📄 Parsed ${records.length} NUFORC records`);

    if (!records.length) throw new Error("CSV appears to be empty.");

    // 🔎 Dinamičko mapiranje mogućih naziva stupaca
    const possibleFields = {
      date_event: ["date_time", "date", "datetime", "time"],
      city: ["city", "location", "place"],
      state: ["state", "region", "province"],
      shape: ["shape", "object_shape", "form"],
      duration: ["duration", "length", "time_length"],
      summary: ["summary", "description", "comments", "observed", "text"],
      posted: ["posted", "date_posted"],
    };

    const findValue = (row, keys) =>
      keys.map((k) => row[k]).find((v) => v && v.trim && v.trim().length > 0);

    // 🔧 Normaliziraj i filtriraj zapise
    const cleanRecords = records
      .map((r) => ({
        date_event: findValue(r, possibleFields.date_event) || null,
        address: findValue(r, possibleFields.city) || null,
        country: "US",
        description: findValue(r, possibleFields.summary) || null,
        duration: findValue(r, possibleFields.duration) || null,
        source_name,
        source_url: url,
        created_at: new Date().toISOString(),
      }))
      .filter((r) => r.description);

    console.log(`🧹 Cleaned ${cleanRecords.length} valid NUFORC records`);

    if (cleanRecords.length === 0)
      return { success: true, count: 0, message: "No valid NUFORC entries found." };

    // 🚀 Upsert u Supabase
    const { data, error } = await supabase.from("reports").insert(cleanRecords);

    if (error) throw error;

    console.log(`✅ Successfully inserted ${cleanRecords.length} NUFORC records.`);
    return { success: true, count: cleanRecords.length };
  } catch (err) {
    console.error("❌ CSV import failed:", err.message);
    throw err;
  }
}
