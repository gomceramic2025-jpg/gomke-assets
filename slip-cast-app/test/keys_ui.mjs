import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const d = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => { window.claude = { use: async (n) => n === 'downloads' ? { save: async ({ filename, data }) => { const buf = await data.arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); window.__z = { filename, b64: btoa(s) }; return { status: 'saved' }; } } : null }; });
await p.goto('file://' + process.cwd() + '/artifact.html');
const settle = () => p.waitForFunction(() => document.getElementById('busy').hidden && /Xong|lỗi/.test(document.getElementById('shStatus').textContent), null, { timeout: 120000 });
await p.waitForTimeout(600); await settle();
console.log('2 mảnh, tự chọn:', (await p.innerText('#shInfo')).replace(/\n/g, ' | '));
await p.fill('#shExplode', '70'); await p.dispatchEvent('#shExplode', 'input'); await p.uncheck('#shShowPanel'); await p.waitForTimeout(500);
await p.evaluate(() => { const a = window.__app; a.camera.position.set(-200, 160, 260); a.controls.target.set(0, 100, 0); a.controls.update(); });
await p.waitForTimeout(300); await p.screenshot({ path: d + '/20_dome_keys.png', clip: { x: 340, y: 40, width: 940, height: 760 } });
// 4 mảnh -> bi rời, tải zip
await p.selectOption('#angEven', '4'); await p.waitForTimeout(300); await p.click('#shBuild'); await p.waitForTimeout(400); await settle();
console.log('4 mảnh, tự chọn:', (await p.innerText('#shInfo')).replace(/\n/g, ' | '));
console.log('nút tải:', await p.$$eval('#shDlParts button', (bs) => bs.map((x) => x.textContent).join(' / ')));
await p.click('#shDlAll'); await p.waitForFunction(() => window.__z, null, { timeout: 60000 });
writeFileSync('/tmp/claude-0/keys.zip', Buffer.from(await p.evaluate(() => window.__z.b64), 'base64'));
// không chốt + bán kính quá lớn so với thành
await p.selectOption('#shKeyType', 'dome'); await p.fill('#shWall', '12'); await p.dispatchEvent('#shWall', 'change'); await p.click('#shBuild'); await p.waitForTimeout(400); await settle();
console.log('thành 12 mm + chốt dome:', (await p.innerText('#shInfo')).replace(/\n/g, ' | '));
await p.selectOption('#shKeyType', 'none'); await p.fill('#shWall', '25'); await p.dispatchEvent('#shWall', 'change'); await p.click('#shBuild'); await p.waitForTimeout(400); await settle();
console.log('không chốt:', (await p.innerText('#shInfo')).replace(/\n/g, ' | '));
console.log('errors', errs); await b.close();
