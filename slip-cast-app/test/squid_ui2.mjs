import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const d = process.argv[2], file = process.argv[3], flip = process.argv[4] || '0', which = (process.argv[5] || '0,1').split(',').map(Number);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 760 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + process.cwd() + '/artifact.html');
const settle = () => p.waitForFunction(() => document.getElementById('busy').hidden && /Xong|lỗi/.test(document.getElementById('shStatus').textContent), null, { timeout: 300000 });
await p.waitForTimeout(600); await settle();
await p.setInputFiles('#file', file);
await p.waitForFunction(() => /3MF|Không đọc/.test(document.getElementById('toast').textContent), null, { timeout: 300000 });
await p.selectOption('#flip', flip); await p.waitForTimeout(500); await settle();
await p.selectOption('#shMethod', 'sequential'); await p.waitForTimeout(300);
await p.click('#shBuild'); await p.waitForTimeout(600); await settle();
console.log((await p.innerText('#shInfo')).split('\n').slice(2, 7).join(' | '));
for (const w of which) {
  await p.evaluate((w) => {
    const a = window.__app; const THREE = a.THREE; const meshes = []; a.scene.traverse((o) => { if (o.isMesh && o.userData && o.userData.kind === 'plate') meshes.push(o); });
    a.scene.traverse((o) => { if (o.isMesh && o.userData && ['plate', 'frame', 'funnel'].includes(o.userData.kind)) o.visible = false; });
    const m = meshes[w]; m.visible = true; m.geometry.computeBoundingBox();
    const bb = new THREE.Box3().setFromObject(m), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()).length();
    a.camera.position.set(c.x - sz * 0.6, c.y + sz * 0.9, c.z + sz * 0.9); a.controls.target.copy(c); a.controls.update();
  }, w);
  await p.waitForTimeout(600); await p.screenshot({ path: d + `/29_plate_${flip}_${w}.png` });
}
console.log('errors', errs); await b.close();
