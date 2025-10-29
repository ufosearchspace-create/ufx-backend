// src/routes/auth.js
import express from 'express';
import { supabase } from '../supabase.js';

const router = express.Router();

// Environment variables with defaults
const WHITELIST_TABLE = process.env.SUPABASE_WHITELIST_TABLE || 'whitelisted_wallets';
const WHITELIST_FLAG_COL = process.env.SUPABASE_WHITELIST_FLAG_COL || 'active';
const WHITELIST_ADDRESS_COL = process.env.SUPABASE_WHITELIST_ADDRESS_COL || 'wallet_address';
const TOKEN_CONTRACT_ADDRESS = process.env.TOKEN_CONTRACT_ADDRESS;

// ====================================
// POST/GET /check-access - Check wallet access
// ====================================
router.post('/check-access', async (req, res) => {
  await checkAccess(req, res);
});

router.get('/check-access', async (req, res) => {
  await checkAccess(req, res);
});

async function checkAccess(req, res) {
  try {
    // Get address from body (POST) or query (GET)
    const address = req.body?.address || req.query?.address;

    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Address is required'
      });
    }

    // Normalize address to lowercase
    const normalizedAddress = address.toLowerCase();

    // If token gating is not configured, allow access
    if (!TOKEN_CONTRACT_ADDRESS) {
      return res.json({
        success: true,
        allowed: true,
        reason: 'Token gating not configured'
      });
    }

    // Query Supabase whitelist table
    const { data, error } = await supabase
      .from(WHITELIST_TABLE)
      .select(WHITELIST_FLAG_COL)
      .eq(WHITELIST_ADDRESS_COL, normalizedAddress)
      .single();

    if (error) {
      // If no record found, user is not whitelisted
      if (error.code === 'PGRST116') {
        return res.json({
          success: true,
          allowed: false,
          reason: 'Address not whitelisted'
        });
      }
      throw error;
    }

    // Check if the flag is true/active
    const isActive = data?.[WHITELIST_FLAG_COL] === true || data?.[WHITELIST_FLAG_COL] === 'true';

    res.json({
      success: true,
      allowed: isActive,
      reason: isActive ? 'Address whitelisted and active' : 'Address whitelisted but not active'
    });

  } catch (err) {
    console.error('POST/GET /check-access error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

export default router;
