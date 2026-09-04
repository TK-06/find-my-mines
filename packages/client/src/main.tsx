import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminConsole } from './admin/AdminConsole.js';
import { App } from './App.js';
import './styles.css';

// Two entry points, one bundle: /admin is the server console, everything
// else is the game. Avoids pulling in a router for two routes.
const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isAdmin ? <AdminConsole /> : <App />}</React.StrictMode>,
);
