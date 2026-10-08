import * as THREE from 'three';
import { cleanGeometry, orientPhoi, phoiStats, countOpenEdges, prepareFaces, analyzeDraft, bestTheta, buildMold, plasterCalc } from '../src/mold.js';
export function demoVase() {
  const prof = [[0,0],[28,0],[34,6],[48,40],[52,70],[44,110],[26,140],[22,160],[26,172],[26,180],[0,180]].map(([x,y])=>new THREE.Vector2(x,y));
  return cleanGeometry(new THREE.LatheGeometry(prof, 48));
}
const g0 = demoVase();
console.log('open edges', countOpenEdges(g0), 'vol', THREE.MathUtils.roundToZero?.(0));
const g = orientPhoi(g0, { shrink: 0.12 });
const st = phoiStats(g); console.log(st);
const F = prepareFaces(g);
for (const n of [2,3]) { const t = bestTheta(F, n, 1); console.log('n',n,'best',t, analyzeDraft(F,n,t,1).area.map(x=>x.toFixed(0))); }
const t0 = Date.now();
const r = buildMold(g, { n:2, theta0:0, wall:30, base:30, spare:25, pourR:18, keys:true, tol:0.4 }, console.log);
console.log('ms', Date.now()-t0, r.dims, r.pieces.map(p=>[p.geometry.attributes.position.count/3, p.volume.toFixed(0), countOpenEdges(cleanGeometry(p.geometry))]));
const tot = r.pieces.reduce((a,p)=>a+p.volume,0);
console.log('plaster', plasterCalc(tot, 0.7, 10));
