// src/routes/combined.js
import express from 'express';
import { supabase } from '../supabase.js';

const router = express.Router();

// Configuration
const MAP_SAFETY_LIMIT = 200000; // Povećano za obe tabele
const MAP_CHUNK_SIZE = 1000;

// ====================================
// GET /api/combined/map - Podatci iz OBE tabele
// ====================================
router.get('/map', async (req, res) => {
  try {
    const {
      bounds,
      shape,
      date_from,
      date_to,
      year_from,
      year_to,
      country,
      state,
      city,
      has_image,
      has_description
    } = req.query;

    console.log('🔄 Fetching data from BOTH tables...');

    // Funkcija za kreiranje query-ja
    const buildQuery = (tableName) => {
      let query = supabase
        .from(tableName)
        .select('id, latitude, longitude, lat, lon, city, state, country, shape, date_event, datetime, image_url, description, summary')
        .or('latitude.not.is.null,lat.not.is.null');

      // Filteri
      if (has_image === 'true') {
        query = query.not('image_url', 'is', null);
      }
      if (has_description === 'true') {
        query = query.or('description.not.is.null,summary.not.is.null');
      }
      if (bounds) {
        const [minLat, minLon, maxLat, maxLon] = bounds.split(',').map(parseFloat);
        // Za reports tabelu
        if (tableName === 'reports') {
          query = query
            .gte('lat', minLat).lte('lat', maxLat)
            .gte('lon', minLon).lte('lon', maxLon);
        }
        // Za nuforc_reports tabelu
        else {
          query = query
            .gte('latitude', minLat).lte('latitude', maxLat)
            .gte('longitude', minLon).lte('longitude', maxLon);
        }
      }
      if (shape) {
        query = query.eq('shape', shape.toLowerCase());
      }
      if (country) {
        query = query.ilike('country', `%${country}%`);
      }
      if (state) {
        query = query.ilike('state', `%${state}%`);
      }
      if (city) {
        query = query.ilike('city', `%${city}%`);
      }
      
      // Date filters
      if (date_from) {
        query = query.gte(tableName === 'reports' ? 'date_event' : 'datetime', date_from);
      }
      if (date_to) {
        query = query.lte(tableName === 'reports' ? 'date_event' : 'datetime', date_to);
      }
      if (year_from) {
        const dateField = tableName === 'reports' ? 'date_event' : 'datetime';
        query = query.gte(dateField, `${year_from}-01-01`);
      }
      if (year_to) {
        const dateField = tableName === 'reports' ? 'date_event' : 'datetime';
        query = query.lte(dateField, `${year_to}-12-31`);
      }

      return query;
    };

    // Fetch iz OBE tabele sa pagination
    const fetchAllFromTable = async (tableName) => {
      let allData = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const query = buildQuery(tableName).range(from, from + MAP_CHUNK_SIZE - 1);
        const { data, error } = await query;

        if (error) {
          console.error(`Error fetching from ${tableName}:`, error);
          return [];
        }

        if (data && data.length > 0) {
          allData = allData.concat(data);
          from += MAP_CHUNK_SIZE;
          
          if (data.length < MAP_CHUNK_SIZE) {
            hasMore = false;
          }
          if (allData.length >= MAP_SAFETY_LIMIT / 2) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }

      console.log(`✅ Fetched ${allData.length} records from ${tableName}`);
      return allData;
    };

    // Fetch iz obe tabele paralelno
    const [reportsData, nuforcData] = await Promise.all([
      fetchAllFromTable('reports'),
      fetchAllFromTable('nuforc_reports')
    ]);

    // Normalizuj podatke
    const normalizeRecord = (record, source) => ({
      id: `${source}_${record.id}`,
      lat: record.lat || record.latitude,
      lon: record.lon || record.longitude,
      city: record.city,
      state: record.state,
      country: record.country,
      shape: record.shape,
      date_event: record.date_event || record.datetime,
      image_url: record.image_url,
      description: record.description || record.summary,
      source: source
    });

    // Kombinuj i normalizuj
    const allData = [
      ...reportsData.map(r => normalizeRecord(r, 'reports')),
      ...nuforcData.map(r => normalizeRecord(r, 'nuforc'))
    ].filter(r => r.lat && r.lon); // Samo sa validnim koordinatama

    console.log(`✅ Total combined: ${allData.length} sightings`);
    console.log(`   - From reports: ${reportsData.length}`);
    console.log(`   - From nuforc_reports: ${nuforcData.length}`);

    res.json({
      success: true,
      count: allData.length,
      breakdown: {
        reports: reportsData.length,
        nuforc: nuforcData.length
      },
      data: allData
    });

  } catch (err) {
    console.error('GET /combined/map error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ====================================
// GET /api/combined/:id - Detalji jednog sightinga iz bilo koje tabele
// ====================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Parse source and real id
    const [source, realId] = id.includes('_') ? id.split('_') : ['reports', id];

    const tableName = source === 'nuforc' ? 'nuforc_reports' : 'reports';
    
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', realId)
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Sighting not found'
      });
    }

    res.json({
      success: true,
      data: {
        ...data,
        source: tableName
      }
    });

  } catch (err) {
    console.error('GET /combined/:id error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ====================================
// GET /api/combined/stats - Kombinovane statistike
// ====================================
router.get('/stats', async (req, res) => {
  try {
    // Brojanje iz obe tabele
    const [reports, nuforc] = await Promise.all([
      supabase.from('reports').select('*', { count: 'exact', head: true }),
      supabase.from('nuforc_reports').select('*', { count: 'exact', head: true })
    ]);

    const totalCount = (reports.count || 0) + (nuforc.count || 0);

    res.json({
      success: true,
      data: {
        total_sightings: totalCount,
        breakdown: {
          reports: reports.count || 0,
          nuforc: nuforc.count || 0
        }
      }
    });

  } catch (err) {
    console.error('GET /combined/stats error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

export default router;
