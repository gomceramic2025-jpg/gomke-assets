import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/claude-0/bad.stl', 'this is not a model');
writeFileSync('/tmp/claude-0/empty.stl', '');
writeFileSync('/tmp/claude-0/quad.obj', 'v 0 0 0\nv 40 0 0\nv 40 40 0\nv 0 40 0\nv 0 0 40\nv 40 0 40\nv 40 40 40\nv 0 40 40\nf 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + process.cwd() + '/artifact.html');
const idle = () => p.waitForFunction(() => !document.getElementById('shBuild').disabled && /Xong|lỗi|^$/.test(document.getElementById('shStatus').textContent), null, { timeout: 120000 });
await idle();
const visibleMsgs = () => p.evaluate(() => [...document.querySelectorAll('#toast,#fileName,#shStatus')].filter(e => e.offsetParent !== null).map(e => e.id + ': ' + e.textContent.slice(0, 90)));
for (const f of ['bad.stl', 'empty.stl']) { await p.setInputFiles('#file', '/tmp/claude-0/' + f); await p.waitForTimeout(700); console.log('A', f, '=> visible:', JSON.stringify(await visibleMsgs()), '| #status hidden?', await p.evaluate(() => document.getElementById('status').offsetParent === null)); }
await p.setInputFiles('#file', 'test/cube.stl'); await p.waitForTimeout(500); await idle();
await p.setInputFiles('#file', '/tmp/claude-0/quad.obj'); await p.waitForTimeout(500); await idle(); console.log('A obj quad =>', (await p.innerText('#phoiInfo')).split('\n')[0]);
// B: góc trùng nhau
await p.evaluate(() => { const i = document.querySelectorAll('.angrow input'); i[1].value = i[0].value; i[1].dispatchEvent(new Event('change')); });
await p.waitForTimeout(400); console.log('B dup angles =>', (await p.innerText('#shDraft')).replace(/\n/g, ' | '), '| build disabled:', await p.isDisabled('#shBuild'));
// C: co ngót 100
await p.fill('#shrink', '100'); await p.dispatchEvent('#shrink', 'change'); await p.waitForTimeout(1500);
console.log('C shrink=100 =>', (await p.innerText('#phoiInfo')).split('\n')[0], '| errs', errs.length);
await p.fill('#shrink', '12'); await p.dispatchEvent('#shrink', 'change'); await p.waitForTimeout(500); await idle();
// D: wall = 0
await p.fill('#shWall', '0'); await p.dispatchEvent('#shWall', 'change'); await p.click('#shBuild'); await p.waitForTimeout(3000); await idle();
console.log('D wall=0 =>', await p.textContent('#shStatus'), '| toast:', await p.textContent('#toast'));
await p.fill('#shWall', '25'); await p.dispatchEvent('#shWall', 'change');
// E: đổi nhanh nhiều lần
await p.evaluate(() => { window.__done = 0; new MutationObserver(() => { if (/Xong/.test(document.getElementById('shStatus').textContent)) window.__done++; }).observe(document.getElementById('shStatus'), { childList: true, characterData: true, subtree: true }); });
for (const v of ['10', '11', '12', '13']) { await p.fill('#shrink', v); await p.dispatchEvent('#shrink', 'change'); await p.waitForTimeout(40); }
await p.waitForTimeout(500); await idle(); await p.waitForTimeout(15000); console.log('E số lần tạo hộp bao sau 4 lần đổi co ngót nhanh:', await p.evaluate(() => window.__done));
console.log('errors', errs); await b.close();
