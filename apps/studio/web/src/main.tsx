import { createRoot } from 'react-dom/client';
import { setLocalBackend } from './api.ts';
import { App } from './App.tsx';
import { createDemoBackend } from './demo/backend.ts';
import './styles.css';

if (__VIBE_DEMO__) setLocalBackend(createDemoBackend());

createRoot(document.getElementById('root')!).render(<App />);
