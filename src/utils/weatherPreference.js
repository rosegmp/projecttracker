function weatherPreferenceKey(activeUser) {
  return `cx_home_weather_visible:${activeUser?.id || activeUser?.email || 'default'}`;
}

export function readWeatherPreference(activeUser) {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(weatherPreferenceKey(activeUser)) !== 'false';
  } catch {
    return true;
  }
}

export function saveWeatherPreference(activeUser, visible) {
  try {
    window.localStorage.setItem(weatherPreferenceKey(activeUser), String(visible));
  } catch {
    // Keep the preference in memory when browser storage is unavailable.
  }
}
