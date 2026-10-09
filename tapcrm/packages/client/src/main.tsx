import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { App } from './App.js';
import './index.css';
import { ThemeProvider } from './theme/ThemeContext.js';
import { ACCENT_COLORS, useTheme } from './theme/ThemeContext.js';

function ThemeAwareToaster(): React.JSX.Element {
  const { accent, resolvedTheme } = useTheme();
  const accentColor = ACCENT_COLORS.find((color) => color.id === accent)?.hex ?? '#10b981';
  const isDark = resolvedTheme === 'dark';

  return (
    <Toaster
      position="top-center"
      toastOptions={{
        style: {
          background: isDark ? 'rgba(27, 30, 36, 0.94)' : 'rgba(255, 255, 255, 0.94)',
          color: isDark ? '#f8fafc' : '#0f172a',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.10)'}`,
          borderRadius: '14px',
          boxShadow: isDark
            ? '0 14px 34px -20px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255,255,255,0.08)'
            : '0 14px 34px -20px rgba(15, 23, 42, 0.28), inset 0 1px 0 rgba(255,255,255,0.72)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
        },
        success: {
          iconTheme: {
            primary: accentColor,
            secondary: isDark ? '#1b1e24' : '#ffffff',
          },
        },
        error: {
          iconTheme: {
            primary: isDark ? '#fb7185' : '#e11d48',
            secondary: isDark ? '#1b1e24' : '#ffffff',
          },
        },
      }}
    />
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <ThemeAwareToaster />
    </ThemeProvider>
  </StrictMode>,
);
