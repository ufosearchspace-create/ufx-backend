// src/importCsv.js
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// Supabase klijent
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Uvozi CSV datoteku s URL-a u Supabase tablicu `reports`.
 * Automatski detektira delimiter i koristi UPSERT (bez duplikata).
 * @param {Object} options
 * @param {string} options.url - URL CSV datoteke
 * @param {string} options.source_name - naziv izvora (npr. GEIPAN, NUFORC, MUFON)
 * @param {string} [options.mapping] - tip mape za prilagođeno parsiranje
 * @param {number} [options.batchSize=500] - broj redaka po batchu
 */
export async function importCsvFromUrl({
  url,
  source_name,
  mapping,
  batchSize = 500,
}) {
  console.log("🔗 Fetching CSV:", url);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch CSV: ${resp.status} ${resp.statusText}`);
  }

  const csvData = await resp.text();

  // Odredi delimiter
  const delimiter = url.includes("geipan") ? "|" : ",";

  // Parsiraj CSV
  const records = parse(csvData, {
    columns: true,
    skip_empty_lines: true,
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
  });

  console.log(`📄 Parsed ${records.length} records from ${source_name}`);

  let insertedCount = 0;
  const totalBatches = Math.ceil(records.length / batchSize);

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const rows = batch.map((r) => {
      const obj = {};

      // GEIPAN CSV mapiranje
      if (mapping === "geipan_fr" || delimiter === "|") {
        obj.source = "GEIPAN";
        obj.case_id = r["NUMERO"] || r["numero"] || null;
        obj.date = r["DATE"] || r["date"] || null;
        obj.dept = r["DEPARTEMENT"] || r["departement"] || null;
        obj.region = r["REGION"] || r["region"] || null;
        obj.place = r["LIEU"] || r["lieu"] || null;
        obj.summary =
          r["RESUME"] ||
          r["resume"] ||
          r["SUMMARY"] ||
          r["description"] ||
          null;
        obj.category = r["CLASSE"] || r["class"] || null;
        obj.status = r["STATUT"] || null;
        obj.observed_at = r["DATE_OBSERVATION"] || null;
      } else {
        // generički CSV
        Object.assign(obj, r);
      }

      obj.created_at = new Date().toISOString();
      obj.source_name = source_name;

      // Hash ključ za detekciju duplikata (ako slučajno case_id fali)
      obj.unique_key = `${obj.source || "GEN"}_${obj.case_id || obj.place || Math.random().toString(36).substring(2, 8)}`;

      return obj;
    });

    // UPSERT umjesto INSERT
    const { error } = await supabase
      .from("reports")
      .upsert(rows, { onConflict: ["case_id", "source"] });

    if (error) {
      console.error("❌ Supabase upsert error:", error.message);
      throw error;
    }

    insertedCount += rows.length;
    console.log(
      `✅ Batch ${i / batchSize + 1}/${totalBatches}: ${rows.length} records`
    );
  }

  console.log(`🎯 Import finished: ${insertedCount} total rows`);
  return { insertedCount };
}
