import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 390, height: 800 }, colorScheme: 'dark' }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + process.cwd() + '/artifact.html');
const done = () => p.waitForFunction(() => /Xong|lỗi/.test(document.getElementById('shStatus').textContent) && !document.getElementById('shBuild').disabled, null, { timeout: 120000 });
await done();
const parts = () => p.evaluate(() => window.__app ? window.__app.scene.children.filter(c => c.type === 'Group').map(g => g.children.length) : null);
console.log('trước khi đổi tab:', await parts(), await p.textContent('#shInfo').then(t => t.slice(0, 60)));
await p.click('#tabBox'); await p.waitForTimeout(300); await p.click('#tabShell'); await p.waitForTimeout(300);
console.log('sau khi đổi tab qua lại:', await parts(), await p.textContent('#shStatus'), '|', (await p.textContent('#shInfo')).slice(0, 60));
await p.screenshot({ path: process.argv[2] + '/17_tab_switch.png', clip: { x: 0, y: 0, width: 390, height: 430 } });
// đổi phôi khi đang ở tab 2 mảnh rồi quay lại tab hộp bao: phải làm lại một lần
await p.click('#tabBox'); await p.click('#demo'); await p.waitForTimeout(300); await p.click('#tabShell'); await p.waitForTimeout(900); await done();
console.log('đổi phôi ở tab khác rồi quay lại:', await p.textContent('#shStatus'), '|', await p.textContent('#fileName'));
console.log(errs); await b.close();
