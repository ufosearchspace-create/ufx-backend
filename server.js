// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from 'dotenv';

import nuforcGithubRouter from "./src/importNuforcGithub.js";
import camerasRouter from "./src/cameras.js";
import aiVerifyRouter from "./src/aiVerify.js";
import { supabase } from "./src/supabase.js";
import { isValidLat, isValidLon, adminGuard, cronGuard } from "./src/util.js";

// Učitaj environment varijable
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// ---- ENV logs (sanitizirano) ----
console.log("🧩 ENV CHECK START");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "✅ Set" : "❌ Missing");
console.log("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ Set" : "❌ Missing");
console.log("CRON_TOKEN:", process.env.CRON_TOKEN ? "✅ Set" : "❌ Missing");
console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("🧩 ENV CHECK END");

// ---- Health check endpoint ----
app.get("/health", (req, res) => res.json({ 
  status: "healthy",
  timestamp: new Date().toISOString()
}));

// ---- Reports: GET (list with filters) ----
app.get("/api/reports", async (req, res) => {
  try {
    const {
      limit = 100,
      offset = 0,
      start_date,
      end_date,
      search,
      shape,
      sort = "date_event",
      order = "desc"
    } = req.query;

    let query = supabase
      .from("reports")
      .select("*", { count: "exact" });

    // Primjeni filtere ako postoje
    if (start_date) {
      query = query.gte('date_event', start_date);
    }
    if (end_date) {
      query = query.lte('date_event', end_date);
    }
    if (search) {
      query = query.textSearch('description_search', search);
    }
    if (shape) {
      query = query.eq('shape', shape.toLowerCase());
    }

    // Sortiranje i paginacija
    const limitNum = Math.min(parseInt(limit, 10), 1000);
    const offsetNum = parseInt(offset, 10);
    
    query = query
      .order(sort, { ascending: order === 'asc' })
      .range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count,
      data
    });
  } catch (err) {
    console.error("GET /api/reports error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ---- Reports: GET (nearby with combined filters) ----
app.get("/api/reports/nearby", async (req, res) => {
  try {
    const { 
      lat, 
      lon, 
      radius = 50,
      start_date,
      end_date,
      search,
      shape
    } = req.query;
    
    if (!lat || !lon) {
      return res.status(400).json({
        success: false,
        error: "Latitude and longitude are required"
      });
    }

    let query = supabase.rpc('find_reports_within_radius', {
      p_latitude: parseFloat(lat),
      p_longitude: parseFloat(lon),
      p_radius_km: parseFloat(radius)
    });

    // Dodatni filteri
    if (start_date) {
      query = query.gte('date_event', start_date);
    }
    if (end_date) {
      query = query.lte('date_event', end_date);
    }
    if (search) {
      query = query.textSearch('description_search', search);
    }
    if (shape) {
      query = query.eq('shape', shape.toLowerCase());
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      data
    });
  } catch (err) {
    console.error('Error in nearby search:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ---- Reports: POST (user submit) ----
app.post("/api/reports", async (req, res) => {
  try {
    const {
      description,
      latitude,
      longitude,
      location,
      media_url,
      thumbnail_url,
      date_event,
      shape,
      duration
    } = req.body || {};

    // Validacija
    if (!description || typeof description !== "string") {
      return res.status(400).json({
        success: false,
        error: "Description is required"
      });
    }
    if (latitude != null && !isValidLat(latitude)) {
      return res.status(400).json({
        success: false,
        error: "Invalid latitude"
      });
    }
    if (longitude != null && !isValidLon(longitude)) {
      return res.status(400).json({
        success: false,
        error: "Invalid longitude"
      });
    }

    const payload = {
      description,
      lat: latitude ?? null,
      lon: longitude ?? null,
      address: location ?? null,
      media_url: media_url ?? null,
      thumbnail_url: thumbnail_url ?? null,
      date_event: date_event ? new Date(date_event).toISOString() : new Date().toISOString(),
      source_name: "USER",
      source_type: "USER",
      shape: shape?.toLowerCase() ?? null,
      duration: duration ?? null,
      verified_by_ai: false
    };

    const { data, error } = await supabase
      .from("reports")
      .insert([payload])
      .select();

    if (error) throw error;

    res.json({
      success: true,
      data: data[0]
    });
  } catch (err) {
    console.error("POST /api/reports error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ---- Reports: GET (single) ----
app.get("/api/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Report not found"
      });
    }

    res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error(`GET /api/reports/${req.params.id} error:`, err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ---- Reports: Stats ----
app.get("/api/reports/stats/summary", async (req, res) => {
  try {
    const { data: shapes, error: shapesError } = await supabase
      .from('reports')
      .select('shape')
      .not('shape', 'is', null);

    const { data: total, error: totalError } = await supabase
      .from('reports')
      .select('id', { count: 'exact' });

    const { data: recent, error: recentError } = await supabase
      .from('reports')
      .select('id', { count: 'exact' })
      .gte('date_event', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (shapesError || totalError || recentError) throw error;

    // Grupiranje po oblicima
    const shapeStats = shapes.reduce((acc, curr) => {
      if (curr.shape) {
        acc[curr.shape] = (acc[curr.shape] || 0) + 1;
      }
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        total: total.length,
        recent: recent.length,
        shapes: shapeStats
      }
    });
  } catch (err) {
    console.error("GET /api/reports/stats/summary error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ---- Import routes ----
app.use("/api/import", nuforcGithubRouter);

// ---- Camera routes ----
app.use("/api/cameras", camerasRouter);

// ---- AI verification routes ----
app.use("/api", aiVerifyRouter);

// ---- Error handling middleware ----
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`✅ UFX backend running on port ${PORT}`);
  console.log("     ==> Your service is live 🎉");
  console.log("     ==> ");
  console.log("     ==> ///////////////////////////////////////////////////////////");
  console.log("     ==> ");
  console.log("     ==> Available at your primary URL https://ufx-backend-1.onrender.com");
  console.log("     ==> ");
  console.log("     ==> ///////////////////////////////////////////////////////////");
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Closing HTTP server...');
  app.close(() => {
    console.log('HTTP server closed');
  });
});