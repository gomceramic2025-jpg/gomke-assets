import * as THREE from 'three';
import { cleanGeometry, orientPhoi, buildMold, buildCasing } from '../src/mold.js';
const prof = [[0,0],[28,0],[34,6],[48,40],[52,70],[44,110],[26,140],[22,160],[26,172],[26,180],[0,180]].map(([x,y])=>new THREE.Vector2(x,y));
const g = orientPhoi(cleanGeometry(new THREE.LatheGeometry(prof, 64)), {shrink:0.12});
const b = buildMold(g, { shape:'box', n:2, theta0:0, wall:30, base:30, spare:25, pourR:18, keys:true, tol:0.4 }, ()=>{});
const e = (()=>{ try { casingAttempt0(b); } catch(e){ return e.stack; } })();
console.log(e.split('\n').filter(l=>l.includes('mold.js')||l.includes('csg')).slice(0,6).join('\n'));
