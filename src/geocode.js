import cron from "node-cron";
import fetch from "node-fetch";

export function setupInAppCron(app) {
  console.log("✅ In-app geocode cron initialized (runs at 04:00 and 16:00 daily)");

  // Pokreće se svakih 12 sati (04:00 i 16:00)
  cron.schedule("0 4,16 * * *", async () => {
    const backendUrl = process.env.RENDER_EXTERNAL_URL || "http://localhost:10000";
    const token = process.env.CRON_TOKEN || "ufx2025secure!";
    const target = `${backendUrl}/api/geocode?cron_token=${token}`;

    console.log(`🌍 Triggering geocode job: ${target}`);

    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: process.env.REPORTS_TABLE || "reports" })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log("✅ Geocode cron executed successfully");
    } catch (err) {
      console.error("❌ Geocode cron failed:", err.message);
    }
  });
}
