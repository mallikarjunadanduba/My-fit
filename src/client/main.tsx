import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPwa } from './pwa/pwa';

// Before rendering, so the browser's install prompt event isn't missed.
initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
