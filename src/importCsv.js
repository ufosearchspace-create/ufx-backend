// src/importCsv.js
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- MAPPERS -------------------------------------------------------------

// GEIPAN – tipični FR headere iz exporta
function mapGeipanFR(row) {
  const d = row["Date d'observation"] || row["DateObservation"] || row["date"] || null;
  const city = row["Lieu"] || row["Ville"] || row["city"] || null;
  const desc = row["Résumé"] || row["Resume"] || row["summary"] || row["Description"] || null;
  const cls = row["Classification"] || row["class"] || null;
  const lat = parseFloat(row["Latitude"] ?? row["lat"]);
  const lon = parseFloat(row["Longitude"] ?? row["lon"]);

  return {
    source_name: "GEIPAN",
    source_url: row["url"] || row["URL"] || null,
    event_date: d || null,
    city,
    country: row["Pays"] || "France",
    description: desc,
    classification: cls,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    year: d ? new Date(d).getFullYear() : null,
  };
}

// NUFORC – česti headere (ako ti ikad zatreba preko ovog uvoza)
function mapNuforc(row) {
  const d = row.datetime || row.date_time || row.date || null;
  const lat = parseFloat(row.latitude ?? row.lat);
  const lon = parseFloat(row.longitude ?? row.lon);
  return {
    source_name: "NUFORC",
    source_url: "https://nuforc.org",
    event_date: d || null,
    city: row.city || null,
    country: row.country || null,
    description: row.summary || row.comments || row.description || null,
    shape: row.shape || null,
    duration: row.duration || null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    year: d ? new Date(d).getFullYear() : null,
  };
}

// “Default” – pokuša pogoditi tipične kolone eng/fr
function mapAuto(row) {
  // heuristike
  const d =
    row.date ||
    row.datetime ||
    row["Date d'observation"] ||
    row.Date ||
    null;

  const city = row.city || row.ville || row["Lieu"] || null;
  const desc = row.description || row.summary || row["Résumé"] || null;

  const lat = parseFloat(row.lat ?? row.latitude ?? row.Latitude);
  const lon = parseFloat(row.lon ?? row.longitude ?? row.Longitude);

  return {
    source_name: row.source_name || "CSV",
    source_url: row.url || row.URL || null,
    event_date: d || null,
    city,
    country: row.country || row.pays || null,
    description: desc,
    classification: row.classification || row["Classification"] || null,
    shape: row.shape || null,
    duration: row.duration || null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    year: d ? new Date(d).getFullYear() : null,
  };
}

const MAPPERS = {
  geipan_fr: mapGeipanFR,
  nuforc: mapNuforc,
  auto: mapAuto,
};

// --- MAIN ---------------------------------------------------------------

export async function importCsvFromUrl({ url, source_name = null, mapping = "auto", batchSize = 500 }) {
  if (!url) throw new Error("Missing 'url'");

  console.log(`🔗 Fetching CSV: ${url}`);
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "UFX-Backend/1.0",
      Accept: "text/csv,application/octet-stream",
      Referer: "https://github.com/",
    },
  });
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);

  const text = await resp.text();
  const rows = parse(text, { columns: true, skip_empty_lines: true });

  if (!rows.length) throw new Error("CSV is empty");

  const mapper = MAPPERS[mapping] || MAPPERS.auto;

  const records = rows.map((r) => {
    const base = mapper(r);
    return {
      ...base,
      // dozvoli override source_name kroz body
      source_name: source_name || base.source_name || "CSV",
    };
  });

  console.log(`🧮 Parsed: ${records.length} rows. Inserting in batches of ${batchSize}...`);

  for (let i = 0; i < records.length; i += batchSize) {
    const chunk = records.slice(i, i + batchSize);
    const { error } = await supabase.from("reports").insert(chunk);
    if (error) {
      console.error("❌ Supabase insert error:", error);
      // nastavi dalje, ali možeš i throw ako želiš hard-fail:
      // throw error;
    }
    console.log(`📦 Batch ${i / batchSize + 1} inserted (${chunk.length})`);
  }

  console.log(`✅ CSV import finished (${records.length} rows)`);
  return { imported: records.length };
}
