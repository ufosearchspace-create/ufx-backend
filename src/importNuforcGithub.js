// src/importNuforcGithub.js
import express from 'express';
import { parse } from 'csv-parse';
import fetch from 'node-fetch';
import { supabase } from './supabase.js';
import { cronGuard } from './util.js';

const router = express.Router();

// KONFIGURACIJA
const CONFIG = {
  CSV_URL: "https://corgis-edu.github.io/corgis/datasets/csv/ufo_sightings/ufo_sightings.csv",
  BATCH_SIZE: 500,
  TEST_LIMIT: 100
};

// Pretvara datum u ISO format
const parseDate = (dateStr) => {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (e) {
    return null;
  }
};

// Sastavlja datum iz komponenata
const buildDate = (year, month, day, hour, minute) => {
  try {
    if (!year || !month || !day) return null;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour || 0).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}:00Z`;
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date.toISOString();
  } catch (e) {
    return null;
  }
};

// Čisti tekst
const cleanText = (text) => {
  if (!text || typeof text !== 'string') return null;
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// Parsira koordinate
const parseCoordinate = (value) => {
  if (!value) return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
};

// Kombinira city, state, country
const buildAddress = (city, state, country) => {
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
};

// GLAVNA IMPORT FUNKCIJA
const importNuforcData = async (testMode = false) => {
  return new Promise(async (resolve, reject) => {
    try {
      console.log("🛸 ========================================");
      console.log("🛸 Starting NUFORC import...");
      console.log(`🛸 Mode: ${testMode ? 'TEST (100 records)' : 'FULL IMPORT'}`);
      console.log("🛸 ========================================");
      
      const response = await fetch(CONFIG.CSV_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch CSV: ${response.status}`);
      }
      
      console.log("✅ CSV file fetched successfully");

      let records = [];
      let processedCount = 0;
      let insertedCount = 0;
      let errorCount = 0;
      const startTime = Date.now();

      const parser = parse({
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true
      });

      parser.on('data', (record) => {
        try {
          if (testMode && processedCount >= CONFIG.TEST_LIMIT) {
            console.log("🧪 Test limit reached, forcing end...");
            parser.pause();
            
            // Ručno triggeruj 'end' event
            setImmediate(() => {
              parser.emit('end');
            });
            
            return;
          }

          // CORGIS dataset ima nested field names sa tačkama
          const city = cleanText(record['Location.City']);
          const state = cleanText(record['Location.State']);
          const country = cleanText(record['Location.Country']) || 'USA';
          
          const cleanRecord = {
            date_event: buildDate(
              record['Dates.Sighted.Year'],
              record['Dates.Sighted.Month'],
              record['Date.Sighted.Day'],
              record['Dates.Sighted.Hour'],
              record['Dates.Sighted.Minute']
            ),
            city: city,
            state: state,
            country: country,
            address: buildAddress(city, state, country),
            shape: cleanText(record['Data.Shape'])?.toLowerCase(),
            duration: cleanText(record['Data.Encounter duration']),
            description: cleanText(record['Data.Description excerpt']),
            lat: parseCoordinate(record['Location.Coordinates.Latitude ']),
            lon: parseCoordinate(record['Location.Coordinates.Longitude ']),
            source_name: "NUFORC",
            source_type: "HISTORICAL",
            original_id: `corgis_${processedCount}`,
            verified_by_ai: false
          };

          if (cleanRecord.date_event) {
            records.push(cleanRecord);
            if (processedCount < 3) {
              console.log("✅ Record ACCEPTED:", {
                city: cleanRecord.city,
                date: cleanRecord.date_event,
                shape: cleanRecord.shape
              });
            }
          }

          processedCount++;

          if (processedCount % 1000 === 0) {
            console.log(`📊 Progress: ${processedCount} records processed...`);
          }

        } catch (err) {
          errorCount++;
          console.error("❌ Error processing record:", err.message);
        }

        if (records.length >= CONFIG.BATCH_SIZE) {
          parser.pause();
          
          insertBatch(records)
            .then((count) => {
              insertedCount += count;
              records = [];
              parser.resume();
            })
            .catch((err) => {
              console.error("❌ Batch insert error:", err.message);
              parser.resume();
            });
        }
      });

      parser.on('error', (err) => {
        console.error("❌ Parser error:", err);
        reject(err);
      });

      parser.on('end', async () => {
        console.log("📦 Stream ended, processing final batch...");
        
        if (records.length > 0) {
          try {
            const count = await insertBatch(records);
            insertedCount += count;
          } catch (err) {
            console.error("❌ Final batch error:", err.message);
          }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log("🛸 ========================================");
        console.log("✅ NUFORC IMPORT COMPLETED!");
        console.log(`📊 Total processed: ${processedCount}`);
        console.log(`✅ Successfully inserted: ${insertedCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log(`⏱️  Duration: ${duration}s`);
        console.log("🛸 ========================================");

        resolve({
          processed: processedCount,
          inserted: insertedCount,
          errors: errorCount,
          duration: duration
        });
      });

      response.body.pipe(parser);
      console.log("🔍 DEBUG - Stream piped to parser");

    } catch (err) {
      console.error("❌ Import failed:", err);
      reject(err);
    }
  });
};

// BATCH INSERT
const insertBatch = async (records) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .upsert(records, {
        onConflict: 'original_id',
        ignoreDuplicates: false
      })
      .select();

    if (error) {
      console.error("Supabase error:", error.message);
      throw error;
    }

    console.log(`✅ Inserted batch: ${data?.length || 0} records`);
    return data?.length || 0;
    
  } catch (err) {
    console.error("❌ insertBatch error:", err.message);
    throw err;
  }
};

// API RUTE

// PUNI IMPORT
router.get('/nuforc', cronGuard, async (req, res) => {
  try {
    console.log("🚀 Full NUFORC import triggered");
    
    importNuforcData(false)
      .then(result => console.log("Import finished:", result))
      .catch(err => console.error("Import failed:", err));

    res.json({ 
      success: true, 
      message: "NUFORC full import started in background"
    });
    
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// TEST IMPORT
router.get('/nuforc-test', async (req, res) => {
  try {
    console.log("🧪 Test NUFORC import triggered");
    
    const result = await importNuforcData(true);
    
    res.json({ 
      success: true, 
      message: "NUFORC test import completed",
      result: result
    });
    
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// STATUS CHECK
router.get('/status', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    res.json({
      success: true,
      total_reports: count,
      database: "connected"
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

export default router;
