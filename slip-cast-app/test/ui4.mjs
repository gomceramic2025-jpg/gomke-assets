import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage(); const logs=[]; p.on('pageerror', e=>logs.push('PE '+e.message)); p.on('console', m=>logs.push(m.text()));
await p.goto('file://' + process.cwd() + '/index.html');
await p.click('#demo'); await p.click('#build');
await p.waitForFunction(() => /Xong|lỗi/.test(document.getElementById('status').textContent), null, {timeout:60000});
console.log(await p.innerHTML('#dlCasings'));
await p.click('#dlCasings button'); await p.waitForTimeout(15000);
console.log(await p.textContent('#status')); console.log(logs); await b.close();
