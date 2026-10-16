// Собирает демо-версию студии в один HTML-файл: node scripts/build-demo.mjs [путь-результата]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'web', 'dist-demo', 'vibe-studio-demo.html'));
execFileSync('npx', ['vite', 'build', '--mode', 'demo', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });

const dist = join(root, 'web', 'dist-demo');
const js = readFileSync(join(dist, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(dist, 'app.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
const html = `<title>Vibe Studio</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024).toFixed(0)} КБ)`);
