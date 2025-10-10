// src/importGeipan.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEIPAN_FEED = "https://www.cnes-geipan.fr/geipan-cases.json";

export async function importGeipan() {
  console.log("🚀 Starting GEIPAN import...");

  const response = await fetch(GEIPAN_FEED, {
    headers: { "User-Agent": "UFX-Backend/1.0 (+https://ufxproject-site.vercel.app)" },
  });

  if (!response.ok) throw new Error(`GEIPAN API error: ${response.statusText}`);

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("GEIPAN feed returned no data");
  }

  const records = data.map((c) => ({
    source_name: "GEIPAN",
    source_url: c.url || null,
    event_date: c.dateObservation || null,
    city: c.ville || null,
    country: "France",
    description: c.resume || null,
    classification: c.classification || null,
    lat: c.latitude || null,
    lon: c.longitude || null,
    year: c.dateObservation
      ? new Date(c.dateObservation).getFullYear()
      : null,
  }));

  const { error } = await supabase.from("reports").upsert(records);
  if (error) console.error("❌ Supabase insert error:", error);

  console.log(`✅ GEIPAN import completed (${records.length} rows)`);
  return records.length;
}
