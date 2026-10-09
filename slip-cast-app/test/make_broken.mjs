import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { cleanGeometry } from '../src/mold.js';
const buf = readFileSync('test/tuong_gau_test.stl');
const good = cleanGeometry(new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; const ix = good.index.array, keep = [];
for (let i = 0; i < ix.length; i += 3) { const r = rnd(); if (r < 0.012) continue; if (r > 0.97) keep.push(ix[i], ix[i + 2], ix[i + 1]); else keep.push(ix[i], ix[i + 1], ix[i + 2]); }
const bad = new THREE.BufferGeometry(); bad.setAttribute('position', good.attributes.position.clone()); bad.setIndex(keep);
const dv = new STLExporter().parse(new THREE.Mesh(bad.toNonIndexed()), { binary: true });
writeFileSync('test/tuong_gau_hong.stl', Buffer.from(dv.buffer, dv.byteOffset, dv.byteLength));
console.log('đã ghi tuong_gau_hong.stl, số mặt', keep.length / 3);
