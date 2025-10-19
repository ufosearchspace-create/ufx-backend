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
      limit = 100,
      offset = 0
    } = req.query;

    let query = supabase
      .from('reports')
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
// GET /api/sightings/map - Optimizovano za mapu
// ====================================
router.get('/map', async (req, res) => {
  try {
    const {
      bounds, // format: "minLat,minLon,maxLat,maxLon"
      shape,
      date_from,
      date_to,
      year_from,
      year_to,
      country,
      state,
      city,
      duration_min,
      duration_max,
      limit
    } = req.query;

    // Default limit: 60000, ali korisnik može specificirati manji
    const maxLimit = limit ? parseInt(limit) : 60000;

    let query = supabase
      .from('reports')
      .select('id, lat, lon, city, state, country, shape, date_event, duration_seconds')
      .not('lat', 'is', null)
      .not('lon', 'is', null);

    // Bounds filter (za map viewport)
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

    // Year range filters (convert to date strings)
    if (year_from) {
      query = query.gte('date_event', `${year_from}-01-01T00:00:00`);
    }
    if (year_to) {
      query = query.lte('date_event', `${year_to}-12-31T23:59:59`);
    }

    // Duration filters
    if (duration_min) {
      query = query.gte('duration_seconds', parseFloat(duration_min));
    }
    if (duration_max) {
      query = query.lte('duration_seconds', parseFloat(duration_max));
    }

    query = query.limit(maxLimit);

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      data: data
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
// GET /api/sightings/stats - Statistike
// ====================================
router.get('/stats', async (req, res) => {
  try {
    // Total count
    const { count: totalCount } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true });

    // Top 10 shapes
    const { data: topShapes } = await supabase
      .from('reports')
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
      .from('reports')
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
      .from('reports')
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
      .from('reports')
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
