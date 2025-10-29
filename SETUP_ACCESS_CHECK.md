# Access Check Endpoint Setup Guide

This document provides setup instructions and testing guidelines for the new `/api/auth/check-access` endpoint.

## Overview

The `/api/auth/check-access` endpoint allows the frontend to securely query wallet address whitelist membership and optionally check on-chain token balances. Access is granted if **EITHER** the wallet is whitelisted **OR** meets the minimum token balance requirement.

## Environment Variables to Set on Render

### Already Configured (No Action Needed)
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for server-side operations

### Required for Whitelist Functionality

Add these environment variables to your Render service:

```bash
SUPABASE_WHITELIST_TABLE=whitelisted_wallets
SUPABASE_WHITELIST_ADDRESS_COL=wallet_address
SUPABASE_WHITELIST_FLAG_COL=active
```

**Note:** These are the default values. If your Supabase table uses different names, adjust accordingly.

### Optional - For Future On-Chain Token Checks

Add these when you deploy your token contract:

```bash
BASE_RPC_URL=https://mainnet.base.org
TOKEN_CONTRACT_ADDRESS=0x... (your token contract address)
MIN_TOKEN_AMOUNT=100
```

## Supabase Table Setup

Ensure your Supabase database has a whitelist table with this structure:

```sql
CREATE TABLE whitelisted_wallets (
  id SERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX idx_wallet_address ON whitelisted_wallets(LOWER(wallet_address));

-- Add some example addresses (replace with real addresses)
INSERT INTO whitelisted_wallets (wallet_address, active) VALUES
  ('0x742d35Cc6634C0532925a3b844Bc454e4438f44e', true),
  ('0x1234567890123456789012345678901234567890', true);
```

## API Usage

### Endpoint: POST /api/auth/check-access

**Request:**
```bash
curl -X POST https://ufx-backend-1.onrender.com/api/auth/check-access \
  -H "Content-Type: application/json" \
  -d '{"address": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"}'
```

**Response (Whitelisted):**
```json
{
  "success": true,
  "allowed": true,
  "reason": "Address is whitelisted and active"
}
```

**Response (Not Whitelisted):**
```json
{
  "success": true,
  "allowed": false,
  "reason": "Address not in whitelist"
}
```

**Response (With Token Balance - When Configured):**
```json
{
  "success": true,
  "allowed": true,
  "reason": "Token balance 150.5 meets minimum 100",
  "balance": 150.5
}
```

**Response (Invalid Address):**
```json
{
  "success": false,
  "error": "Invalid Ethereum address format",
  "message": "Invalid Ethereum address format"
}
```

### Endpoint: GET /api/auth/check-access (Quick Testing)

For quick testing, you can use GET with a query parameter:

```bash
curl "https://ufx-backend-1.onrender.com/api/auth/check-access?address=0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
```

## Manual Testing

### Using the Test Script

A bash script is provided for comprehensive testing:

```bash
# Test against localhost
./test-access-check.sh http://localhost:10000

# Test against production
./test-access-check.sh https://ufx-backend-1.onrender.com
```

### Manual cURL Tests

#### Test 1: Valid whitelisted address
```bash
curl -X POST https://ufx-backend-1.onrender.com/api/auth/check-access \
  -H "Content-Type: application/json" \
  -d '{"address": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"}'
```

Expected: `"allowed": true` if address is in whitelist with `active=true`

#### Test 2: Invalid address format
```bash
curl -X POST https://ufx-backend-1.onrender.com/api/auth/check-access \
  -H "Content-Type: application/json" \
  -d '{"address": "invalid-address"}'
```

Expected: `"success": false, "error": "Invalid Ethereum address format"`

#### Test 3: Valid address not in whitelist
```bash
curl -X POST https://ufx-backend-1.onrender.com/api/auth/check-access \
  -H "Content-Type: application/json" \
  -d '{"address": "0x0000000000000000000000000000000000000000"}'
```

Expected: `"allowed": false, "reason": "Address not in whitelist"`

#### Test 4: GET method for quick testing
```bash
curl "https://ufx-backend-1.onrender.com/api/auth/check-access?address=0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
```

Expected: Same as POST response

## Access Control Logic

The endpoint implements a flexible access control system:

1. **Whitelist Only Mode** (default when `TOKEN_CONTRACT_ADDRESS` is not set):
   - Access granted if address is in whitelist with `active=true`
   - Access denied otherwise

2. **Whitelist + Token Mode** (when `TOKEN_CONTRACT_ADDRESS` is configured):
   - Access granted if address is whitelisted with `active=true` **OR**
   - Access granted if token balance ≥ `MIN_TOKEN_AMOUNT`
   - Access denied only if BOTH checks fail

This OR logic ensures that:
- Whitelisted users always have access, even if they don't hold tokens yet
- Token holders have access even if not explicitly whitelisted
- Maximum flexibility for access control

## Frontend Integration Example

```javascript
async function checkWalletAccess(walletAddress) {
  try {
    const response = await fetch('https://ufx-backend-1.onrender.com/api/auth/check-access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ address: walletAddress }),
    });

    const data = await response.json();
    
    if (data.success && data.allowed) {
      // Grant access to protected features
      console.log('Access granted:', data.reason);
      if (data.balance !== undefined) {
        console.log('Token balance:', data.balance);
      }
      return true;
    } else {
      // Deny access
      console.log('Access denied:', data.reason);
      return false;
    }
  } catch (error) {
    console.error('Error checking access:', error);
    return false;
  }
}
```

## Troubleshooting

### "Missing Supabase credentials" Error
- Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in Render
- These should already be configured if other Supabase features work

### Whitelist Always Returns "Not Found"
- Check that the table name matches `SUPABASE_WHITELIST_TABLE`
- Verify the column names match the environment variables
- Ensure addresses in the database are stored correctly (case-insensitive matching is used)
- Check Supabase service role key has read permissions on the table

### Token Balance Check Not Working
- Verify `BASE_RPC_URL` is accessible from Render
- Ensure `TOKEN_CONTRACT_ADDRESS` is a valid ERC-20 contract
- Check RPC provider rate limits
- The endpoint will fallback to whitelist-only if token check fails

## Security Notes

- The endpoint uses `SUPABASE_SERVICE_ROLE_KEY` for server-side checks, preventing client-side manipulation
- Addresses are normalized to lowercase for consistent lookups
- Invalid addresses are rejected before database queries
- Token balance checks are optional and fail gracefully
- No sensitive data is exposed in error messages

## Next Steps

1. Deploy the changes to Render
2. Set the required environment variables
3. Set up the Supabase whitelist table
4. Add wallet addresses to the whitelist
5. Test the endpoint using the provided cURL commands
6. Integrate with frontend wallet connection flow
7. (Future) Configure token contract details when ready
