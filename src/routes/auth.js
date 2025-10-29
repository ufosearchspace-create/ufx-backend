import express from 'express';
import { supabase } from '../supabase.js';
import { ethers } from 'ethers';

const router = express.Router();

const WHITELIST_TABLE = process.env.SUPABASE_WHITELIST_TABLE || 'whitelisted_wallets';
const WHITELIST_ADDRESS_COL = process.env.SUPABASE_WHITELIST_ADDRESS_COL || 'wallet_address';
const WHITELIST_FLAG_COL = process.env.SUPABASE_WHITELIST_FLAG_COL || 'active';
const DEFAULT_MIN_TOKEN = Number(process.env.MIN_TOKEN_AMOUNT || 1);

function normalizeAddress(addr) {
  if (!addr) return null;
  return addr.trim().toLowerCase();
}

// Accepts POST (JSON body) and GET (query param) for quick tests
router.all('/check-access', async (req, res) => {
  try {
    const body = req.method === 'GET' ? req.query : req.body || {};
    const rawAddress = body.address;
    if (!rawAddress) return res.status(400).json({ success: false, error: 'address required' });

    const address = normalizeAddress(rawAddress);
    if (!address) return res.status(400).json({ success: false, error: 'invalid address' });

    // Server-side whitelist check using service role supabase client
    const { data: rows, error: supErr } = await supabase
      .from(WHITELIST_TABLE)
      .select(WHITELIST_FLAG_COL)
      .eq(WHITELIST_ADDRESS_COL, address)
      .limit(1);

    if (supErr) {
      console.error('Supabase whitelist error:', supErr);
      return res.status(500).json({ success: false, error: 'supabase_error' });
    }

    const whitelisted = Array.isArray(rows) && rows.length > 0 && !!rows[0][WHITELIST_FLAG_COL];

    // If token gating not configured, return whitelist result
    const tokenContract = body.tokenContract || process.env.TOKEN_CONTRACT_ADDRESS || null;
    const minAmount = Number(body.minAmount ?? process.env.MIN_TOKEN_AMOUNT ?? DEFAULT_MIN_TOKEN);

    if (!tokenContract) {
      return res.json({
        success: true,
        allowed: whitelisted,
        reason: whitelisted ? 'whitelist' : 'not_whitelisted'
      });
    }

    // Token gating path: attempt on-chain check (ERC-20)
    try {
      const rpc = process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL;
      if (!rpc) {
        // No RPC configured - fallback to whitelist
        return res.json({
          success: true,
          allowed: whitelisted,
          reason: whitelisted ? 'whitelist_fallback_no_rpc' : 'no_rpc_and_not_whitelisted'
        });
      }

      const provider = new ethers.JsonRpcProvider(rpc);
      const abi = [
        'function balanceOf(address owner) view returns (uint256)',
        'function decimals() view returns (uint8)'
      ];
      const contract = new ethers.Contract(tokenContract, abi, provider);

      const [rawBalance, decimals] = await Promise.all([
        contract.balanceOf(address),
        contract.decimals().catch(() => 18)
      ]);

      const human = Number(ethers.formatUnits(rawBalance, decimals));
      const allowed = human >= minAmount;

      return res.json({
        success: true,
        allowed,
        reason: allowed ? 'token_balance' : (whitelisted ? 'whitelist_override' : 'insufficient_balance'),
        balance: human
      });
    } catch (err) {
      console.warn('On-chain balance check failed:', err?.message || err);
      // Fallback to whitelist result on error
      return res.json({
        success: true,
        allowed: whitelisted,
        reason: whitelisted ? 'whitelist_fallback_onchain_error' : 'onchain_error_and_not_whitelisted'
      });
    }
  } catch (err) {
    console.error('POST /api/auth/check-access error:', err);
    return res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

export default router;
