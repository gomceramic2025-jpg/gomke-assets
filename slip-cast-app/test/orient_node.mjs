// Lưới hở bị lật ngược mặt: phải được lật lại cho mặt hướng ra ngoài
import * as THREE from 'three';
import { cleanGeometry, outwardVote, meshVolume } from '../src/mold.js';
const mk = (flip) => { const g = new THREE.SphereGeometry(40, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.7).toNonIndexed(); if (flip) { const p = g.attributes.position.array; for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; } } return g; };
for (const flip of [false, true]) {
  const c = cleanGeometry(mk(flip));
  console.log('lật' , flip, '| phiếu sau làm sạch', outwardVote(c), '(>0 là đúng)');
}
const c2 = cleanGeometry(new THREE.SphereGeometry(30, 32, 24).toNonIndexed()); console.log('kín: thể tích', meshVolume(c2) > 0 ? 'dương (đúng)' : 'âm');
