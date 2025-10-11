
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import routes from './src/routes.js';
import { setupInAppCron } from './src/geocode.js';


const app = express();
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(morgan('dev'));
app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', routes);
if (process.env.ENABLE_IN_APP_CRON === 'true') setupInAppCron(app);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

import { importMufon } from "./src/importMufon.js";

app.post("/api/import/mufon", async (req, res) => {
  try {
    await importMufon();
    res.json({ success: true, source: "MUFON" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

import { importGeipan } from "./src/importGeipan.js";

app.post("/api/import/geipan", async (req, res) => {
  try {
    const count = await importGeipan();
    res.json({ success: true, source: "GEIPAN", imported: count });
  } catch (err) {
    console.error("Error importing GEIPAN:", err);
    res.status(500).json({ error: err.message });
  }
});

import { importCsvFromUrl } from "./src/importCsv.js";

app.post("/api/import/csv", async (req, res) => {
  try {
    const { url, source_name, mapping, batchSize } = req.body || {};
    const result = await importCsvFromUrl({ url, source_name, mapping, batchSize });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error("CSV import error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});
