import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const d = process.argv[2], file = process.argv[3];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + process.cwd() + '/artifact.html');
const settle = () => p.waitForFunction(() => document.getElementById('busy').hidden && /Xong|lỗi/.test(document.getElementById('shStatus').textContent), null, { timeout: 300000 });
await p.waitForTimeout(600); await settle();
if (file) { await p.setInputFiles('#file', file); await p.waitForFunction(() => /3MF|nghìn mặt|Không đọc/.test(document.getElementById('toast').textContent), null, { timeout: 200000 }); await settle(); }
console.log('phôi:', (await p.innerText('#phoiInfo')).split('\n')[0]);
for (const [shape, extra] of [['conformal', ''], ['cylinder', ''], ['box', ''], ['box', 'nopanel']]) {
  await p.selectOption('#shShape', shape);
  if (extra === 'nopanel') { await p.check('#shNoPanel'); await p.click('#shBuild'); } else { await p.uncheck('#shNoPanel').catch(() => {}); await p.waitForTimeout(700); await settle().catch(() => {}); await p.click('#shBuild'); }
  await p.waitForTimeout(400); await settle();
  console.log(shape + (extra ? '+không in vỏ' : ''), '|', await p.textContent('#shStatus'), '|', (await p.innerText('#shInfo')).replace(/\n/g, ' | ').slice(0, 330));
  console.log('   thạch cao:', (await p.innerText('#shPlaster')).split('\n')[0]);
  await p.uncheck('#shShowPanel').catch(() => {}); await p.check('#shShowPanel').catch(() => {});
  await p.fill('#shExplode', '40'); await p.dispatchEvent('#shExplode', 'input'); await p.waitForTimeout(300);
  await p.screenshot({ path: d + `/24_${shape}${extra ? '_np' : ''}.png`, clip: { x: 340, y: 40, width: 940, height: 760 } });
  await p.fill('#shExplode', '0'); await p.dispatchEvent('#shExplode', 'input');
}
console.log('errors', errs); await b.close();
