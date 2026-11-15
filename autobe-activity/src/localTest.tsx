import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import './index.css';

// This entry is served by Vite's development server only. The production
// build uses index.html and continues to enforce its existing Discord gate.
const root = document.getElementById('root')!;
if (import.meta.env.DEV && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname)) {
  createRoot(root).render(<App />);
} else {
  root.textContent = 'The local merge test is available only on a local development server.';
}
