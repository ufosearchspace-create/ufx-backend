// src/routes/combined.js
import express from 'express';
import { supabase } from '../supabase.js';

const router = express.Router();

// Configuration
const MAP_SAFETY_LIMIT = 200000;
const MAP_CHUNK_SIZE = 1000;

// TEST ENDPOINT
router.get('/test', async (req, res) => {
  try {
    console.log('🧪 Testing table access...');
    
    // Test reports table
    const { count: reportsCount, error: reportsError } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true });
    
    console.log('Reports table:', reportsCount ? `✅ ${reportsCount} records` : `❌ Error: ${reportsError?.message}`);
    
    // Test nuforc_reports table  
    const { count: nuforcCount, error: nuforcError } = await supabase
      .from('nuforc_reports')
      .select('*', { count: 'exact', head: true });
    
    console.log('NUFORC table:', nuforcCount ? `✅ ${nuforcCount} records` : `❌ Error: ${nuforcError?.message}`);
    
    // Get column info
    const { data: sample, error: sampleError } = await supabase
      .from('nuforc_reports')
      .select('*')
      .limit(1);
    
    let columns = [];
    if (sample && sample[0]) {
      columns = Object.keys(sample[0]);
    }
    
    res.json({
      success: true,
      tables: {
        reports: {
          accessible: !reportsError,
          count: reportsCount || 0,
          error: reportsError?.message
        },
        nuforc_reports: {
          accessible: !nuforcError,
          count: nuforcCount || 0,
          error: nuforcError?.message,
          columns: columns,
          sample: sample?.[0] || null
        }
      }
    });
  } catch (err) {
    console.error('Test endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ====================================
// GET /api/combined/map
// ====================================
router.get('/map', async (req, res) => {
  try {
    console.log('🔄 Combined/map endpoint called');
    
    const {
      has_image,
      has_description,
      shape,
      country,
      state,
      city,
      year_from,
      year_to
    } = req.query;

    // FETCH FROM REPORTS TABLE
    console.log('📊 Fetching from reports table...');
    let reportsData = [];
    let from = 0;
    let hasMore = true;
    
    while (hasMore && reportsData.length < MAP_SAFETY_LIMIT / 2) {
      let query = supabase
        .from('reports')
        .select('id, lat, lon, city, state, country, shape, date_event, image_url, description')
        .not('lat', 'is', null)
        .not('lon', 'is', null)
        .range(from, from + MAP_CHUNK_SIZE - 1);

      if (has_image === 'true') {
        query = query.not('image_url', 'is', null);
      }
      if (has_description === 'true') {
        query = query.not('description', 'is', null);
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
      if (year_from) {
        query = query.gte('date_event', `${year_from}-01-01`);
      }
      if (year_to) {
        query = query.lte('date_event', `${year_to}-12-31`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Reports fetch error:', error);
        throw error;
      }

      if (data && data.length > 0) {
        reportsData = reportsData.concat(data);
        from += MAP_CHUNK_SIZE;
        
        if (data.length < MAP_CHUNK_SIZE) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`✅ Fetched ${reportsData.length} from reports`);

    // FETCH FROM NUFORC_REPORTS TABLE
    console.log('📊 Fetching from nuforc_reports table...');
    let nuforcData = [];
    from = 0;
    hasMore = true;
    
    try {
      while (hasMore && nuforcData.length < MAP_SAFETY_LIMIT / 2) {
        let query = supabase
          .from('nuforc_reports')
          .select('*')  // Select all to see what columns we have
          .limit(MAP_CHUNK_SIZE)
          .range(from, from + MAP_CHUNK_SIZE - 1);

        const { data, error } = await query;

        if (error) {
          console.error('❌ NUFORC fetch error:', error.message, error.details);
          break;
        }

        if (data && data.length > 0) {
          // Log first record to see structure
          if (from === 0) {
            console.log('📋 NUFORC record structure:', Object.keys(data[0]));
          }
          
          // Transform data - adjust field names based on actual structure
          const transformed = data.map(n => ({
            id: `nuforc_${n.id}`,
            lat: n.latitude || n.lat,
            lon: n.longitude || n.lon || n.lng,
            city: n.city,
            state: n.state,
            country: n.country || 'USA',
            shape: n.shape,
            date_event: n.datetime || n.date_event || n.date,
            description: n.summary || n.description || n.comments
          })).filter(n => n.lat && n.lon); // Only records with coordinates
          
          nuforcData = nuforcData.concat(transformed);
          from += MAP_CHUNK_SIZE;
          
          if (data.length < MAP_CHUNK_SIZE) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }
    } catch (e) {
      console.error('⚠️ NUFORC error:', e.message);
    }
    
    console.log(`✅ Fetched ${nuforcData.length} from nuforc_reports`);

    // COMBINE ALL DATA
    const allData = [...reportsData, ...nuforcData];
    
    console.log(`🎯 FINAL TOTALS:`);
    console.log(`   - Reports: ${reportsData.length}`);
    console.log(`   - NUFORC: ${nuforcData.length}`);
    console.log(`   - Combined: ${allData.length}`);

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
    console.error('❌ GET /combined/map error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.details || null
    });
  }
});

// ====================================
// GET /api/combined/stats
// ====================================
router.get('/stats', async (req, res) => {
  try {
    console.log('📊 Combined/stats called');
    
    const { count: reportsCount } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true });
    
    const { count: nuforcCount } = await supabase
      .from('nuforc_reports')
      .select('*', { count: 'exact', head: true });
    
    const total = (reportsCount || 0) + (nuforcCount || 0);
    
    console.log(`📊 Reports: ${reportsCount}, NUFORC: ${nuforcCount}, Total: ${total}`);
    
    res.json({
      success: true,
      data: {
        total_sightings: total,
        breakdown: {
          reports: reportsCount || 0,
          nuforc: nuforcCount || 0
        }
      }
    });
    
  } catch (err) {
    console.error('❌ Stats error:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// ====================================
// GET /api/combined/:id
// ====================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (id.startsWith('nuforc_')) {
      const realId = id.replace('nuforc_', '');
      const { data, error } = await supabase
        .from('nuforc_reports')
        .select('*')
        .eq('id', realId)
        .single();
      
      if (!error && data) {
        return res.json({ success: true, data });
      }
    }
    
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    res.json({ success: true, data });
    
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

export default router;
