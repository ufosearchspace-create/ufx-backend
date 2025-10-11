// src/importGeipanAuto.js
import fetch from "node-fetch";
import { load } from "cheerio";
import { importCsvFromUrl } from "./importCsv.js";

export async function importGeipanAuto() {
  console.log("🔍 Fetching latest GEIPAN export link…");

  const pageResp = await fetch("https://www.cnes-geipan.fr/en/search/cas", {
    headers: {
      "User-Agent": "UFX-Backend/1.0",
      Accept: "text/html",
    },
  });

  if (!pageResp.ok) {
    throw new Error(`Failed to load GEIPAN page: ${pageResp.status} ${pageResp.statusText}`);
  }

  const html = await pageResp.text();
  const $ = load(html);

  // pokušaj pronaći link s 'export_cas_pub_'
  let csvHref = $('a[href*="export_cas_pub_"]').attr("href");

  // ako nije pronađen iz prve, traži bilo koji .csv link koji sadrži 'export_cas_pub_'
  if (!csvHref) {
    $('a').each((_, a) => {
      const h = $(a).attr("href") || "";
      if (!csvHref && /\.csv(\?|$)/i.test(h) && h.includes("export_cas_pub_")) csvHref = h;
    });
  }

  if (!csvHref) throw new Error("CSV link not found on GEIPAN page");

  const csvUrl = csvHref.startsWith("http")
    ? csvHref
    : `https://www.cnes-geipan.fr${csvHref}`;

  console.log("📦 Latest GEIPAN CSV:", csvUrl);

  return await importCsvFromUrl({
    url: csvUrl,
    source_name: "GEIPAN",
    mapping: "geipan_fr",
    batchSize: 500,
  });
}
