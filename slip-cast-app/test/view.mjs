import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const d = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
await p.goto('file://' + process.cwd() + '/index.html');
await p.setInputFiles('#file', d + '/hop.stl'); await p.waitForTimeout(800);
await p.uncheck('#showDraft'); await p.evaluate(() => { const a = window.__app; a.camera.position.set(-300, 350, 380); a.controls.target.set(0, 40, 0); a.controls.update(); });
await p.waitForTimeout(300); await p.screenshot({ path: d + '/4_casing.png', clip: { x: 340, y: 0, width: 760, height: 700 } }); await b.close();
