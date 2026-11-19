const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'call of fruty.html'), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Complete production rendering block must be available');
  return source.slice(a, b);
}

test('all planted and perimeter trees produce finite world positions', () => {
  const positions = [];
  class Geometry {
    toNonIndexed(){ return this; }
    rotateY(){ return this; }
    rotateX(){ return this; }
    translate(x,y,z){ positions.push([x,y,z]); return this; }
  }
  const block = between('const treePos=[];', '  const trunkMerged=');
  vm.runInNewContext(block, {
    planters:[[-42,20],[-42,32],[42,-6],[42,4],[-14,44],[14,44]],
    B(){},P(){},rnd:(a=1,b=0)=>(a+b)/2,TAU:Math.PI*2,
    THREE:{CylinderGeometry:Geometry,PlaneGeometry:Geometry}
  });
  assert.equal(positions.length, 9 * 22);
  assert.ok(positions.every(p=>p.every(Number.isFinite)), 'Trees cannot contain undefined coordinates');
  for(const [x,z] of [[-44,-10],[44,30],[-24,-42]]) {
    assert.ok(positions.some(p=>p[0]===x && p[2]===z && p[1]>0 && p[1]<8));
  }
});

test('fused containers retain the vertex colors defining their visible paint', () => {
  const attrs={position:{count:3},normal:{},uv:{},color:{array:[1,0,0]},unneeded:{}};
  const geo={attributes:{...attrs},deleteAttribute(k){delete this.attributes[k];},dispose(){}};
  let fused, created;
  const material={vertexColors:true};
  const merged={computeBoundingSphere(){}};
  const context={
    buckets:new Map([['steelC',[geo]]]),MAT:{steelC:material},
    mergeGeometries(geos){fused=geos[0].attributes;return merged;},
    THREE:{Mesh:class {constructor(g,m){this.geometry=g;this.material=m;created=this;}updateMatrix(){} }},
    scene:{add(){}}
  };
  vm.runInNewContext(between('function flush(){','function buildHash(){')+'\nflush();',context);
  assert.equal(fused.color, attrs.color, 'Removing vertex colors erases container paint');
  assert.equal('unneeded' in fused, false);
  assert.equal(created.material, material);
});

test('texture canvases never get passed as unsupported material parameters', () => {
  const inputs=[];
  const texture={map:{},roughnessMap:{},normalMap:{},canvas:{}};
  const ctx={MAT:{},TEX:new Proxy({}, {get:()=>texture}),THREE:{
    MeshStandardMaterial:class {constructor(options){inputs.push(options);this.userData={};this.onBeforeCompile=null;}},
    MeshBasicMaterial:class {constructor(options){inputs.push(options);this.userData={};}},
    DoubleSide:2
  }};
  vm.runInNewContext(between('function buildMaterials(){','/*────────────────────────── MOTOR')+'\nbuildMaterials();',ctx);
  assert.ok(inputs.length>10);
  assert.ok(inputs.every(options=>!Object.hasOwn(options,'canvas')), 'Canvas is a texture-generation artifact, not a material property');
  assert.equal(inputs[0].map,texture.map);
});

test('viewmodel sleeve material passes texture maps without the source canvas', () => {
  const texture={map:{},roughnessMap:{},normalMap:{},canvas:{}};
  let parameters;
  const block=between('const armMat=', '  const gloveMat=');
  vm.runInNewContext(block,{TEX:{camo:texture},THREE:{MeshStandardMaterial:class {constructor(p){parameters=p;}}}});
  assert.equal(Object.hasOwn(parameters,'canvas'),false);
  assert.equal(parameters.map,texture.map);
  assert.equal(parameters.normalMap,texture.normalMap);
});

test('all selectable quality levels avoid the broken multisample HDR resolve path', () => {
  const ctx=vm.createContext({});
  vm.runInContext(between('const QUAL=[','const S=')+';globalThis.levels=QUAL;',ctx);
  assert.equal(ctx.levels.length,4);
  assert.ok(ctx.levels.every(q=>q.msaa===0), 'High and ultra must render a visible scene too');
  assert.ok(ctx.levels[3].pr>ctx.levels[0].pr);
});

test('resuming gameplay clears pause blur on the first rendered frame', () => {
  const uniforms=Object.fromEntries(['uTime','uDamage','uFlash','uAds','uBlur','uPause','uVig'].map(k=>[k,{value:k==='uBlur'?5.5:0}]));
  vm.runInNewContext(between('  const gu=gradePass.uniforms;', '  composer.render(dt);'),{
    gradePass:{uniforms},clock:{t:2},dt:.016,G:{state:'playing'},player:{adsT:0,hp:100},
    damp:(a,b,s,dt)=>a+(b-a)*(1-Math.exp(-s*dt))
  });
  assert.equal(uniforms.uBlur.value,0);
});

test('resize synchronizes postprocessing resolution with the render pixel ratio', () => {
  let ratio=1, size;
  const ctx={innerWidth:1280,innerHeight:720,camera:{updateProjectionMatrix(){}},viewCamera:{updateProjectionMatrix(){}},
    renderer:{setSize(){},getPixelRatio:()=>1.5,getDrawingBufferSize(out){out.x=1920;out.y=1080;}},
    composer:{setPixelRatio(r){ratio=r;},setSize(w,h){size=[w*ratio,h*ratio];}},
    gradePass:{uniforms:{uRes:{value:{set(){}}}}},bloomPass:{setSize(){}},
    THREE:{Vector2:class {}}};
  vm.runInNewContext(between('function onResize(){',"addEventListener('resize',onResize);")+'\nonResize();',ctx);
  assert.deepEqual(size,[1920,1080], 'The composer must follow actual render resolution after quality changes');
});
