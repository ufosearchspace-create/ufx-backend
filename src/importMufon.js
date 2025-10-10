import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Open dataset (public CSV)
const MUFON_CSV = "https://query.data.world/s/2h22e4xv6np3uh5igvtnlhp7kpajvm";

export async function importMufon() {
  console.log("🚀 Starting MUFON import...");

  const response = await fetch(MUFON_CSV);
  const text = await response.text();
  const rows = text.split("\n").slice(1); // skip header

  const parsed = rows.map((r) => {
    const cols = r.split(",");
    return {
      source_name: "MUFON",
      source_url: "https://data.world/timothyrenner/ufo-sightings",
      event_date: cols[0] || null,
      city: cols[1] || null,
      country: cols[2] || null,
      shape: cols[4] || null,
      duration: cols[5] || null,
      description: cols[6] || null,
      lat: parseFloat(cols[7]),
      lon: parseFloat(cols[8]),
      year: parseInt(cols[0]?.split("-")[0]) || null,
    };
  }).filter(r => r.lat && r.lon);

  const batchSize = 1000;
  for (let i = 0; i < parsed.length; i += batchSize) {
    const batch = parsed.slice(i, i + batchSize);
    await supabase.from("reports").upsert(batch);
    console.log(`📦 Imported batch ${i}/${parsed.length}`);
  }

  await supabase.from("imports_log").insert({
    source_name: "MUFON",
    total_imported: parsed.length,
    status: "completed",
  });

  console.log(`✅ MUFON import completed (${parsed.length} rows)`);
}
