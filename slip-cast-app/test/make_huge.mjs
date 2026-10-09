import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { writeFileSync } from 'node:fs';
import { surfaceNets } from './surfacenets_tool.js';
// Tượng gấu độ phân giải rất cao (>1 triệu mặt), như file quét hoặc xuất từ phần mềm điêu khắc
const els = [[0,52,0,36,46,32],[0,112,2,28,26,26],[-20,134,0,10,10,7],[20,134,0,10,10,7],[0,106,26,12,9,9],[-48,68,6,11,28,12,.55],[48,68,6,11,28,12,-.55],[-17,14,14,13,11,17],[17,14,14,13,11,17]];
const sd=(x,y,z,e)=>{const dx=x-e[0],dy=y-e[1],dz=z-e[2],rz=e[6]||0,c=Math.cos(-rz),s=Math.sin(-rz),px=dx*c-dy*s,py=dx*s+dy*c;return (Math.hypot(px/e[3],py/e[4],dz/e[5])-1)*Math.min(e[3],e[4],e[5]);};
const smin=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
const field=(x,y,z)=>{let d=Math.max(Math.hypot(x,z)-32,Math.abs(y-4)-4);for(const e of els)d=smin(d,sd(x,y,z,e),9);return d+0.15*Math.sin(x*0.9)*Math.sin(y*0.8+z*0.5)*0.5;}; // thêm vân nhỏ
const vs=+process.argv[2]||0.42, nx=Math.ceil(160/vs), ny=Math.ceil(165/vs), nz=Math.ceil(110/vs), ox=-nx*vs/2, oy=-3, oz=-nz*vs/2;
const f=new Float32Array(nx*ny*nz);
for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){f[(k*ny+j)*nx+i]=Math.min(1,Math.max(0,.5-field(ox+i*vs,oy+j*vs,oz+k*vs)/(2*vs)));}
let g=surfaceNets(f,nx,ny,nz,vs,(i,j,k)=>[ox+i*vs,oy+j*vs,oz+k*vs],{blur:0,smooth:0});
const ix=g.index.array; let vol=0; const p=g.attributes.position.array;
for(let i=0;i<ix.length;i+=3){const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;vol+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])-p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}
if(vol<0)for(let i=0;i<ix.length;i+=3){const t=ix[i+1];ix[i+1]=ix[i+2];ix[i+2]=t;}
console.log('mặt:',ix.length/3,'thể tích cm3',(Math.abs(vol)/1000).toFixed(1));
const nonIdx=g.toNonIndexed(); const dv=new STLExporter().parse(new THREE.Mesh(nonIdx),{binary:true});
writeFileSync('/tmp/claude-0/tuong_gau_nang.stl',Buffer.from(dv.buffer,dv.byteOffset,dv.byteLength)); console.log('file MB',(dv.byteLength/1048576).toFixed(0));
