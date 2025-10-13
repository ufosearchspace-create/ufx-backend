import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// ---------------------------
// Supabase client setup
// ---------------------------
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY;

if (!process.env.SUPABASE_URL || !supabaseKey) {
  console.error("❌ Missing Supabase credentials in geocode.js");
  console.error("SUPABASE_URL:", process.env.SUPABASE_URL);
  console.error("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.error("SUPABASE_SERVICE_KEY:", process.env.SUPABASE_SERVICE_KEY);
  console.error("SUPABASE_KEY:", process.env.SUPABASE_KEY);
  throw new Error("Supabase credentials missing.");
}

const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

// ---------------------------
// LocationIQ setup
// ---------------------------
if (!process.env.LOCATIONIQ_API_KEY) {
  throw new Error("Missing LOCATIONIQ_API_KEY in environment.");
}
const LOCATIONIQ_API_KEY = process.env.LOCATIONIQ_API_KEY;

// ---------------------------
// Main geocoding function
// ---------------------------
export async function geocodeMissing() {
  console.log("🌍 Starting geocoding for missing coordinates...");

  try {
    // Fetch reports without lat/lon
    const { data: reports, error: fetchError } = await supabase
      .from("reports")
      .select("*")
      .is("lat", null)
      .limit(100);

    if (fetchError) throw fetchError;
    if (!reports || reports.length === 0) {
      console.log("✅ No reports missing coordinates.");
      return { updated: 0 };
    }

    console.log(`🗺️ Found ${reports.length} reports missing coordinates.`);

    let updatedCount = 0;

    for (const report of reports) {
      const query = encodeURIComponent(
        `${report.city || ""}, ${report.region || ""}, France`
      );
      const url = `https://us1.locationiq.com/v1/search.php?key=${LOCATIONIQ_API_KEY}&q=${query}&format=json`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (Array.isArray(data) && data[0]) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);

          await supabase
            .from("reports")
            .update({ lat, lon })
            .eq("id", report.id);

          console.log(`📍 Updated ${report.id}: ${lat}, ${lon}`);
          updatedCount++;
        } else {
          console.warn(`⚠️ No geocode found for ${report.city || "unknown city"}`);
        }
      } catch (geoErr) {
        console.error(`❌ Geocoding failed for ${report.id}:`, geoErr.message);
      }

      // small delay to avoid rate limit
      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log(`✅ Geocoding complete. Updated ${updatedCount} records.`);
    return { updated: updatedCount };
  } catch (err) {
    console.error("❌ geocodeMissing() failed:", err.message);
    throw err;
  }
}
