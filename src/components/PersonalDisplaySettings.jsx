import React, { useEffect, useState } from 'react';
import { readWeatherPreference, saveWeatherPreference } from '../utils/weatherPreference.js';

export default function PersonalDisplaySettings({ activeUser }) {
  const [weatherVisible, setWeatherVisible] = useState(() => readWeatherPreference(activeUser));

  useEffect(() => { setWeatherVisible(readWeatherPreference(activeUser)); }, [activeUser?.email, activeUser?.id]);

  return (
    <section className="panel native-panel top-level-settings-page">
      <div className="settings-page-intro">
        <div><p className="eyebrow">Preferences</p><h2>Settings</h2><p>Choose what appears on your home screen.</p></div>
      </div>
      <section id="settings-panel-display" className="settings-section" role="region" aria-labelledby="settings-tab-display">
        <div className="settings-section-header"><div><h3>Display preferences</h3><p>These choices apply to your account on this device.</p></div></div>
        <div className="settings-grid settings-grid-single">
          <section className="settings-card">
            <div className="settings-card-header"><div><h3>Home screen</h3><p>Choose the content shown on your home screen.</p></div></div>
            <label className="settings-toggle">
              <input type="checkbox" checked={weatherVisible} onChange={(event) => {
                const visible = event.target.checked;
                setWeatherVisible(visible);
                saveWeatherPreference(activeUser, visible);
              }} />
              <span><strong>Show weather</strong><small>Display the four-day local forecast on Home.</small></span>
            </label>
          </section>
        </div>
      </section>
    </section>
  );
}
