import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const d = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs=[]; p.on('pageerror', e=>errs.push(e.message)); p.on('console', m=>m.type()==='error'&&errs.push(m.text()));
await p.goto('file://' + process.cwd() + '/artifact.html'); await p.waitForTimeout(500);
await p.click('#tabImg');
// 1. nhiều ảnh
await p.selectOption('#imType','multi'); await p.click('#mvSample'); await p.waitForFunction(()=>/Khối \d/.test(document.getElementById('imInfo').innerText), null, {timeout:60000});
console.log('MULTI:', (await p.innerText('#imInfo')).replace(/\n/g,' | '));
await p.screenshot({ path: d + '/11_multi.png' });
// 2. hoa văn nổi
await p.selectOption('#imType','lathe'); await p.click('#imSample'); await p.waitForTimeout(1500);
await p.selectOption('#emKind','flutes'); await p.waitForTimeout(2500);
console.log('EMBOSS:', (await p.innerText('#imInfo')).replace(/\n/g,' | '));
await p.screenshot({ path: d + '/12_emboss.png' });
// 3. phù điêu + khuôn
await p.selectOption('#imType','relief'); await p.waitForTimeout(2500);
console.log('RELIEF:', (await p.innerText('#imDraftInfo')).replace(/\n/g,' | '));
await p.click('#rmBuild'); await p.waitForFunction(()=>/Hộp đổ \d/.test(document.getElementById('rmInfo').innerText), null, {timeout:60000});
console.log('MOLD:', (await p.innerText('#rmInfo')).replace(/\n/g,' | '));
await p.screenshot({ path: d + '/13_relief_mold.png' });
// 4. nhiều ảnh -> hộp bao
await p.selectOption('#imType','multi'); await p.waitForTimeout(3500); await p.click('#imUse');
await p.waitForFunction(() => /Xong|lỗi/.test(document.getElementById('shStatus').textContent), null, {timeout:100000});
console.log('->HOP BAO:', await p.textContent('#shStatus'), '|', (await p.innerText('#shDraft')).replace(/\n/g,' | '));
console.log(errs); await b.close();
