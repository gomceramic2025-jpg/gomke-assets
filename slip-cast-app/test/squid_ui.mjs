import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const d = process.argv[2], file = process.argv[3], flip = process.argv[4] || '0', n = process.argv[5];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + process.cwd() + '/artifact.html');
const settle = () => p.waitForFunction(() => document.getElementById('busy').hidden && /Xong|lỗi/.test(document.getElementById('shStatus').textContent), null, { timeout: 300000 });
await p.waitForTimeout(600); await settle();
await p.setInputFiles('#file', file);
await p.waitForFunction(() => /3MF|Không đọc/.test(document.getElementById('toast').textContent), null, { timeout: 300000 });
await p.selectOption('#flip', flip); await p.waitForTimeout(500); await settle();
await p.waitForTimeout(800); await p.screenshot({ path: d + `/28_squid_hop_${flip}.png` });
console.log((await p.innerText('#shDraft')).split('\n').slice(0, 2).join(' | '));
await p.selectOption('#shMethod', 'sequential'); await p.waitForTimeout(300);
await p.click('#shBuild'); await p.waitForTimeout(600); await settle();
console.log((await p.innerText('#shInfo')).replace(/\n/g, ' | ').slice(0, 400));
await p.waitForTimeout(800); await p.screenshot({ path: d + `/28_squid_seq_${flip}.png` });
for (const [nm, pos] of [['top', [0, 900, 120]], ['obl', [-300, 520, 520]]]) {
  await p.evaluate(([px, py, pz]) => { const a = window.__app; a.camera.position.set(px, py, pz); a.controls.target.set(0, 0, 0); a.controls.update(); }, pos);
  await p.waitForTimeout(500); await p.screenshot({ path: d + `/28_squid_seq_${flip}_${nm}.png` });
}
console.log('errors', errs); await b.close();
