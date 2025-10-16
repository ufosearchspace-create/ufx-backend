// src/importNuforcGithub.js
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import { createHash } from "crypto";
import { supabase } from "./supabase.js";
import { ensureString, parseNumberOrNull } from "./util.js";

/**
 * Koristimo GitHub mirror NUFORC-a od Timothy Renner-a
 * (stabilan CSV, bez scrapanja i rate-limit problema).
 */
const NUFORC_GH_CSV =
  "https://raw.githubusercontent.com/timothyrenner/nuforc_sightings_data/master/data/nuforc_reports.csv";

// Batch veličina kako ne bi opteretili PostgREST
const BATCH_SIZE = 500;

export async function importNuforcGithub() {
  console.log("🚀 Starting NUFORC GitHub import...");
  console.log("📦 Fetching CSV:", NUFORC_GH_CSV);

  const resp = await fetch(NUFORC_GH_CSV, { timeout: 30000 });
  if (!resp.ok) throw new Error(`NUFORC CSV fetch failed with status ${resp.status}`);
  const text = await resp.text();

  // CSV je coma-delimited i uvijek ima header
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  console.log(`📄 Parsed ${rows.length} NUFORC rows`);

  // Očekivana polja (po datasetu):
  // date_time, city, state, country, shape, duration, summary, report_link, posted, city_latitude, city_longitude
  const mapped = [];
  for (const r of rows) {
    const date_event = ensureString(r.date_time).trim() || null;
    const description = ensureString(r.summary).trim() || null;

    // Ako baš nema opisa, preskoči — ne želimo prazne zapise
    if (!description) continue;

    const city = ensureString(r.city).trim() || null;
    const state = ensureString(r.state).trim() || null;
    const country = ensureString(r.country).trim() || null;
    const shape = ensureString(r.shape).trim() || null;
    const duration = ensureString(r.duration).trim() || null;
    const report_link = ensureString(r.report_link).trim() || null;
    const latitude = parseNumberOrNull(r.city_latitude);
    const longitude = parseNumberOrNull(r.city_longitude);

    const location = [city, state, country].filter(Boolean).join(", ") || null;

    // Stabilan hash za dedupe — koristimo kombinaciju izvora i ključnih polja:
    const hash = createHash("sha256")
      .update(`nuforc|${date_event || ""}|${latitude || ""}|${longitude || ""}|${description}`)
      .digest("hex");

    mapped.push({
      source: "nuforc",
      source_type: "external",
      ref_id: report_link || null, // kasnije može pomoći za deep-link
      date_event,
      description,
      city,
      state,
      country,
      shape,
      duration,
      latitude,
      longitude,
      location,
      image_url: null,   // NUFORC nema slike (ostavljamo null)
      hash
    });
  }

  console.log(`🧹 Cleaned ${mapped.length} valid NUFORC records`);

  // Upsert u batch-evima s onConflict: 'hash'
  let insertedTotal = 0;
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const chunk = mapped.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("reports").upsert(chunk, { onConflict: "hash" });
    if (error) {
      console.error("❌ Upsert chunk error:", error);
      throw error;
    }
    insertedTotal += chunk.length;
  }

  console.log(`✅ Upserted ${insertedTotal} NUFORC rows (dedup via hash)`);
  return { count: insertedTotal };
}
