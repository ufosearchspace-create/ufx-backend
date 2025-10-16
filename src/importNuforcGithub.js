// Sastavlja datum iz komponenata
const buildDate = (year, month, day, hour, minute) => {
  try {
    if (!year || !month || !day) return null;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour || 0).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}:00Z`;
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date.toISOString();
  } catch (e) {
    return null;
  }
};

// Your existing code here

// CORGIS dataset ima nested field names sa tačkama
const city = cleanText(record['Location.City']);
const state = cleanText(record['Location.State']);
const country = cleanText(record['Location.Country']) || 'USA';

const cleanRecord = {
  date_event: buildDate(
    record['Dates.Sighted.Year'],
    record['Dates.Sighted.Month'],
    record['Date.Sighted.Day'],
    record['Dates.Sighted.Hour'],
    record['Dates.Sighted.Minute']
  ),
  city: city,
  state: state,
  country: country,
  address: buildAddress(city, state, country),
  shape: cleanText(record['Data.Shape'])?.toLowerCase(),
  duration: cleanText(record['Data.Encounter duration']),
  description: cleanText(record['Data.Description excerpt']),
  lat: parseCoordinate(record['Location.Coordinates.Latitude ']),
  lon: parseCoordinate(record['Location.Coordinates.Longitude ']),
  source_name: "NUFORC",
  source_type: "HISTORICAL",
  original_id: `corgis_${processedCount}`,
  verified_by_ai: false
};
