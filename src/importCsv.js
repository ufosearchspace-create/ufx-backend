// src/importCsv.js
import { parse } from "csv-parse/sync";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// Environment vars
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment!");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Split array into chunks to avoid DB overload
 */
function chunkArray(arr, size = 500) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Import CSV from a URL and insert into Supabase
 */
export async function importCsvFromUrl({ url, source_name = "Unknown", mapping = {} }) {
  console.log("🔗 Fetching CSV:", url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

  // Parse CSV
  const records = parse(text, {
    delimiter: "|",
    skip_empty_lines: true,
  });

  // First row = headers
  const headers = records.shift();
  console.log("🧩 Detected headers:", headers.slice(0, 10), "...");

  // Map records to structured objects
  const mappedRecords = records.map((row) => {
    const obj = {};
    headers.forEach((key, index) => {
      obj[key.trim()] = row[index] ? row[index].trim() : null;
    });

    return {
      case_id: obj["N° Cas"] || obj["id"] || null,
      title: obj["Titre"] || obj["title"] || null,
      date_obs: obj["Date d'observation"] || obj["date_obs"] || null,
      dep_code: obj["Code dep"] || obj["dep_code"] || null,
      dep_name: obj["Nom dep"] || obj["dep_name"] || null,
      region: obj["Région"] || obj["region"] || null,
      country: obj["Pays"] || obj["country"] || "France",
      city: obj["Lieu"] || obj["city"] || null,
      summary: obj["Résumé"] || obj["summary"] || null,
      details: obj["Description"] || obj["details"] || null,
      classification: obj["Catégorie"] || obj["classification"] || null,
      updated_at: obj["Date maj"] || obj["updated_at"] || null,
      source: source_name,
    };
  });

  console.log(`📄 Parsed ${mappedRecords.length} records from CSV`);

  // Batch upsert to Supabase
  let totalInserted = 0;
  let errors = [];

  for (const chunk of chunkArray(mappedRecords, 300)) {
    const { error, count } = await supabase
      .from("reports")
      .upsert(chunk, { onConflict: "case_id" });

    if (error) {
      console.error("⚠️ Insert chunk failed:", error.message);
      errors.push(error.message);
    } else {
      totalInserted += count || chunk.length;
    }
  }

  if (errors.length > 0) {
    console.error("❌ CSV import error:", errors);
    return { success: false, error: errors.join("; ") };
  }

  console.log(`✅ Successfully inserted/updated ${totalInserted} records into Supabase`);
  return { success: true, inserted: totalInserted };
}
