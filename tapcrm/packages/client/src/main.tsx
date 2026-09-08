import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';
import { ThemeProvider } from './theme/ThemeContext.js';

const root = document.getElementById('root');
if (root === null) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
