# UFX Backend

Express + Supabase + LocationIQ + Cron (Render Standard, Node 18)

## Endpoints
- `POST /api/report` – create a single record  
- `POST /api/import` – bulk upsert  
- `POST /api/geocode` – geocode missing lat/lon (protected by `CRON_TOKEN`)

## Deploy on Render
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Instance Type: Standard (2 GB RAM)
- Node version: 18+

### Environment Variables
NODE_ENV=production  
PORT=10000  
TZ=Europe/Zagreb  
SUPABASE_URL=https://zgoznvyeicbvqqoghmug.supabase.co  
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY  
LOCATIONIQ_API_KEY=YOUR_LOCATIONIQ_KEY  
LOCATIONIQ_BASE_URL=https://eu1.locationiq.com  
REPORTS_TABLE=reports  
CRON_TOKEN=ufx2025secure!  
ENABLE_IN_APP_CRON=false  

## Test
After deploy, open  
`https://ufx-backend.onrender.com/health`  
→ should return `{ "ok": true }`
