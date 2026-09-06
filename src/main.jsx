import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { installStorage } from './lib/storage.js';
import './index.css';

installStorage();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
