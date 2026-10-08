// Gói code + three.js thành: index.html (chạy độc lập) và artifact.html (đăng lên claude.ai): node build.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const out = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const body = readFileSync('src/template.html', 'utf8').replace('<script>/*APP*/</script>', () => `<script>${js}</script>`);
writeFileSync('artifact.html', body);
writeFileSync('index.html', `<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<style>body{margin:0}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`);
console.log('ok', (body.length / 1024).toFixed(0), 'KB');
