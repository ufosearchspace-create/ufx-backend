// server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from 'dotenv';

import nuforcGithubRouter from "./src/importNuforcGithub.js";
import camerasRouter from "./src/cameras.js";
import aiVerifyRouter from "./src/aiVerify.js";
import sightingsRouter from "./src/routes/reports.js";
import authRouter from "./src/routes/auth.js";
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

// Helper funkcije za datum
const isValidDate = (dateString) => {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date) && date.toISOString() !== null;
};

const formatDate = (dateString) => {
  if (!dateString) return null;
  try {
    // Pokušaj parsirati datum
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (e) {
    console.error("Date parsing error:", e);
    return null;
  }
};

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
    if (start_date && isValidDate(start_date)) {
      query = query.gte('date_event', formatDate(start_date));
    }
    if (end_date && isValidDate(end_date)) {
      query = query.lte('date_event', formatDate(end_date));
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
      data: data.map(item => ({
        ...item,
        date_event: formatDate(item.date_event) || formatDate(item.date) || null
      }))
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
    if (start_date && isValidDate(start_date)) {
      query = query.gte('date_event', formatDate(start_date));
    }
    if (end_date && isValidDate(end_date)) {
      query = query.lte('date_event', formatDate(end_date));
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
      data: data.map(item => ({
        ...item,
        date_event: formatDate(item.date_event) || formatDate(item.date) || null
      }))
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

    const formattedDate = formatDate(date_event) || new Date().toISOString();

    const payload = {
      description,
      lat: latitude ?? null,
      lon: longitude ?? null,
      address: location ?? null,
      media_url: media_url ?? null,
      thumbnail_url: thumbnail_url ?? null,
      date_event: formattedDate,
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
      data: {
        ...data,
        date_event: formatDate(data.date_event) || formatDate(data.date) || null
      }
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
    // Osnovni brojač
    const { count: total } = await supabase
      .from('reports')
      .select('*', { count: 'exact' });

    // Zadnjih 30 dana
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { count: recent } = await supabase
      .from('reports')
      .select('*', { count: 'exact' })
      .gte('date_event', thirtyDaysAgo.toISOString());

    // Brojanje po oblicima
    const { data: shapes } = await supabase
      .from('reports')
      .select('shape')
      .not('shape', 'is', null);

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
        total,
        recent: recent || 0,
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

// ---- Reports: Detailed Stats ----
app.get("/api/reports/stats/detailed", async (req, res) => {
  try {
    // Osnovni podaci
    const { count: total } = await supabase
      .from('reports')
      .select('*', { count: 'exact' });

    // Statistika po datumima (samo valjani datumi)
    const { data: dateStats } = await supabase
      .from('reports')
      .select('date_event')
      .not('date_event', 'is', null)
      .gte('date_event', '1900-01-01')
      .lte('date_event', '2100-01-01');

    // Grupiranje po vremenskim periodima
    const timeStats = dateStats.reduce((acc, curr) => {
      try {
        if (!curr.date_event) return acc;
        
        const date = new Date(curr.date_event);
        if (isNaN(date.getTime())) return acc;
        
        const hour = date.getUTCHours();
        const period = 
          hour >= 5 && hour < 12 ? 'morning' :
          hour >= 12 && hour < 17 ? 'afternoon' :
          hour >= 17 && hour < 21 ? 'evening' : 'night';
        
        acc[period] = (acc[period] || 0) + 1;
      } catch (e) {
        console.error('Error processing date:', curr.date_event);
      }
      return acc;
    }, {});

    // Statistika po oblicima
    const { data: shapeStats } = await supabase
      .from('reports')
      .select('shape')
      .not('shape', 'is', null);

    const shapes = shapeStats.reduce((acc, curr) => {
      if (curr.shape) {
        acc[curr.shape] = (acc[curr.shape] || 0) + 1;
      }
      return acc;
    }, {});

    // Brojanje lokacija i medija
    const { count: withLocation } = await supabase
      .from('reports')
      .select('*', { count: 'exact' })
      .not('lat', 'is', null)
      .not('lon', 'is', null);

    const { count: withMedia } = await supabase
      .from('reports')
      .select('*', { count: 'exact' })
      .not('media_url', 'is', null);

    // Zadnjih 30 dana
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { count: recent } = await supabase
      .from('reports')
      .select('*', { count: 'exact' })
      .gte('date_event', thirtyDaysAgo.toISOString());

    res.json({
      success: true,
      data: {
        total,
        recent: recent || 0,
        shapes,
        timeDistribution: timeStats,
        withLocation: withLocation || 0,
        withMedia: withMedia || 0
      }
    });
  } catch (err) {
    console.error("GET /api/reports/stats/detailed error:", err);
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

// ---- Sightings routes ----
app.use("/api/sightings", sightingsRouter);

// ---- Auth routes ----
app.use("/api/auth", authRouter);

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
