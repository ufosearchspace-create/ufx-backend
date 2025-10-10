// src/importGeipan.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Novi open-data mirror GEIPAN baze (radi bez tokena i blokada)
const GEIPAN_FEED =
  "https://www.data.gouv.fr/fr/datasets/r/ef06eabe-f7a7-4f9c-8c60-43a2e7a88d1c";

export async function importGeipan() {
  console.log("🚀 Starting GEIPAN import...");

  const response = await fetch(GEIPAN_FEED, {
    headers: {
      "User-Agent": "UFX-Backend/1.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`GEIPAN API error: ${response.statusText}`);
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("GEIPAN feed returned no data");
  }

  const records = data.map((c) => ({
    source_name: "GEIPAN",
    source_url: c.url || null,
    event_date: c["Date d'observation"] || null,
    city: c["Lieu"] || null,
    country: "France",
    description: c["Résumé"] || null,
    classification: c["Classification"] || null,
    lat: parseFloat(c["Latitude"]) || null,
    lon: parseFloat(c["Longitude"]) || null,
    year: c["Date d'observation"]
      ? new Date(c["Date d'observation"]).getFullYear()
      : null,
  }));

  // ✅ Sigurni batch import (da Render ne padne)
  const batchSize = 400;
  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    const { error } = await supabase.from("reports").upsert(chunk);
    if (error) console.error("❌ Supabase insert error:", error);
    console.log(`📦 Imported batch ${i / batchSize + 1}`);
  }

  console.log(`✅ GEIPAN import completed (${records.length} rows)`);
  return records.length;
}
