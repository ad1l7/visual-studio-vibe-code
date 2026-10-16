import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/screens.css';
import './styles/legacy.css';
import { createRoot } from 'react-dom/client';
import { setLocalBackend } from './api.ts';
import { App } from './App.tsx';
import { createDemoBackend } from './demo/backend.ts';
import { applyDensity, applyTheme, readLS, type DensitySetting, type ThemeSetting } from './lib/storage.ts';
import { TooltipHost } from './ui/overlay.tsx';
import { ToastProvider } from './ui/toast.tsx';

// Тема и плотность применяются до первого рендера — без вспышки.
applyTheme(readLS<ThemeSetting>('vibe.theme', 'system'));
applyDensity(readLS<DensitySetting>('vibe.density', 'normal'));

if (__VIBE_DEMO__) setLocalBackend(createDemoBackend());

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <App />
    <TooltipHost />
  </ToastProvider>,
);
