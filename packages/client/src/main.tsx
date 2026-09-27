import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminConsole } from './admin/AdminConsole.js';
import { App } from './App.js';
import { routeFromPath } from './router.js';
import { applyTheme, initialTheme } from './theme.js';
// Self-hosted so the LAN demo renders the same with no internet access.
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles.css';

// Applied before the first paint so the page never flashes the wrong theme.
// Also covers the admin console, which mounts its own root below.
applyTheme(initialTheme());

// The admin console is a separate app with its own socket namespace, so it is
// split off here. Everything else runs inside App, which routes internally.
const isAdmin = routeFromPath(window.location.pathname) === 'admin';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isAdmin ? <AdminConsole /> : <App />}</React.StrictMode>,
);
