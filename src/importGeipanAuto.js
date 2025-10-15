// src/importGeipanAuto.js
import fetch from "node-fetch";
import { importCsvFromUrl } from "./importCsv.js";

export async function importGeipanAuto() {
  try {
    console.log("🚀 Starting GEIPAN automatic import...");

    // ✅ Fiksni CSV URL (ručno se mijenja kad GEIPAN objavi novu verziju)
    const csvUrl =
      "https://www.cnes-geipan.fr/sites/default/files/save_json_import_files/export_cas_pub_20250821093454.csv";

    console.log("📦 Using fixed GEIPAN CSV:", csvUrl);

    // Validacija dostupnosti CSV-a
    const checkResponse = await fetch(csvUrl, { method: "HEAD" });
    if (!checkResponse.ok) {
      throw new Error(`GEIPAN CSV not reachable (${checkResponse.status})`);
    }

    console.log("🔗 Fetching and importing CSV...");
    const result = await importCsvFromUrl({
      url: csvUrl,
      source_name: "GEIPAN",
      mapping: {
        case_id: 0,
        location: 1,
        date: 2,
        departement: 3,
        region: 6,
        description: 7,
        classification: 11,
        update_date: 12,
        source: 13,
      },
    });

    console.log(`✅ GEIPAN import finished: ${result.inserted || 0} records`);
    return result;
  } catch (error) {
    console.error("❌ GEIPAN auto import error:", error);
    return { success: false, error: error.message };
  }
}
