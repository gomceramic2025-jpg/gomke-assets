import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const d = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + process.cwd() + '/artifact.html');
const settle = () => p.waitForFunction(() => document.getElementById('busy').hidden && /Xong|lỗi/.test(document.getElementById('shStatus').textContent), null, { timeout: 120000 });
await p.waitForTimeout(600); await settle();
await p.selectOption('#shMethod', 'sequential');
await p.waitForTimeout(300);
await p.click('#shBuild'); await p.waitForTimeout(400); await settle();
console.log(await p.textContent('#shStatus'));
console.log((await p.innerText('#shInfo')).replace(/\n/g, ' | ').slice(0, 500));
console.log('nút tải:', (await p.innerText('#shDlParts')).replace(/\n/g, ' / '));
console.log('thạch cao:', (await p.innerText('#shPlaster')).split('\n')[0]);
await p.waitForTimeout(500); await p.screenshot({ path: d + '/25_seq.png' });
// 3 mảnh: thêm vách chia qua nút phân tích tự động với phôi cầu? dùng nút "Tự phân tích"
await p.click('#shAuto'); await p.waitForTimeout(500); await settle();
console.log('sau tự phân tích:', await p.textContent('#shStatus'), '|', (await p.innerText('#shInfo')).split('\n')[0].slice(0, 200));
// quay lại đổ cùng lúc
await p.selectOption('#shMethod', 'together'); await p.waitForTimeout(300);
await p.click('#shBuild'); await p.waitForTimeout(400); await settle();
console.log('đổ cùng lúc:', await p.textContent('#shStatus'), '|', (await p.innerText('#shInfo')).split('\n')[0].slice(0, 160));
console.log('errors', errs);
await b.close();
