import * as THREE from 'three';
import { reliefFromImage } from '../src/photo.js';
const W=40,H=30,data=new Uint8ClampedArray(W*H*4);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;const v=x>10&&x<30&&y>8&&y<22?240:20;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}
const r=reliefFromImage({data,width:W,height:H},{widthMm:40,depthMm:5,baseMm:2,cut:false,gridW:40,blur:0});
const g=r.geometry,p=g.attributes.position,ix=g.index;
const c=new THREE.Vector3(20,2,15);let outward=0,inward=0,up=0,down=0;
const a=new THREE.Vector3(),b=new THREE.Vector3(),d=new THREE.Vector3(),n=new THREE.Vector3();
for(let t=0;t<ix.count/3;t++){a.fromBufferAttribute(p,ix.getX(3*t));b.fromBufferAttribute(p,ix.getX(3*t+1));d.fromBufferAttribute(p,ix.getX(3*t+2));
 n.subVectors(b,a).cross(d.clone().sub(a)).normalize(); const m=a.clone().add(b).add(d).divideScalar(3).sub(c);
 if(n.dot(m)>0)outward++;else inward++; if(n.y>0.9)up++; if(n.y<-0.9)down++;}
console.log({outward,inward,up,down, tris:ix.count/3});
import { meshVolume } from '../src/mold.js';
let ys={}; for(let t=0;t<ix.count/3;t++){a.fromBufferAttribute(p,ix.getX(3*t));b.fromBufferAttribute(p,ix.getX(3*t+1));d.fromBufferAttribute(p,ix.getX(3*t+2));
 n.subVectors(b,a).cross(d.clone().sub(a)); const k=Math.sign(Math.round(n.y*100)/100); ys[k]=(ys[k]||0)+1;}
console.log('sign counts of n.y', ys, 'vol', meshVolume(g));
let wo=0,wi=0; for(let t=0;t<ix.count/3;t++){a.fromBufferAttribute(p,ix.getX(3*t));b.fromBufferAttribute(p,ix.getX(3*t+1));d.fromBufferAttribute(p,ix.getX(3*t+2));
 n.subVectors(b,a).cross(d.clone().sub(a)).normalize(); if(Math.abs(n.y)<0.01){const m=a.clone().add(b).add(d).divideScalar(3).sub(c); m.y=0; if(n.dot(m)>0)wo++;else wi++;}}
console.log('walls outward',wo,'inward',wi);
