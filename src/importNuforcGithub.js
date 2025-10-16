// src/importNuforcGithub.js
import express from "express";
import Papa from "papaparse";
import fetch from "node-fetch";
import { supabase } from "./supabase.js";
import { ensureString, parseNumberOrNull } from "./util.js";

const router = express.Router();

/**
 * Fetch NUFORC CSV (npr. https://nuforc.org/webreports/ndxe2025.csv)
 * i uvozi zapise u Supabase -> tablica "reports"
 */
router.post("/api/import/nuforc-auto", async (req, res) => {
  const { cron_token } = req.query;
  const CRON_TOKEN = process.env.CRON_TOKEN;

  if (cron_token !== CRON_TOKEN) {
    return res.status(403).json({ success: false, error: "Invalid cron token" });
  }

  const sourceUrl = "https://nuforc.org/webreports/ndxe2025.csv";
  console.log("🚀 Starting NUFORC automatic import...");
  console.log("📦 Fetching CSV from:", sourceUrl);

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`NUFORC CSV download failed: ${response.statusText}`);
    const csvText = await response.text();

    // ✅ Automatsko prepoznavanje delimitera
    const delimiter = csvText.includes(";") ? ";" : ",";
    console.log("🔍 Detected delimiter:", delimiter);

    // 📄 Parsiranje CSV-a
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      delimiter,
    });

    const rows = parsed.data;
    console.log(`📄 Parsed ${rows.length} NUFORC records`);

    if (!rows.length) {
      return res.json({ success: true, count: 0, message: "No NUFORC data found." });
    }

    // 🧹 Pretvaranje CSV zapisa u oblik za bazu
    const cleaned = rows
      .map((r) => {
        const date = ensureString(r["Date / Time"]);
        const city = ensureString(r["City"]);
        const state = ensureString(r["State"]);
        const shape = ensureString(r["Shape"]);
        const summary = ensureString(r["Summary"]);
        const posted = ensureString(r["Posted"]);
        const duration = ensureString(r["Duration"]);

        if (!city && !summary) return null;

        return {
          date_event: date || null,
          description: summary || null,
          source: "NUFORC",
          location: [city, state].filter(Boolean).join(", "),
          latitude: null,
          longitude: null,
          shape,
          duration,
          media_url: null,
          hash: `${date}-${city}-${state}-${shape}-${summary}`.replace(/\s+/g, "_").slice(0, 255),
        };
      })
      .filter(Boolean);

    console.log(`🧹 Cleaned ${cleaned.length} valid NUFORC records`);

    if (!cleaned.length) {
      return res.json({ success: true, count: 0, message: "No valid NUFORC entries found." });
    }

    // 🧠 Uklanjanje duplikata (po hash-u)
    const unique = Object.values(
      cleaned.reduce((acc, rec) => {
        acc[rec.hash] = rec;
        return acc;
      }, {})
    );

    console.log(`✅ Ready to insert ${unique.length} unique NUFORC records`);

    const { error } = await supabase.from("reports").upsert(unique, {
      onConflict: "hash",
    });

    if (error) throw error;

    console.log(`✅ Successfully upserted ${unique.length} NUFORC records`);
    return res.json({ success: true, count: unique.length });
  } catch (err) {
    console.error("❌ NUFORC auto import error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
