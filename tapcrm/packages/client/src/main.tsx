import { StrictMode, useEffect, useRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, useToasterStore } from 'react-hot-toast';
import { App } from './App.js';
import './index.css';
import { ThemeProvider } from './theme/ThemeContext.js';
import { ACCENT_COLORS, useTheme } from './theme/ThemeContext.js';

/**
 * A pop-up window (a modal <dialog>) is drawn in the browser's top layer, above
 * every z-index, so ordinary toasts would sit behind it. The toasts live in a
 * popover instead, which is also in the top layer; showing it again when a toast
 * appears over an open window puts it on top. Clicks pass through to the page.
 */
function TopLayerToasts({ children }: { children: ReactNode }): React.JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const { toasts } = useToasterStore();
  const visible = toasts.filter((t) => t.visible).map((t) => t.id).join(',');
  const shown = useRef(false);
  useEffect(() => {
    const element = layer.current;
    if (!element || typeof element.showPopover !== 'function') return;
    try {
      const windowOpen = document.querySelector('dialog:modal') !== null;
      if (shown.current && !windowOpen) return;
      if (shown.current) element.hidePopover();
      element.showPopover();
      shown.current = true;
    } catch {
      // Browsers without popovers keep the toasts' own z-index.
    }
  }, [visible]);
  return (
    <div
      ref={layer}
      popover="manual"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        margin: 0,
        padding: 0,
        border: 0,
        background: 'transparent',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  );
}

function ThemeAwareToaster(): React.JSX.Element {
  const { accent, resolvedTheme } = useTheme();
  const accentColor = ACCENT_COLORS.find((color) => color.id === accent)?.hex ?? '#10b981';
  const isDark = resolvedTheme === 'dark';

  return (
    <TopLayerToasts>
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
    </TopLayerToasts>
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
