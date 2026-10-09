import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const d = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const lagMonitor = () => { window.__lag = 0; let last = performance.now(); setInterval(() => { const n = performance.now(); window.__lag = Math.max(window.__lag, n - last - 20); last = n; }, 20); };
const settle = (p) => p.waitForFunction(() => document.getElementById('busy').hidden && /Xong|lỗi/.test(document.getElementById('shStatus').textContent), null, { timeout: 120000 });

// 1. có Worker: độ trễ luồng chính khi tạo hộp bao
let p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(lagMonitor);
await p.goto('file://' + process.cwd() + '/artifact.html');
await p.waitForTimeout(700);
await settle(p);
console.log('1. tạo hộp bao tự động: trạng thái =', await p.textContent('#shStatus'), '| độ trễ luồng chính tối đa:', Math.round(await p.evaluate(() => window.__lag)), 'ms | worker dùng:', await p.evaluate(() => !!window.Worker));
// 2. tải file lưới hở: tự vá
await p.evaluate(() => { window.__lag = 0; });
await p.setInputFiles('#file', 'test/tuong_gau_hong.stl');
await p.waitForFunction(() => /Đã tự vá/.test(document.getElementById('toast').textContent), null, { timeout: 60000 });
console.log('2. toast:', await p.textContent('#toast'));
await settle(p);
console.log('   phôi:', (await p.innerText('#phoiInfo')).replace(/\n/g, ' | ').slice(0, 330));
console.log('   hộp bao:', await p.textContent('#shStatus'), '|', (await p.innerText('#shDraft')).split('\n')[0], '| lag tối đa', Math.round(await p.evaluate(() => window.__lag)), 'ms');
await p.screenshot({ path: d + '/18_repaired.png' });
// 3. hủy giữa chừng
await p.click('#shBuild'); await p.waitForTimeout(600);
const busyShown = await p.evaluate(() => !document.getElementById('busy').hidden);
await p.click('#busyCancel'); await p.waitForTimeout(300);
console.log('3. đang chạy có hiện thanh tiến trình:', busyShown, '| sau Hủy: busy ẩn =', await p.evaluate(() => document.getElementById('busy').hidden), '| nút tạo bật lại =', !(await p.isDisabled('#shBuild')), '| toast:', await p.textContent('#toast'));
// 4. đổi phôi giữa lúc đang tạo: chỉ còn kết quả của phôi mới
await p.click('#shBuild'); await p.waitForTimeout(500); await p.click('#demo'); await p.waitForTimeout(1200); await settle(p);
console.log('4. đổi phôi giữa chừng:', await p.textContent('#fileName'), '|', await p.textContent('#shStatus'), '|', (await p.innerText('#shInfo')).split('\n')[1]);
console.log('errors', errs); await p.close();

// 5. không có Worker: chạy trực tiếp
p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const e2 = []; p.on('pageerror', e => e2.push(e.message));
await p.addInitScript(() => { delete window.Worker; });
await p.goto('file://' + process.cwd() + '/artifact.html'); await p.waitForTimeout(700); await settle(p);
console.log('5. không có Worker:', await p.textContent('#shStatus'), '|', e2.length ? e2 : 'không lỗi');
// 6. Worker bị chặn lúc chạy (ném lỗi): vẫn tự chuyển sang chạy trực tiếp
p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const e3 = []; p.on('pageerror', e => e3.push(e.message));
await p.addInitScript(() => { window.Worker = function () { throw new Error('blocked'); }; });
await p.goto('file://' + process.cwd() + '/artifact.html'); await p.waitForTimeout(700); await settle(p);
console.log('6. Worker bị chặn:', await p.textContent('#shStatus'), '|', e3.length ? e3 : 'không lỗi');
await b.close();
