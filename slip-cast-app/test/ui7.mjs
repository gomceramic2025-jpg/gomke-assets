import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
await p.goto('file://' + process.cwd() + '/artifact.html');
const done = () => p.waitForFunction(() => /Xong|lỗi/.test(document.getElementById('shStatus').textContent) && !document.getElementById('shBuild').disabled, null, { timeout: 100000 });
await done(); console.log('auto:', await p.textContent('#shStatus'));
// chỉnh tay: chia đều 4, rồi dời vách 1 đến 30°
await p.selectOption('#angEven', '4'); await p.waitForTimeout(300);
console.log('rows', await p.locator('.angrow').count(), await p.innerText('#shDraft'));
await p.locator('.angrow input').first().fill('30'); await p.locator('.angrow input').first().dispatchEvent('change'); await p.waitForTimeout(300);
console.log(await p.innerText('#shDraft'));
await p.click('#shBuild'); await p.waitForTimeout(500); await done(); console.log('manual:', await p.textContent('#shStatus'), '|', await p.innerText('#shInfo'));
// tải tất cả (zip) qua mô phỏng capability
await p.evaluate(() => { window.claude = { use: async (n) => n==='downloads' ? { save: async ({filename,data}) => { window.__z = { filename, size: data.size }; return {status:'saved'}; } } : null }; });
await p.click('#shDlAll'); await p.waitForTimeout(3000); console.log('zip', await p.evaluate(()=>window.__z));
// chế độ cũ còn chạy
await p.click('#tabBox'); await p.click('#build'); await p.waitForFunction(() => /Xong|lỗi/.test(document.getElementById('status').textContent), null, {timeout:60000});
console.log('box mode:', await p.textContent('#status'));
console.log(errs); await b.close();
