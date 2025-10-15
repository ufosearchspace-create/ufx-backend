import { parse } from "csv-parse/sync";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// ⚙️ ENV konfiguracija
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing Supabase credentials in environment.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🌍 Funkcija za uvoz CSV-a iz bilo kojeg URL-a
export async function importCsvFromUrl({ url, source_name = "CSV", mapping = {} }) {
  try {
    console.log(`🔗 Fetching CSV: ${url}`);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const csvText = await res.text();

    // 🧠 Parsiranje CSV-a
    const records = parse(csvText, {
      columns: false, // automatski detektiramo, jer GEIPAN koristi custom strukturu
      skip_empty_lines: true,
      relax_column_count: true,
      delimiter: "|", // GEIPAN koristi “|”
      relax_quotes: true,
    });

    console.log(`📄 Parsed ${records.length} records from ${source_name}`);

    // Ako CSV ima header, preskoči ga (detektiramo ako sadrži “case_id” ili “Date”)
    const hasHeader =
      records.length > 0 &&
      records[0].some((h) =>
        ["case_id", "Date", "Region", "Classification"].includes(String(h).trim())
      );

    const cleanRecords = hasHeader ? records.slice(1) : records;

    // 🗂️ Mapiranje redaka
    const data = cleanRecords.map((r, i) => {
      const [
        case_id,
        title,
        date,
        dep_code,
        dep_name,
        _,
        region,
        summary,
        details,
        classification,
        updated_at,
        source,
      ] = r;

      return {
        case_id: case_id || `unknown_${i}_${Date.now()}`,
        title: title?.trim() || null,
        date: date?.trim() || null,
        dep_code: dep_code?.trim() || null,
        dep_name: dep_name?.trim() || null,
        region: region?.trim() || null,
        summary: summary?.trim() || null,
        details: details?.trim() || null,
        classification: classification?.trim() || null,
        updated_at: updated_at?.trim() || null,
        source: source_name,
        address: `${dep_name || ""}, ${region || ""}`,
      };
    });

    // 🧾 Spremi u Supabase
    const { error } = await supabase.from("reports").upsert(data, {
      onConflict: "case_id",
    });

    if (error) {
      console.error("❌ Failed to insert into Supabase:", error);
      throw error;
    }

    console.log(`✅ Successfully imported ${data.length} rows from ${source_name}`);
    return { success: true, count: data.length };
  } catch (err) {
    console.error("❌ CSV import error:", err);
    throw err;
  }
}
