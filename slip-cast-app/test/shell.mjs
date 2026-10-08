import * as THREE from 'three';
import { cleanGeometry, orientPhoi, prepareFaces, bestLayout, analyzeDraftAngles, meshVolume } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
import { twistedVase } from '../src/sample.js';
const g = orientPhoi(twistedVase(), { shrink: 0.12 });
const F = prepareFaces(g);
const bl = bestLayout(F, 1); console.log('best', bl.n, bl.theta0, bl.score.toFixed(4));
for (const n of [3,4]) {
  const ang = Array.from({length:n},(_,i)=>20+i*360/n);
  const t=Date.now();
  const r = buildShell(g, { angles: ang, wall:25, shell:2, divider:1.6, gap:0.3, spare:25, pourR:16, base:20, keyR:4, clear:0.3 }, ()=>{});
  console.log(n, 'ms', Date.now()-t, 'plaster L', (r.plasterMm3/1e6).toFixed(2), r.dims, r.parts.map(p=>[p.name,(p.geometry.attributes.position.count/3)|0, (Math.abs(meshVolume(p.geometry))/1000).toFixed(0)].join(':')).join(' '));
}
