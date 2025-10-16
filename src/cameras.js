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

export default router;
