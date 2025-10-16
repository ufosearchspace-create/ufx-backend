// src/importNuforcGithub.js
import express from 'express';
import { parse } from 'csv-parse';
import fetch from 'node-fetch';
import { supabase } from './supabase.js';
import { cronGuard } from './util.js';

const router = express.Router();

// Pomoćna funkcija za pretvaranje datuma
const parseDate = (dateStr) => {
  try {
    return new Date(dateStr).toISOString();
  } catch (e) {
    return null;
  }
};

// Pomoćna funkcija za čišćenje teksta
const cleanText = (text) => {
  if (!text) return null;
  return text.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
};

// Glavna funkcija za import podataka
const importNuforcData = async () => {
  try {
    console.log("🛸 Starting NUFORC import...");
    
    // URL NUFORC CSV datoteke (example URL - trebat ćete pravi URL)
    const csvUrl = "https://raw.githubusercontent.com/data-world-ufo/nuforc-reports/main/nuforc_reports.csv";
    
    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.statusText}`);
    
    const records = [];
    let processedCount = 0;
    
    // Parsiranje CSV-a
    const parser = parse({
      columns: true,
      skip_empty_lines: true
    });

    parser.on('readable', async () => {
      let record;
      while ((record = parser.read()) !== null) {
        try {
          const cleanRecord = {
            date_event: parseDate(record.date_time),
            city: cleanText(record.city),
            state: cleanText(record.state),
            country: cleanText(record.country),
            shape: cleanText(record.shape),
            duration: cleanText(record.duration),
            description: cleanText(record.text),
            lat: parseFloat(record.latitude) || null,
            lon: parseFloat(record.longitude) || null,
            source_name: "NUFORC",
            source_type: "HISTORICAL",
            original_id: record.nuforc_id || null,
            verified_by_ai: false
          };

          if (cleanRecord.date_event) {
            records.push(cleanRecord);
          }

          processedCount++;
          if (records.length >= 1000) {
            // Batch insert svakih 1000 zapisa
            const { error } = await supabase
              .from('reports')
              .upsert(records, {
                onConflict: 'original_id',
                ignoreDuplicates: true
              });
            
            if (error) throw error;
            records.length = 0; // Clear array
            console.log(`Processed ${processedCount} records...`);
          }
        } catch (err) {
          console.error("Error processing record:", err);
        }
      }
    });

    // Završna obrada preostalih zapisa
    parser.on('end', async () => {
      if (records.length > 0) {
        try {
          const { error } = await supabase
            .from('reports')
            .upsert(records, {
              onConflict: 'original_id',
              ignoreDuplicates: true
            });
          
          if (error) throw error;
        } catch (err) {
          console.error("Error in final batch:", err);
        }
      }
      console.log(`✅ Import completed. Total processed: ${processedCount}`);
    });

    // Stream CSV podaci u parser
    response.body.pipe(parser);

  } catch (err) {
    console.error("❌ Import failed:", err);
    throw err;
  }
};

// API rute
router.get('/nuforc', cronGuard, async (req, res) => {
  try {
    await importNuforcData();
    res.json({ success: true, message: "NUFORC import started" });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

export default router;