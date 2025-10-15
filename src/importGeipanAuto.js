import { parse } from "csv-parse/sync";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// ⚙️ Postavke iz environment varijabli
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing Supabase credentials in environment.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🧠 Dohvati URL zadnjeg CSV-a s GEIPAN stranice
export async function importGeipanAuto() {
  console.log("🚀 Starting GEIPAN automatic import...");

  try {
    // 1️⃣ Stranica GEIPAN search (HTML)
    const indexUrl = "https://www.cnes-geipan.fr/en/search/cas";
    const indexHtml = await fetch(indexUrl).then((r) => r.text());

    // 2️⃣ Nađi URL CSV fajla (regex)
    const csvMatch = indexHtml.match(/https:\/\/www\.cnes-geipan\.fr\/sites\/default\/files\/save_json_import_files\/export_cas_pub_\d+\.csv/);
    if (!csvMatch) throw new Error("No CSV link found on GEIPAN page.");

    const csvUrl = csvMatch[0];
    console.log("📦 Latest GEIPAN CSV:", csvUrl);

    // 3️⃣ Preuzmi CSV sadržaj
    const csvText = await fetch(csvUrl).then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch CSV: ${r.statusText}`);
      return r.text();
    });

    console.log("🔗 Fetching CSV:", csvUrl);

    // 4️⃣ Parsiraj CSV
    const records = parse(csvText, {
      delimiter: "|",
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
    });

    console.log(`📄 Parsed ${records.length} records from GEIPAN`);

    // 5️⃣ Mapiraj zapise u format za Supabase
    const data = records.map((r) => {
      const [
        case_id,
        title,
        date,
        dep_code,
        dep_name,
        unknown1,
        region,
        summary,
        details,
        classification,
        updated_at,
        source,
      ] = r;

      return {
        case_id,
        title,
        date,
        dep_code,
        dep_name,
        region,
        summary,
        details,
        classification,
        updated_at,
        source: source || "GEIPAN",
        address: `${dep_name || ""}, ${region || ""}`,
      };
    });

    // 6️⃣ Upsert (insert or update) u Supabase
    const { error } = await supabase.from("reports").upsert(data, {
      onConflict: "case_id",
    });

    if (error) {
      console.error("❌ Supabase insert error:", error);
      throw error;
    }

    console.log(`✅ GEIPAN import completed (${data.length} records)`);
    return { imported: data.length };
  } catch (err) {
    console.error("❌ GEIPAN auto import error:", err);
    throw err;
  }
}
