import React from 'react';
import { Presentation, Monitor, Cpu, Sparkles } from 'lucide-react';

export default function App() {
  return (
    <div className="podium-container">


      <h1 className="podium-title">
        Conference presentation desktop application
      </h1>

      <p className="podium-description">
        Welcome to the Podium presenter console powered by Electron, React, and Vite.
      </p>

      <div className="podium-status-bar">

        <div className="status-item">
          <Presentation size={16} />
          <span>Framework: <span className="tech-tag">React 18 + Vite</span></span>
        </div>
        <div className="status-item">
          <Monitor size={16} />
          <span>Container: <span className="tech-tag">Electron</span></span>
        </div>
      </div>
    </div>
  );
}
