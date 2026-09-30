import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted display + Arabic fallback (offline-safe, no Google Fonts links).
import '@fontsource/lilita-one';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
