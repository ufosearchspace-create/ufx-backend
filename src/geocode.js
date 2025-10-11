// src/geocode.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Popunjava koordinate (lat/lon) za zapise u tablici `reports`
 * koji imaju adresu, ali nemaju lat/lon.
 */
export async function geocodeMissing() {
  console.log("🌍 Starting geocode job…");

  const { data: rows, error } = await supabase
    .from("reports")
    .select("id, address")
    .is("lat", null)
    .limit(50);

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("✅ No missing coordinates found.");
    return { updatedCount: 0, updated: [] };
  }

  const updated = [];

  for (const r of rows) {
    if (!r.address) continue;
    const url = `${process.env.LOCATIONIQ_BASE_URL}/v1/search?key=${process.env.LOCATIONIQ_API_KEY}&q=${encodeURIComponent(
      r.address
    )}&format=json&limit=1`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const json = await resp.json();
      if (json && json[0]) {
        const lat = parseFloat(json[0].lat);
        const lon = parseFloat(json[0].lon);

        const { error: upErr } = await supabase
          .from("reports")
          .update({ lat, lon })
          .eq("id", r.id);

        if (!upErr) updated.push({ id: r.id, lat, lon });
      }
    } catch (err) {
      console.error("⚠️ Geocoding failed for", r.address, err.message);
    }
  }

  console.log(`✅ Geocoded ${updated.length} records.`);
  return { updatedCount: updated.length, updated };
}
