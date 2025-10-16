// Utility functions
export const isValidLat = (lat) => {
  const num = parseFloat(lat);
  return !isNaN(num) && num >= -90 && num <= 90;
};

export const isValidLon = (lon) => {
  const num = parseFloat(lon);
  return !isNaN(num) && num >= -180 && num <= 180;
};

export const adminGuard = (req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
};

export const cronGuard = (req, res, next) => {
  const token = req.query.cron_token;
  if (token !== process.env.CRON_TOKEN) {
    return res.status(403).json({ error: 'Invalid cron token' });
  }
  next();
};

export const ok = (data) => ({ success: true, data });