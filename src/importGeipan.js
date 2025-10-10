// src/importGeipan.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEIPAN_API = "https://www.cnes-geipan.fr/api/v1/cases?lang=en&page=";

export async function importGeipan() {
  console.log("🚀 Starting GEIPAN import...");

  let page = 1;
  let totalImported = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(`${GEIPAN_API}${page}&itemsPerPage=100`);
    if (!response.ok) throw new Error(`GEIPAN API error: ${response.statusText}`);

    const data = await response.json();
    const cases = data["hydra:member"];

    if (!cases || cases.length === 0) {
      hasMore = false;
      break;
    }

    const records = cases.map((c) => ({
      source_name: "GEIPAN",
      source_url: c.caseFile,
      event_date: c.observationDate || null,
      city: c.city || null,
      country: "France",
      description: c.summary || null,
      classification: c.classification || null,
      lat: c.latitude || null,
      lon: c.longitude || null,
      year: c.observationDate ? new Date(c.observationDate).getFullYear() : null,
    }));

    const { error } = await supabase.from("reports").upsert(records);
    if (error) console.error("❌ Supabase insert error:", error);

    totalImported += records.length;
    console.log(`📦 Imported ${records.length} records from page ${page}`);
    page++;
  }

  console.log(`✅ GEIPAN import completed (${totalImported} rows)`);
  return totalImported;
}
