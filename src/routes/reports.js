// src/routes/reports.js
import express from 'express';
import { supabase } from '../supabase.js';

const router = express.Router();

// ====================================
// GET /api/sightings - Lista sa filterima
// ====================================
router.get('/', async (req, res) => {
  try {
    const {
      city,
      state,
      country,
      shape,
      date_from,
      date_to,
      has_image,
      has_description,
      limit = 100,
      offset = 0
    } = req.query;

    let query = supabase
      .from('nuforc_reports')
      .select('*', { count: 'exact' });

    // Filteri
    if (city) {
      query = query.ilike('city', `%${city}%`);
    }
    if (state) {
      query = query.eq('state', state.toUpperCase());
    }
    if (country) {
      query = query.eq('country', country.toUpperCase());
    }
    if (shape) {
      query = query.eq('shape', shape.toLowerCase());
    }
    if (date_from) {
      query = query.gte('date_event', date_from);
    }
    if (date_to) {
      query = query.lte('date_event', date_to);
    }
    if (has_image === 'true') {
      query = query.not('image_url', 'is', null);
    } else if (has_image === 'false') {
      query = query.is('image_url', null);
    }
    if (has_description === 'true') {
      query = query.not('description', 'is', null);
    } else if (has_description === 'false') {
      query = query.is('description', null);
    }

    // Sorting i pagination
    query = query
      .order('date_event', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      success: true,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset),
      data: data
    });

  } catch (err) {
    console.error('GET /sightings error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ====================================
// GET /api/sightings/map - Optimizovano za mapu (SA PAGINATION LOOP-OM)
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
      load_mode // 'all', 'images_only', 'images_and_descriptions', 'descriptions_only'
    } = req.query;

    let allData = [];
    let from = 0;
    const chunkSize = 1000;
    let hasMore = true;

    // Warn about loading all data
    if (load_mode === 'all' || !load_mode) {
      console.log('⚠️ WARNING: Loading all data (potentially large dataset)');
    }

    console.log('🔄 Starting pagination fetch...');

    while (hasMore) {
      let query = supabase
        .from('nuforc_reports')
        .select('id, lat, lon, city, state, country, shape, date_event, image_url, description')
        .not('lat', 'is', null)
        .not('lon', 'is', null);

      // Apply data loading mode filters
      if (load_mode === 'images_only') {
        query = query.not('image_url', 'is', null);
      } else if (load_mode === 'images_and_descriptions') {
        query = query.not('image_url', 'is', null).not('description', 'is', null);
      } else if (load_mode === 'descriptions_only') {
        query = query.not('description', 'is', null);
      }
      // 'all' mode doesn't add any filters

      // Bounds filter
      if (bounds) {
        const [minLat, minLon, maxLat, maxLon] = bounds.split(',').map(parseFloat);
        query = query
          .gte('lat', minLat)
          .lte('lat', maxLat)
          .gte('lon', minLon)
          .lte('lon', maxLon);
      }

      // Shape filter
      if (shape) {
        query = query.eq('shape', shape.toLowerCase());
      }

      // Country filter
      if (country) {
        query = query.ilike('country', `%${country}%`);
      }

      // State filter
      if (state) {
        query = query.ilike('state', `%${state}%`);
      }

      // City filter
      if (city) {
        query = query.ilike('city', `%${city}%`);
      }

      // Date range filters
      if (date_from) {
        query = query.gte('date_event', date_from);
      }
      if (date_to) {
        query = query.lte('date_event', date_to);
      }

      // Year range filters
      if (year_from) {
        query = query.gte('date_event', `${year_from}-01-01T00:00:00`);
      }
      if (year_to) {
        query = query.lte('date_event', `${year_to}-12-31T23:59:59`);
      }

      // Fetch chunk
      query = query.range(from, from + chunkSize - 1);
      
      const { data, error } = await query;

      if (error) throw error;

      if (data && data.length > 0) {
        allData = allData.concat(data);
        from += chunkSize;
        
        console.log(`📦 Fetched chunk: ${data.length} records. Total so far: ${allData.length}`);
        
        // Ako je vratio manje od chunkSize, znači da nema više
        if (data.length < chunkSize) {
          hasMore = false;
        }

        // Safety limit - max 60k zapisa
        if (allData.length >= 60000) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Pagination complete! Total fetched: ${allData.length} sightings`);

    res.json({
      success: true,
      count: allData.length,
      data: allData
    });

  } catch (err) {
    console.error('GET /sightings/map error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ====================================
// GET /api/sightings/map/progress - Map data with progress tracking (SSE)
// ====================================
router.get('/map/progress', async (req, res) => {
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
      load_mode // 'all', 'images_only', 'images_and_descriptions', 'descriptions_only'
    } = req.query;

    // Set headers for Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const sendProgress = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    // Warn about loading all data
    if (load_mode === 'all' || !load_mode) {
      sendProgress('warning', { message: 'Loading all data (potentially large dataset)' });
    }

    sendProgress('start', { message: 'Starting data fetch...' });

    let allData = [];
    let from = 0;
    const chunkSize = 1000;
    let hasMore = true;
    let totalEstimated = null;

    while (hasMore) {
      let query = supabase
        .from('nuforc_reports')
        .select('id, lat, lon, city, state, country, shape, date_event, image_url, description', { count: 'exact' })
        .not('lat', 'is', null)
        .not('lon', 'is', null);

      // Apply data loading mode filters
      if (load_mode === 'images_only') {
        query = query.not('image_url', 'is', null);
      } else if (load_mode === 'images_and_descriptions') {
        query = query.not('image_url', 'is', null).not('description', 'is', null);
      } else if (load_mode === 'descriptions_only') {
        query = query.not('description', 'is', null);
      }

      // Bounds filter
      if (bounds) {
        const [minLat, minLon, maxLat, maxLon] = bounds.split(',').map(parseFloat);
        query = query
          .gte('lat', minLat)
          .lte('lat', maxLat)
          .gte('lon', minLon)
          .lte('lon', maxLon);
      }

      // Shape filter
      if (shape) {
        query = query.eq('shape', shape.toLowerCase());
      }

      // Country filter
      if (country) {
        query = query.ilike('country', `%${country}%`);
      }

      // State filter
      if (state) {
        query = query.ilike('state', `%${state}%`);
      }

      // City filter
      if (city) {
        query = query.ilike('city', `%${city}%`);
      }

      // Date range filters
      if (date_from) {
        query = query.gte('date_event', date_from);
      }
      if (date_to) {
        query = query.lte('date_event', date_to);
      }

      // Year range filters
      if (year_from) {
        query = query.gte('date_event', `${year_from}-01-01T00:00:00`);
      }
      if (year_to) {
        query = query.lte('date_event', `${year_to}-12-31T23:59:59`);
      }

      // Fetch chunk
      query = query.range(from, from + chunkSize - 1);
      
      const { data, error, count } = await query;

      if (error) {
        sendProgress('error', { message: error.message });
        res.end();
        return;
      }

      // Store total count from first request
      if (totalEstimated === null && count !== null) {
        totalEstimated = count;
      }

      if (data && data.length > 0) {
        allData = allData.concat(data);
        from += chunkSize;
        
        // Send progress update
        const percentage = totalEstimated ? Math.round((allData.length / totalEstimated) * 100) : 0;
        sendProgress('progress', {
          loaded: allData.length,
          total: totalEstimated,
          percentage,
          message: `Fetched ${allData.length}${totalEstimated ? ` of ${totalEstimated}` : ''} records...`
        });
        
        // Ako je vratio manje od chunkSize, znači da nema više
        if (data.length < chunkSize) {
          hasMore = false;
        }

        // Safety limit - max 60k zapisa
        if (allData.length >= 60000) {
          hasMore = false;
          sendProgress('warning', { message: 'Reached maximum limit of 60,000 records' });
        }
      } else {
        hasMore = false;
      }
    }

    // Send completion with data
    sendProgress('complete', {
      count: allData.length,
      data: allData
    });

    res.end();

  } catch (err) {
    console.error('GET /sightings/map/progress error:', err);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    } catch (writeError) {
      // If we can't write, connection is already closed
      console.error('Failed to send error to client:', writeError);
    }
  }
});

// ====================================
// GET /api/sightings/stats - Statistike
// ====================================
router.get('/stats', async (req, res) => {
  try {
    // Total count
    const { count: totalCount } = await supabase
      .from('nuforc_reports')
      .select('*', { count: 'exact', head: true });

    // Top 10 shapes
    const { data: topShapes } = await supabase
      .from('nuforc_reports')
      .select('shape')
      .not('shape', 'is', null)
      .limit(10000);

    const shapeCounts = {};
    topShapes?.forEach(r => {
      shapeCounts[r.shape] = (shapeCounts[r.shape] || 0) + 1;
    });
    const topShapesArray = Object.entries(shapeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([shape, count]) => ({ shape, count }));

    // Top 10 states
    const { data: topStates } = await supabase
      .from('nuforc_reports')
      .select('state')
      .not('state', 'is', null)
      .limit(10000);

    const stateCounts = {};
    topStates?.forEach(r => {
      stateCounts[r.state] = (stateCounts[r.state] || 0) + 1;
    });
    const topStatesArray = Object.entries(stateCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([state, count]) => ({ state, count }));

    // Top 10 cities
    const { data: topCities } = await supabase
      .from('nuforc_reports')
      .select('city, state')
      .not('city', 'is', null)
      .limit(10000);

    const cityCounts = {};
    topCities?.forEach(r => {
      const key = `${r.city}, ${r.state}`;
      cityCounts[key] = (cityCounts[key] || 0) + 1;
    });
    const topCitiesArray = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([city, count]) => ({ city, count }));

    res.json({
      success: true,
      data: {
        total_sightings: totalCount,
        top_shapes: topShapesArray,
        top_states: topStatesArray,
        top_cities: topCitiesArray
      }
    });

  } catch (err) {
    console.error('GET /stats error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ====================================
// GET /api/sightings/:id - Detalji jednog sightinga
// ====================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('nuforc_reports')
      .select('*')
      .eq('id', id)
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
      data: data
    });

  } catch (err) {
    console.error('GET /sightings/:id error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

export default router;
