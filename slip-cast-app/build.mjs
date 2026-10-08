// Gói toàn bộ code + three.js vào 1 file HTML chạy offline: node build.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/template.html', 'utf8').replace('<script>/*APP*/</script>', () => `<script>${js}</script>`);
writeFileSync('index.html', html);
console.log('index.html', (html.length / 1024).toFixed(0), 'KB');
