import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const d = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
// 1. điện thoại, chế độ tối
const m = await b.newPage({ viewport: { width: 390, height: 800 }, colorScheme: 'dark', hasTouch: true }); const errs = [];
m.on('pageerror', e => errs.push(e.message));
await m.goto('file://' + process.cwd() + '/artifact.html');
await m.waitForFunction(() => /Xong|lỗi/.test(document.getElementById('shStatus').textContent), null, { timeout: 120000 });
for (const tab of ['#tabShell', '#tabBox']) { await m.click(tab); await m.waitForTimeout(400);
  const r = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, wide: [...document.querySelectorAll('aside *')].filter(e => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.tagName + '#' + e.id + '.' + e.className).slice(0, 5) }));
  console.log('mobile', tab, JSON.stringify(r)); }
await m.click('#tabShell'); await m.waitForTimeout(300); await m.screenshot({ path: d + '/16_mobile_dark.png' });
// 2. ổn định khi tạo nhiều lần
const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + process.cwd() + '/artifact.html');
const idle = () => p.waitForFunction(() => !document.getElementById('shBuild').disabled && /Xong|lỗi/.test(document.getElementById('shStatus').textContent), null, { timeout: 120000 });
await idle(); const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable');
const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576); };
console.log('heap sau lần 1:', await heap(), 'MB');
const times = [];
for (let i = 0; i < 5; i++) { const t = Date.now(); await p.evaluate(() => { document.getElementById('shStatus').textContent = ''; }); await p.click('#shBuild'); await p.waitForFunction(() => /Xong/.test(document.getElementById('shStatus').textContent), null, { timeout: 120000 }); times.push(((Date.now() - t) / 1000).toFixed(1)); }
console.log('thời gian 5 lần tạo liên tiếp (s):', times.join(', '), '| heap:', await heap(), 'MB');
// 3. đổi qua lại tab và đổi phôi giữa chừng
await p.click('#tabBox'); await p.click('#demo'); await p.waitForTimeout(500); await p.click('#tabShell'); await idle();
console.log('đổi tab + đổi phôi:', await p.textContent('#shStatus'), '| phôi:', await p.textContent('#fileName'));
console.log('errors', errs); await b.close();
