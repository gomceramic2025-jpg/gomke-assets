import * as THREE from 'three';
import { cleanGeometry, orientPhoi, buildMold, buildCasing } from '../src/mold.js';
const prof = [[0,0],[28,0],[34,6],[48,40],[52,70],[44,110],[26,140],[22,160],[26,172],[26,180],[0,180]].map(([x,y])=>new THREE.Vector2(x,y));
const g = orientPhoi(cleanGeometry(new THREE.LatheGeometry(prof, 64)), {shrink:0.12});
for (const wall of [15,20,25,30,32,40,60]) { 
  const b = buildMold(g, { shape:'box', n:2, theta0:0, wall, base:30, spare:25, pourR:18, keys:true, tol:0.4 }, ()=>{});
  for (let k=0;k<2;k++) { try { const c=buildCasing(b,k); console.log(wall,k,'ok',c.volume.toFixed(0)); } catch(e){ console.log(wall,k,'ERR',e.message, e.stack.split('\n').slice(1,4).join('|')); } }
}
