const WEATHER_LOCATION_KEY = 'cx_weather_location';
const WEATHER_FORECAST_KEY = 'cx_weather_forecast';
const WEATHER_CURRENT_KEY = 'cx_weather_current';
const FORECAST_CACHE_MS = 30 * 60 * 1000;
const CURRENT_CACHE_MS = 15 * 60 * 1000;

const WEATHER_CODES = new Map([
  [0, ['Clear', '☀️']],
  [1, ['Mostly clear', '🌤️']],
  [2, ['Partly cloudy', '⛅']],
  [3, ['Cloudy', '☁️']],
  [45, ['Fog', '🌫️']],
  [48, ['Freezing fog', '🌫️']],
  [51, ['Light drizzle', '🌦️']],
  [53, ['Drizzle', '🌦️']],
  [55, ['Heavy drizzle', '🌧️']],
  [56, ['Freezing drizzle', '🌧️']],
  [57, ['Freezing drizzle', '🌧️']],
  [61, ['Light rain', '🌦️']],
  [63, ['Rain', '🌧️']],
  [65, ['Heavy rain', '🌧️']],
  [66, ['Freezing rain', '🌧️']],
  [67, ['Freezing rain', '🌧️']],
  [71, ['Light snow', '🌨️']],
  [73, ['Snow', '❄️']],
  [75, ['Heavy snow', '❄️']],
  [77, ['Snow grains', '🌨️']],
  [80, ['Rain showers', '🌦️']],
  [81, ['Rain showers', '🌧️']],
  [82, ['Heavy showers', '🌧️']],
  [85, ['Snow showers', '🌨️']],
  [86, ['Heavy snow showers', '🌨️']],
  [95, ['Thunderstorms', '⛈️']],
  [96, ['Thunderstorms with hail', '⛈️']],
  [99, ['Thunderstorms with hail', '⛈️']],
]);

function readStoredJson(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function storeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Weather can still work without a persistent cache.
  }
}

export function describeWeatherCode(code) {
  const [label, symbol] = WEATHER_CODES.get(Number(code)) || ['Variable weather', '🌤️'];
  return { label, symbol };
}

export function normalizeWeatherForecast(payload) {
  const daily = payload?.daily || {};
  return (daily.time || []).slice(0, 4).map((date, index) => ({
    date,
    code: Number(daily.weather_code?.[index]),
    ...describeWeatherCode(daily.weather_code?.[index]),
    high: Math.round(Number(daily.temperature_2m_max?.[index])),
    low: Math.round(Number(daily.temperature_2m_min?.[index])),
    rainChance: Math.round(Number(daily.precipitation_probability_max?.[index]) || 0),
    wind: Math.round(Number(daily.wind_speed_10m_max?.[index]) || 0),
  }));
}

export function normalizeCurrentWeather(payload) {
  const current = payload?.current || {};
  const temperature = Math.round(Number(current.temperature_2m));
  if (!Number.isFinite(temperature)) return null;
  const apparentTemperature = Math.round(Number(current.apparent_temperature));
  const wind = Math.round(Number(current.wind_speed_10m));
  const precipitation = Number(current.precipitation);
  return {
    code: Number(current.weather_code),
    ...describeWeatherCode(current.weather_code),
    temperature,
    apparentTemperature: Number.isFinite(apparentTemperature) ? apparentTemperature : null,
    wind: Number.isFinite(wind) ? wind : null,
    precipitation: Number.isFinite(precipitation) ? precipitation : null,
    observedAt: String(current.time || ''),
  };
}

export function formatCurrentWeather(current) {
  if (!current) return '';
  const details = [`${current.label}, ${current.temperature}°F`];
  if (Number.isFinite(current.apparentTemperature) && current.apparentTemperature !== current.temperature) {
    details.push(`feels like ${current.apparentTemperature}°F`);
  }
  if (Number.isFinite(current.wind)) details.push(`wind ${current.wind} mph`);
  if (Number.isFinite(current.precipitation) && current.precipitation > 0) details.push(`${current.precipitation} in precipitation`);
  return details.join(', ');
}

async function requestDeviceLocation() {
  if (!navigator.geolocation) return Promise.reject(new Error('Location is not available on this device.'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        capturedAt: Date.now(),
      }),
      (error) => reject(new Error(
        error?.code === 1
          ? 'Allow location access to show your local forecast.'
          : 'Your location could not be determined. Try again.',
      )),
      { enableHighAccuracy: false, maximumAge: 60 * 60 * 1000, timeout: 12000 },
    );
  });
}

async function getWeatherLocation({ force = false } = {}) {
  const stored = readStoredJson(WEATHER_LOCATION_KEY);
  if (!force && Number.isFinite(stored?.latitude) && Number.isFinite(stored?.longitude)) return stored;
  try {
    const location = await requestDeviceLocation();
    storeJson(WEATHER_LOCATION_KEY, location);
    return location;
  } catch (error) {
    if (Number.isFinite(stored?.latitude) && Number.isFinite(stored?.longitude)) return stored;
    throw error;
  }
}

export async function loadFourDayForecast({ force = false } = {}) {
  const cached = readStoredJson(WEATHER_FORECAST_KEY);
  if (!force && cached?.days?.length === 4 && Date.now() - Number(cached.fetchedAt || 0) < FORECAST_CACHE_MS) {
    return cached;
  }
  const location = await getWeatherLocation({ force });
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: '4',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) throw new Error('The weather service is unavailable right now.');
  const days = normalizeWeatherForecast(await response.json());
  if (days.length !== 4) throw new Error('The four-day forecast is temporarily incomplete.');
  const forecast = { days, fetchedAt: Date.now(), latitude: location.latitude, longitude: location.longitude };
  storeJson(WEATHER_FORECAST_KEY, forecast);
  return forecast;
}

export async function loadCurrentWeatherConditions({ force = false } = {}) {
  const cached = readStoredJson(WEATHER_CURRENT_KEY);
  if (!force && cached?.current && Date.now() - Number(cached.fetchedAt || 0) < CURRENT_CACHE_MS) {
    return cached.current;
  }
  const location = await getWeatherLocation({ force });
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) throw new Error('The weather service is unavailable right now.');
  const current = normalizeCurrentWeather(await response.json());
  if (!current) throw new Error('Current weather conditions are temporarily unavailable.');
  storeJson(WEATHER_CURRENT_KEY, { current, fetchedAt: Date.now(), latitude: location.latitude, longitude: location.longitude });
  return current;
}
