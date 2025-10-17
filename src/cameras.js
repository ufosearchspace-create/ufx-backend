// src/cameras.js
import express from "express";
import { supabase } from "./supabase.js";
import { adminGuard, isValidLat, isValidLon } from "./util.js";

const router = express.Router();

/**
 * GET /api/cameras
 * Public listing aktivnih kamera
 */
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("cameras")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ success: true, count: data?.length || 0, data });
  } catch (err) {
    console.error("GET /api/cameras error:", err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

/**
 * GET /api/cameras/nearby
 * Kamere u blizini određene lokacije
 * Query params: lat, lon, radius (km, default 50)
 */
router.get("/nearby", async (req, res) => {
  try {
    const { lat, lon, radius = 50 } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({
        success: false,
        error: "lat and lon are required"
      });
    }

    if (!isValidLat(lat) || !isValidLon(lon)) {
      return res.status(400).json({
        success: false,
        error: "Invalid lat or lon"
      });
    }

    // Haversine formula za distance calculation
    const { data, error } = await supabase.rpc('find_cameras_within_radius', {
      p_latitude: parseFloat(lat),
      p_longitude: parseFloat(lon),
      p_radius_km: parseFloat(radius)
    });

    if (error) {
      // Fallback ako RPC funkcija ne postoji - koristim client-side filter
      console.warn("RPC function not found, using fallback query");
      
      const { data: allCameras, error: fetchError } = await supabase
        .from("cameras")
        .select("*")
        .eq("active", true)
        .not("lat", "is", null)
        .not("lon", "is", null);

      if (fetchError) throw fetchError;

      // Client-side Haversine calculation
      const targetLat = parseFloat(lat);
      const targetLon = parseFloat(lon);
      const maxRadius = parseFloat(radius);

      const nearbyCameras = allCameras.filter(camera => {
        const distance = calculateDistance(
          targetLat, 
          targetLon, 
          camera.lat, 
          camera.lon
        );
        return distance <= maxRadius;
      }).map(camera => ({
        ...camera,
        distance_km: calculateDistance(targetLat, targetLon, camera.lat, camera.lon)
      }));

      return res.json({
        success: true,
        count: nearbyCameras.length,
        data: nearbyCameras
      });
    }

    res.json({
      success: true,
      count: data?.length || 0,
      data
    });
  } catch (err) {
    console.error("GET /api/cameras/nearby error:", err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

/**
 * GET /api/cameras/:id
 * Detalji jedne kamere
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("cameras")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: "Camera not found"
        });
      }
      throw error;
    }

    res.json({
      success: true,
      data
    });
  } catch (err) {
    console.error(`GET /api/cameras/${req.params.id} error:`, err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

/**
 * POST /api/cameras?admin_token=...
 * Admin-only dodavanje kamere
 */
router.post("/", adminGuard, async (req, res) => {
  try {
    const {
      name,
      stream_url,
      snapshot_url,
      lat,
      lon,
      city,
      country,
      tags,
      notes,
      active = true,
    } = req.body || {};

    if (!name || !stream_url) {
      return res.status(400).json({ success: false, error: "name and stream_url are required" });
    }
    if (lat != null && !isValidLat(lat)) {
      return res.status(400).json({ success: false, error: "invalid lat" });
    }
    if (lon != null && !isValidLon(lon)) {
      return res.status(400).json({ success: false, error: "invalid lon" });
    }

    const payload = {
      name,
      stream_url,
      snapshot_url: snapshot_url ?? null,
      lat: lat ?? null,
      lon: lon ?? null,
      city: city ?? null,
      country: country ?? null,
      tags: Array.isArray(tags) ? tags : tags ? [String(tags)] : null,
      notes: notes ?? null,
      active: !!active,
    };

    const { data, error } = await supabase.from("cameras").insert([payload]).select();
    if (error) throw error;

    res.json({ success: true, data: data?.[0] ?? null });
  } catch (err) {
    console.error("POST /api/cameras error:", err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

/**
 * PUT /api/cameras/:id?admin_token=...
 * Admin-only update kamere
 */
router.put("/:id", adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      stream_url,
      snapshot_url,
      lat,
      lon,
      city,
      country,
      tags,
      notes,
      active
    } = req.body || {};

    // Validacija
    if (lat != null && !isValidLat(lat)) {
      return res.status(400).json({ success: false, error: "invalid lat" });
    }
    if (lon != null && !isValidLon(lon)) {
      return res.status(400).json({ success: false, error: "invalid lon" });
    }

    // Build update payload (samo polja koja su poslana)
    const payload = {};
    if (name !== undefined) payload.name = name;
    if (stream_url !== undefined) payload.stream_url = stream_url;
    if (snapshot_url !== undefined) payload.snapshot_url = snapshot_url;
    if (lat !== undefined) payload.lat = lat;
    if (lon !== undefined) payload.lon = lon;
    if (city !== undefined) payload.city = city;
    if (country !== undefined) payload.country = country;
    if (tags !== undefined) payload.tags = Array.isArray(tags) ? tags : tags ? [String(tags)] : null;
    if (notes !== undefined) payload.notes = notes;
    if (active !== undefined) payload.active = !!active;

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields to update"
      });
    }

    const { data, error } = await supabase
      .from("cameras")
      .update(payload)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: "Camera not found"
        });
      }
      throw error;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error(`PUT /api/cameras/${req.params.id} error:`, err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

/**
 * DELETE /api/cameras/:id?admin_token=...
 * Admin-only brisanje kamere
 */
router.delete("/:id", adminGuard, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("cameras")
      .delete()
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: "Camera not found"
        });
      }
      throw error;
    }

    res.json({
      success: true,
      message: "Camera deleted successfully",
      data
    });
  } catch (err) {
    console.error(`DELETE /api/cameras/${req.params.id} error:`, err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// Helper function: Haversine distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

export default router;
