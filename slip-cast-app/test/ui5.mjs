import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const d = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 430, height: 900 }, colorScheme: 'dark', hasTouch: true }); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
await p.goto('file://' + process.cwd() + '/index.html'); await p.waitForTimeout(800);
await p.screenshot({ path: d + '/5_mobile.png' });
await p.evaluate(()=>window.scrollTo(0,700)); await p.waitForTimeout(300); await p.screenshot({ path: d + '/6_mobile_scroll.png' });
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dlSample')]); console.log(dl.suggestedFilename());
console.log(errs); await b.close();
