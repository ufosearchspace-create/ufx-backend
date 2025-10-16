// src/aiVerify.js
import express from "express";
import { supabase } from "./supabase.js";
import { adminGuard } from "./util.js";

const router = express.Router();

/**
 * POST /api/reports/:id/verify-ai?admin_token=...
 * Body: { ai_label?: string, ai_confidence?: number, verified?: boolean }
 * Ako ništa ne pošalješ, zapisat će "needs_review" sa confidence 0.
 */
router.post("/reports/:id/verify-ai", adminGuard, async (req, res) => {
  try {
    const id = req.params.id;
    const {
      ai_label = "needs_review",
      ai_confidence = 0,
      verified = false,
    } = req.body || {};

    const { data: existing, error: e1 } = await supabase
      .from("reports")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (e1) throw e1;
    if (!existing) return res.status(404).json({ success: false, error: "report not found" });

    const { data, error } = await supabase
      .from("reports")
      .update({
        ai_label,
        ai_confidence,
        verified_by_ai: !!verified,
        ai_checked_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select();

    if (error) throw error;
    res.json({ success: true, data: data?.[0] ?? null });
  } catch (err) {
    console.error("POST /api/reports/:id/verify-ai error:", err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

export default router;
