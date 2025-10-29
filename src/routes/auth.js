// src/routes/auth.js
import express from 'express';
import { ethers } from 'ethers';
import { supabase } from '../supabase.js';

const router = express.Router();

// Environment variables with defaults
const WHITELIST_TABLE = process.env.SUPABASE_WHITELIST_TABLE || 'whitelisted_wallets';
const WHITELIST_ADDRESS_COL = process.env.SUPABASE_WHITELIST_ADDRESS_COL || 'wallet_address';
const WHITELIST_FLAG_COL = process.env.SUPABASE_WHITELIST_FLAG_COL || 'active';
const TOKEN_CONTRACT_ADDRESS = process.env.TOKEN_CONTRACT_ADDRESS;
const MIN_TOKEN_AMOUNT = process.env.MIN_TOKEN_AMOUNT ? parseFloat(process.env.MIN_TOKEN_AMOUNT) : 0;
const BASE_RPC_URL = process.env.BASE_RPC_URL;

// ERC-20 ABI for balanceOf and decimals
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

/**
 * Check if an address is whitelisted in Supabase
 */
async function checkWhitelist(address) {
  try {
    const normalizedAddress = address.toLowerCase();
    
    const { data, error } = await supabase
      .from(WHITELIST_TABLE)
      .select('*')
      .ilike(WHITELIST_ADDRESS_COL, normalizedAddress)
      .single();

    if (error) {
      // If no matching record found, return not whitelisted
      if (error.code === 'PGRST116') {
        return { allowed: false, reason: 'Address not in whitelist' };
      }
      throw error;
    }

    // Check if the whitelist entry is active
    const isActive = data && data[WHITELIST_FLAG_COL] === true;
    
    return {
      allowed: isActive,
      reason: isActive ? 'Address is whitelisted and active' : 'Address is whitelisted but not active'
    };
  } catch (error) {
    console.error('Whitelist check error:', error);
    throw error;
  }
}

/**
 * Check token balance on-chain
 */
async function checkTokenBalance(address) {
  try {
    if (!BASE_RPC_URL || !TOKEN_CONTRACT_ADDRESS) {
      return null; // On-chain check not configured
    }

    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
    const contract = new ethers.Contract(TOKEN_CONTRACT_ADDRESS, ERC20_ABI, provider);

    // Get balance and decimals
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(address),
      contract.decimals()
    ]);

    // Convert to human-readable format
    const humanReadableBalance = parseFloat(ethers.formatUnits(balance, decimals));

    return {
      balance: humanReadableBalance,
      meetsMinimum: humanReadableBalance >= MIN_TOKEN_AMOUNT
    };
  } catch (error) {
    console.error('Token balance check error:', error);
    return null; // Return null on error, fallback to whitelist only
  }
}

/**
 * Shared logic to check access for an address
 */
async function checkAccess(address) {
  // Validate Ethereum address format
  if (!ethers.isAddress(address)) {
    throw new Error('Invalid Ethereum address format');
  }

  const normalizedAddress = address.toLowerCase();

  // Check whitelist (server-side with service role key)
  const whitelistResult = await checkWhitelist(normalizedAddress);

  // If TOKEN_CONTRACT_ADDRESS is configured, also check on-chain balance
  let tokenResult = null;
  if (TOKEN_CONTRACT_ADDRESS) {
    tokenResult = await checkTokenBalance(normalizedAddress);
  }

  // Determine overall access
  let allowed = whitelistResult.allowed;
  let reason = whitelistResult.reason;
  let balance = tokenResult?.balance;

  // If token check is configured and successful, grant access if EITHER condition is met
  if (tokenResult && tokenResult.balance !== undefined) {
    if (tokenResult.meetsMinimum) {
      allowed = true;
      reason = `Token balance ${tokenResult.balance} meets minimum ${MIN_TOKEN_AMOUNT}`;
    } else if (!whitelistResult.allowed) {
      // Only deny if both checks fail
      allowed = false;
      reason = `Token balance ${tokenResult.balance} below minimum ${MIN_TOKEN_AMOUNT} and not whitelisted`;
    }
    // If whitelisted but token balance is low, keep whitelist access
  }

  return {
    success: true,
    allowed,
    reason,
    ...(balance !== undefined && { balance })
  };
}

/**
 * POST /api/auth/check-access
 * Check if an address has access (whitelist + optional token balance)
 */
router.post('/check-access', async (req, res) => {
  try {
    const { address } = req.body;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid Ethereum address is required in request body'
      });
    }

    const result = await checkAccess(address);
    res.json(result);

  } catch (error) {
    console.error('POST /api/auth/check-access error:', error);
    res.status(500).json({
      success: false,
      error: error.message === 'Invalid Ethereum address format' ? error.message : 'Failed to check access',
      message: error.message
    });
  }
});

/**
 * GET /api/auth/check-access (for quick tests)
 * Same as POST but accepts address as query parameter
 */
router.get('/check-access', async (req, res) => {
  try {
    const { address } = req.query;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid Ethereum address is required as query parameter'
      });
    }

    const result = await checkAccess(address);
    res.json(result);

  } catch (error) {
    console.error('GET /api/auth/check-access error:', error);
    res.status(500).json({
      success: false,
      error: error.message === 'Invalid Ethereum address format' ? error.message : 'Failed to check access',
      message: error.message
    });
  }
});

export default router;
