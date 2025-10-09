import { Router } from "express";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// 🔹 inicijalizacija Supabase klijenta
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🔹 test ruta
router.get("/", (req, res) => {
  res.json({ ok: true, message: "UFX backend online" });
});

// 🔹 1️⃣ /api/report – upis jednog zapisa
router.post("/report", async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: "Missing body" });

    const { error } = await supabase.from(process.env.REPORTS_TABLE).insert(data);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error("Error /report:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 2️⃣ /api/import – bulk upsert (više redaka odjednom)
router.post("/import", async (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: "Body must be array" });

    const { error } = await supabase
      .from(process.env.REPORTS_TABLE)
      .upsert(items, { onConflict: ["id"] });

    if (error) throw error;
    res.json({ success: true, count: items.length });
  } catch (err) {
    console.error("Error /import:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 3️⃣ /api/geocode – geokodiranje pomoću LocationIQ
router.post("/geocode", async (req, res) => {
  try {
    const token = req.query.cron_token;
    if (token !== process.env.CRON_TOKEN)
      return res.status(401).json({ error: "Invalid token" });

    const { data: missing, error } = await supabase
      .from(process.env.REPORTS_TABLE)
      .select("*")
      .is("lat", null)
      .limit(50);

    if (error) throw error;

    if (!missing || missing.length === 0)
      return res.json({ message: "No records to geocode" });

    const updated = [];

    for (const row of missing) {
      if (!row.address) continue;

      const query = new URLSearchParams({
        key: process.env.LOCATIONIQ_API_KEY,
        q: row.address,
        format: "json",
      });

      try {
        const resp = await fetch(
          `${process.env.LOCATIONIQ_BASE_URL}/v1/search.php?${query}`
        );
        const results = await resp.json();
        if (results && results[0]) {
          const { lat, lon } = results[0];
          await supabase
            .from(process.env.REPORTS_TABLE)
            .update({ lat, lon })
            .eq("id", row.id);
          updated.push({ id: row.id, lat, lon });
        }
      } catch (e) {
        console.error(`Geocode failed for ${row.id}:`, e.message);
      }
    }

    res.json({ updatedCount: updated.length, updated });
  } catch (err) {
    console.error("Error /geocode:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
