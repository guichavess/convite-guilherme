/* Auditoria dos VRM do elenco — lê o GLB direto, sem dependência externa.
   Uso: node docs/auditoria-vrm.js assets/avatars
   Ver docs/transplante-de-partes.md, seção 2. */
const fs=require('fs'),path=require('path');
const DIR=process.argv[2];
function readGLB(f){
  const b=fs.readFileSync(f);
  if(b.readUInt32LE(0)!==0x46546C67) throw new Error('not glb');
  let off=12,json=null,bin=null;
  while(off<b.length){
    const len=b.readUInt32LE(off), type=b.readUInt32LE(off+4);
    const chunk=b.slice(off+8,off+8+len);
    if(type===0x4E4F534A) json=JSON.parse(chunk.toString('utf8'));
    else if(type===0x004E4942) bin=chunk;
    off+=8+len+((4-(len%4))%4===0?0:0);
    off=off; // chunks are 4-byte aligned by spec (len already padded)
  }
  return {json,bin};
}
function accessorFloats(g,bin,idx){
  const a=g.accessors[idx], bv=g.bufferViews[a.bufferView];
  const comp={5126:4}[a.componentType]; if(!comp) return null;
  const n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
  const start=(bv.byteOffset||0)+(a.byteOffset||0);
  const out=new Float32Array(a.count*n);
  for(let i=0;i<a.count*n;i++) out[i]=bin.readFloatLE(start+i*4);
  return {data:out,n,count:a.count};
}
// world matrix of node in bind/rest (scene graph TRS)
function worldPos(g){
  const pos=new Array(g.nodes.length).fill(null);
  const parent=new Array(g.nodes.length).fill(-1);
  g.nodes.forEach((nd,i)=>(nd.children||[]).forEach(c=>parent[c]=i));
  function w(i){
    if(pos[i]) return pos[i];
    const nd=g.nodes[i]; let t=nd.translation||[0,0,0];
    let p=parent[i]>=0? w(parent[i]) : [0,0,0];
    // ignora rotação/escala: VRoid rest é identidade nos ossos
    const r=[p[0]+t[0],p[1]+t[1],p[2]+t[2]];
    pos[i]=r; return r;
  }
  for(let i=0;i<g.nodes.length;i++) w(i);
  return pos;
}
const PARTS=[['hair',/_HAIR(_|$)/i],['tops',/Tops_\d+_CLOTH/i],['bottom',/Bottoms_\d+_CLOTH/i],['shoes',/Shoes_\d+_CLOTH/i],['neck',/AccessoryNeck_\d+_CLOTH/i],['eyes',/EyeIris/i],['skin',/_SKIN(_|$)/i]];
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.vrm'));
const rows=[];
const boneSets={};
for(const f of files){
  const {json:g,bin}=readGLB(path.join(DIR,f));
  const vrm=(g.extensions&&g.extensions.VRM)||{};
  const hb=(vrm.humanoid&&vrm.humanoid.humanBones)||[];
  const bones={}; hb.forEach(b=>bones[b.bone]=b.node);
  boneSets[f]=Object.keys(bones).sort();
  const wp=worldPos(g);
  const gp=n=>bones[n]!=null?wp[bones[n]]:null;
  const head=gp('head'), hips=gp('hips'), ls=gp('leftShoulder')||gp('leftUpperArm'), rs=gp('rightShoulder')||gp('rightUpperArm');
  const lu=gp('leftUpperLeg'), ru=gp('rightUpperLeg'), lf=gp('leftFoot');
  // altura aproximada: topo da cabeça ~ head.y * 1.14; usamos head.y
  const springs=((vrm.secondaryAnimation&&vrm.secondaryAnimation.boneGroups)||[]);
  const springJoints=springs.reduce((s,b)=>s+((b.bones||[]).length),0);
  // spring roots por prefixo de nome de nó
  const springNames=springs.flatMap(b=>(b.bones||[]).map(n=>g.nodes[n].name));
  const hairSprings=springNames.filter(n=>/hair/i.test(n));
  // materiais por peça
  const mats=(g.materials||[]).map(m=>m.name||'');
  const partCount={}; PARTS.forEach(([k,re])=>partCount[k]=mats.filter(n=>re.test(n)).length);
  // skins
  const skins=(g.skins||[]);
  const jointCounts=skins.map(s=>s.joints.length);
  // meshes skinned + primitivas por material
  const meshNodes=(g.nodes||[]).filter(n=>n.mesh!=null);
  const meshInfo=meshNodes.map(n=>{
    const m=g.meshes[n.mesh];
    return {node:n.name,skin:n.skin,prims:m.primitives.length,mats:m.primitives.map(p=>p.material!=null?(g.materials[p.material].name||''):'')};
  });
  // bind pose: inverseBindMatrices translations do skin 0 para ossos-chave
  let bindSample=null;
  if(skins.length&&skins[0].inverseBindMatrices!=null){
    const ibm=accessorFloats(g,bin,skins[0].inverseBindMatrices);
    const j=skins[0].joints;
    const idxHead=j.indexOf(bones['head']);
    if(idxHead>=0&&ibm){ const o=idxHead*16; bindSample=[ibm.data[o+12],ibm.data[o+13],ibm.data[o+14]]; }
  }
  rows.push({file:f,bones:Object.keys(bones).length,headY:head&&head[1],hipsY:hips&&hips[1],
    shoulderW:(ls&&rs)?Math.abs(ls[0]-rs[0]):null, hipW:(lu&&ru)?Math.abs(lu[0]-ru[0]):null,
    footY:lf&&lf[1], springGroups:springs.length, springJoints, hairSpringJoints:hairSprings.length,
    parts:partCount, skins:skins.length, jointCounts, meshInfo, bindHeadIBM:bindSample,
    nodes:g.nodes.length, mats:mats.length});
}
console.log(JSON.stringify({rows,boneSets},null,1));
