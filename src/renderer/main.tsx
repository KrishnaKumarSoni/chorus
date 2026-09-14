import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { ChorusProvider } from './lib/state';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChorusProvider>
      <App />
    </ChorusProvider>
  </React.StrictMode>,
);
