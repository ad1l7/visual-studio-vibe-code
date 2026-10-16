import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `vite build --mode demo` — демо-сборка одним JS-файлом для публикации страницей без сервера.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    root: 'web',
    plugins: [react()],
    define: { __VIBE_DEMO__: JSON.stringify(demo) },
    build: demo
      ? { outDir: 'dist-demo', emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 100_000_000, rollupOptions: { output: { codeSplitting: false, entryFileNames: 'app.js', assetFileNames: 'app[extname]' } } }
      : { outDir: 'dist', emptyOutDir: true },
  };
});
