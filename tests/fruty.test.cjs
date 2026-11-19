const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'call of fruty.html'), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];

function declaration(name, source = script) {
  const match = new RegExp(`(?:const|let) ${name}\\s*=|function ${name}\\s*\\(|class ${name}\\s*\\{`).exec(source);
  assert.ok(match, `Production declaration missing: ${name}`);
  const start = match.index;
  const open = source.slice(start).search(/[\[{]/) + start;
  assert.ok(open >= start);
  let depth = 0, quote = '', line = false, block = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '/' && next === '/') { line = true; i++; continue; }
    if (c === '/' && next === '*') { block = true; i++; continue; }
    if ('\'"`'.includes(c)) { quote = c; continue; }
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`Unclosed production declaration: ${name}`);
}
function load(names, globals = {}) {
  const ctx = vm.createContext(globals);
  vm.runInContext(names.map(name=>declaration(name)).join(';\n') + ';', ctx);
  return {ctx, run: code => vm.runInContext(code, ctx)};
}
function microtaskQueue() {
  const pending=[];
  return {
    queueMicrotask:fn=>pending.push(fn),
    flushMicrotasks(){while(pending.length)pending.shift()();}
  };
}

// Removing a chapter or indexing from zero loses the player's current mission.
test('chapters cover every campaign wave and replay without a narrative cursor', () => {
  const {run} = load(['STORY', 'getWaveStory']);
  for (let wave = 1; wave <= 10; wave++) {
    const chapter = run(`getWaveStory(${wave})`);
    assert.ok(chapter.title && chapter.objective && chapter.debrief);
    assert.equal(chapter.radio.length, 2);
    for (const line of chapter.radio) assert.ok(line.speaker && line.text);
  }
  assert.match(run('getWaveStory(1).title'), /Cuarentena/i);
  assert.match(run('getWaveStory(10).title'), /Pulpa/i);
  run('getWaveStory(10)');
  assert.match(run('getWaveStory(1).title'), /Cuarentena/i);
});

test('endless waves never repeat the final assault', () => {
  const {run} = load(['STORY', 'CONTAINMENT', 'getWaveStory']);
  for (const wave of [11, 25, 100]) {
    const chapter = run(`getWaveStory(${wave})`);
    assert.match(chapter.title, /Contención/i);
    assert.doesNotMatch(chapter.objective, /extracción|último|final/i);
  }
});

test('fruit variants preserve combat balance', () => {
  const {run} = load(['ETYPES']);
  const expected = {rifle:[100,3.5,7,100,'Manzana Comando'],rush:[85,5.4,9,130,'Limón Rabioso'],marks:[90,2.8,34,170,'Pera Vigía'],heavy:[320,2.3,6,320,'Sandía Acorazada']};
  for (const [key, [hp,speed,dmg,score,name]] of Object.entries(expected)) {
    const type = run(`ETYPES.${key}`);
    assert.deepEqual([type.hp,type.speed,type.dmg,type.score], [hp,speed,dmg,score]);
    assert.equal(type.name, name);
    assert.equal(typeof type.juice, 'number');
  }
  assert.equal(run('ETYPES.heavy.helmet && ETYPES.heavy.boss'), true);
  assert.equal(run('ETYPES.marks.laser && ETYPES.rush.shotgun'), true);
});

test('wave composition preserves deterministic counts and type thresholds', () => {
  const original=fs.readFileSync(path.join(__dirname,'fixtures','original-contracts.txt'),'utf8');
  for (const rng of [.1,.99]) {
    const S={diff:1}, MathFixed=Object.assign(Object.create(Math),{random:()=>rng});
    const {run} = load(['DIFF','waveComposition'], {S,Math:MathFixed});
    const baseline=vm.createContext({S,Math:MathFixed});
    vm.runInContext(['DIFF','waveComposition'].map(name=>declaration(name,original)).join(';'),baseline);
    for (const [wave,count,extra] of [[1,6,0],[2,8,0],[3,10,0],[5,14,1],[10,24,1],[11,26,2]]) {
      const types=Array.from(run(`waveComposition(${wave})`));
      const type=rng===.1 ? (wave===1?'rifle':'rush') : (wave>=5?'heavy':wave>=3?'marks':'rifle');
      assert.deepEqual(types,[...Array(count).fill(type),...Array(extra).fill('heavy')]);
      assert.equal(types.length,vm.runInContext(`waveComposition(${wave}).length`,baseline));
    }
    for (S.diff=0;S.diff<4;S.diff++) for (let wave=1;wave<=11;wave++) {
      assert.deepEqual(Array.from(run(`waveComposition(${wave})`)),Array.from(vm.runInContext(`waveComposition(${wave})`,baseline)));
    }
  }
});

test('only the final queued heavy of wave ten becomes the commander', () => {
  const spawned = [];
  const G = {state:'playing',wave:10,waveSpawned:0,waveTotal:4,spawnT:-1};
  const globals = {G, S:{diff:1}, enemies:[], waveQueue:['heavy','rifle','heavy','heavy'],spawnPoints:[[30,30]],player:{pos:{x:0,z:0}},rnd:()=>1,rint:()=>0,updateObjectiveHUD:()=>{},spawnEnemy:(type,x,z,commander=false)=>{spawned.push({type,commander});return {pos:{set(){}}};}};
  const {run} = load(['DIFF','updateSpawns'], globals);
  for (const wave of [1,5,10,11]) {
    G.wave = wave; G.waveSpawned = 0; spawned.length = 0;
    for (let i=0;i<4;i++) { G.spawnT = -1; run('updateSpawns(.016)'); }
    assert.deepEqual(spawned.map(e=>e.commander), wave===10 ? [false,false,false,true] : [false,false,false,false]);
    assert.deepEqual(spawned.map(e=>e.type), ['heavy','rifle','heavy','heavy']);
  }
});

test('boss targeting prioritizes the living commander and falls back after death', () => {
  const regular = {type:{boss:true},isCommander:false,dead:false};
  const commander = {type:{boss:true},isCommander:true,dead:false};
  const enemies = [regular,commander];
  const {run} = load(['getBossTarget'], {enemies});
  assert.equal(run('getBossTarget()'), commander);
  commander.dead = true;
  assert.equal(run('getBossTarget()'), regular);
  regular.dead = true;
  assert.equal(run('getBossTarget()') ?? null, null);
});

// Only the rendering boundary is doubled; production FX select every color/material.
class FXColor {
  constructor(hex) { this.r=((hex>>16)&255)/255; this.g=((hex>>8)&255)/255; this.b=(hex&255)/255; }
}
class FXVector {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
  normalize() { const n=Math.hypot(this.x,this.y,this.z)||1; return this.set(this.x/n,this.y/n,this.z/n); }
  clone() { return new FXVector(this.x,this.y,this.z); }
  copy(v) { return this.set(v.x,v.y,v.z); }
  add(v) { return this.addScaledVector(v,1); }
  applyQuaternion() { return this; }
  applyMatrix4() { return this; }
  project() { return this.set(0,0,0); }
  distanceTo(v) { return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z); }
  sub(v) { return this.set(this.x-v.x,this.y-v.y,this.z-v.z); }
  crossVectors(a,b) { return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x); }
  addScaledVector(v,s) { return this.set(this.x+v.x*s,this.y+v.y*s,this.z+v.z*s); }
  multiplyScalar(s) { return this.set(this.x*s,this.y*s,this.z*s); }
}
const fxRandom = Object.assign(Object.create(Math), {random:()=>.1});
const fxRnd = (a=1,b=0)=>b+.1*(a-b);

// Dropping e.type at the call site must lose the actual hit's species color.
test('damageEnemy forwards species into juice particles and decals', () => {
  const smoke=[], sparks=[], stains=[];
  const e={dead:false,hp:100,shield:0,maxShield:0,flinch:0,state:'cover',type:{juice:0xff0000}};
  const hitPos={x:2,y:1,z:3}, dir={x:0,y:0,z:1}, lastSeen={x:4,y:0,z:5};
  const {run}=load(['splitDamage','damageEnemy','bloodFX'], {
    e,hitPos,player:{pos:{clone:()=>({...lastSeen})}},_dir:dir,
    THREE:{Color:FXColor},q:{particles:1},rnd:fxRnd,Math:fxRandom,
    pSmoke:{spawn:(...args)=>smoke.push(args)},pAdd:{spawn:(...args)=>sparks.push(args)},
    addDecal:(...args)=>stains.push(args),Audio:{impact(){}}
  });
  for (const [juice,rgb,head,count] of [[0xff0000,[1,0,0],false,10],[0x00ff00,[0,1,0],true,16]]) {
    e.type={juice}; smoke.length=0; sparks.length=0;
    run(`damageEnemy(e,10,${head},false,hitPos)`);
    assert.equal(smoke.length,count); assert.equal(sparks.length,4);
    for (const p of [...smoke,...sparks]) assert.deepEqual(p.slice(6,9),rgb);
    assert.equal(stains.at(-1)[6],'juice'+juice);
  }
  assert.equal(e.hp,80); assert.equal(e.flinch,.36);
  assert.deepEqual(e.lastSeen,lastSeen); assert.notEqual(e.lastSeen,lastSeen);
  const count=stains.length;
  run('damageEnemy(e,5,false,false,null)'); assert.equal(stains.length,count);
  e.dead=true;
  run('damageEnemy(e,5,false,false,hitPos)'); assert.equal(e.hp,75);
});

// Death cannot leave the last muzzle flash lit or emit the old red blood.
test('killEnemy emits species juice and extinguishes flash and optional laser', () => {
  const smoke=[],enemies=[],corpses=[];
  const {queueMicrotask,flushMicrotasks}=microtaskQueue();
  const {run,ctx}=load(['killEnemy'], {
    enemies,corpses,THREE:{Color:FXColor,Vector3:FXVector},q:{particles:1},rnd:fxRnd,Math:fxRandom,
    pSmoke:{spawn:(...args)=>smoke.push(args)},G:{waveKilled:0},checkWave(){},queueMicrotask
  });
  for (const laser of [null,{material:{opacity:1}}]) {
    const e={type:{juice:0x00ff00},pos:{x:2,y:0,z:3},flash:{material:{opacity:1}},flashT:.05,laser};
    enemies.push(e); ctx.e=e; smoke.length=0;
    run('killEnemy(e,false,false)');
    assert.equal(e.dead,true); assert.equal(e.flash.material.opacity,0);
    if(laser) assert.equal(laser.material.opacity,0);
    assert.equal(enemies.includes(e),false); assert.equal(corpses.at(-1),e);
    assert.equal(smoke.length,12);
    for(const p of smoke) assert.deepEqual(p.slice(6,9),[0,1,0]);
    flushMicrotasks();
  }
});

// A recycled slot must switch material, never recolor existing juice or bullet holes.
test('decal pool reuses species materials without mutating previous stains or holes', () => {
  const TEX={hole:{},juice:{},scorch:{}};
  const THREE={
    PlaneGeometry:class {},
    MeshBasicMaterial:class { constructor(options){Object.assign(this,options);this.color=new FXColor(options.color);} },
    Mesh:class {
      constructor(geometry,material){Object.assign(this,{geometry,material,position:new FXVector(),scale:{setScalar(){}},visible:true});}
      lookAt(){} rotateZ(){}
    }
  };
  const {run}=load(['ETYPES','decals','initFX','addDecal'], {
    THREE,TEX,Particles:class {},q:{particles:1},scene:{add(){}},_v1:new FXVector(),rnd:fxRnd,TAU:Math.PI*2
  });
  run('let decalIdx=0; initFX(); addDecal(1,0,1,0,1,0,"hole",1);');
  const slots=run('decals'),hole=slots[0].m.material;
  assert.equal(slots.length,110);
  for(const [i,key] of ['rifle','rush','marks','heavy'].entries()) {
    run(`addDecal(1,0,1,0,1,0,'juice'+ETYPES.${key}.juice,1)`);
    assert.equal(slots[i+1].m.material?.map,TEX.juice);
  }
  const apple=slots[1].m.material,lemon=slots[2].m.material;
  const appleColor={...apple.color},holeColor={...hole.color};
  run("decalIdx=3; addDecal(1,0,1,0,1,0,'juice'+ETYPES.rifle.juice,1);");
  assert.equal(slots[3].m.material,apple);
  run("decalIdx=111; addDecal(1,0,1,0,1,0,'juice'+ETYPES.rush.juice,1);");
  assert.equal(slots[1].m.material,lemon); assert.equal(slots[3].m.material,apple);
  assert.deepEqual({...apple.color},appleColor); assert.deepEqual({...hole.color},holeColor);
  assert.equal(slots[0].m.material,hole); assert.equal(hole.map,TEX.hole);
  assert.deepEqual([lemon.color.r,lemon.color.g,lemon.color.b],[1,237/255,69/255]);
  run('decalIdx=1; addDecal(1,0,1,0,1,0,"hole",1);');
  assert.equal(slots[1].m.material,hole);
  run('addDecal(1,0,1,0,1,0,"scorch",1);');
  assert.equal(slots[2].m.material.map,TEX.scorch); assert.equal(slots[2].life,60);
  assert.equal(new Set(slots.map(d=>d.mats)).size,1);
});

test('juice mask preserves original RNG order, splat geometry and opacity', () => {
  const original=fs.readFileSync(path.join(__dirname,'fixtures','original-contracts.txt'),'utf8');
  function render(source) {
    const start=source.search(/TEX\.(?:blood|juice)=spriteTex\(128/);
    const block=source.slice(start,source.indexOf('TEX.scorch=',start));
    let seed=19,calls=0; const shapes=[],fills=[],TEX={};
    const random=()=>{calls++;seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const canvas={clearRect(){},beginPath(){},ellipse:(...args)=>shapes.push(args),fill(){fills.push(this.fillStyle);}};
    vm.runInNewContext(block,{TEX,TAU:Math.PI*2,Math:Object.assign(Object.create(Math),{random}),
      rnd:(a=1,b=0)=>b+random()*(a-b),spriteTex:(s,draw)=>{draw(canvas,s);return canvas;}});
    return {TEX,shapes,fills,calls,seed};
  }
  const before=render(original),after=render(script);
  assert.deepEqual(after.shapes,before.shapes); assert.equal(after.calls,before.calls); assert.equal(after.seed,before.seed);
  assert.equal(after.TEX.juice?.fillStyle,after.fills.at(-1));
  for(let i=0;i<after.fills.length;i++) {
    const rgba=after.fills[i].match(/[\d.]+/g).map(Number);
    assert.deepEqual(rgba.slice(0,3),[255,255,255]);
    assert.equal(rgba[3],Number(before.fills[i].match(/[\d.]+/g)[3]));
  }
});

function intermissionKeyboard() {
  const G={state:'inter',wave:6,picks:['mag','dmg','armor']},keys={},chosen=[];
  let handler;
  const start=script.indexOf("addEventListener('keydown',e=>{");
  const end=script.indexOf("addEventListener('keyup'",start);
  assert.ok(start>=0 && end>start);
  vm.runInNewContext(script.slice(start,end),{
    G,keys,addEventListener:(type,fn)=>{assert.equal(type,'keydown');handler=fn;},
    nextWave:()=>{G.wave++;G.state='playing';},chooseUpgrade:u=>chosen.push(u)
  });
  return {G,keys,chosen,press(code,target){
    let prevented=false;
    handler({code,target,preventDefault(){prevented=true;}});
    return prevented;
  }};
}

for (const code of ['Enter','Space']) test(`intermission summary keeps native ${code} without starting a wave`,()=>{
  const summary={closest:selector=>selector==='summary'?summary:null};
  for (const target of [summary,{closest:selector=>summary.closest(selector)}]) {
    const keyboard=intermissionKeyboard();
    assert.equal(keyboard.press(code,target),false);
    assert.equal(keyboard.G.wave,6);
    assert.equal(keyboard.G.state,'inter');
    assert.notEqual(keyboard.keys[code],true);
  }
});

test('intermission window and action shortcuts remain available',()=>{
  for (const target of [{},{closest:()=>null}]) for (const code of ['Enter','Space']) {
    const keyboard=intermissionKeyboard();
    keyboard.press(code,target);
    assert.equal(keyboard.G.wave,7);assert.equal(keyboard.G.state,'playing');
  }
  const keyboard=intermissionKeyboard(),summary={closest:()=>summary};
  for (const code of ['Digit1','Digit2','Digit3']) keyboard.press(code,summary);
  assert.deepEqual(keyboard.chosen,['mag','dmg','armor']);
});

for (const [wave,state,delay] of [[1,'waveclear',1400],[10,'victory',1200]]) {
  test(`non-player deaths finish wave ${wave} only after every queued enemy spawns`,()=>{
    const G={state:'playing',wave,waveTotal:2,waveSpawned:1,waveKilled:0,score:0,
      stats:{kills:4,head:2,waves:0},bonus:{k:'head'},bonusGoal:3,bonusProgress:2};
    const player={kills:4,streak:3},enemies=[],corpses=[],jobs=[],completed=[],scoreCounts=[];
    const {queueMicrotask,flushMicrotasks}=microtaskQueue();
    let now=0;
    const forbidden=()=>assert.fail('Non-player death granted a player-only effect');
    const {run,ctx}=load(['ETYPES','killEnemy','checkWave','bonusValue'],{
      G,player,enemies,corpses,THREE:{Color:FXColor,Vector3:FXVector},q:{particles:0},rnd:fxRnd,Math:fxRandom,
      pSmoke:{spawn(){}},Audio:{clear(){}},updateObjectiveHUD(){},
      addScore:value=>{G.score+=value;scoreCounts.push(G.waveKilled);},
      feed:forbidden,spawnPickup:forbidden,activateUAV:forbidden,
      queueMicrotask,setTimeout:(fn,ms)=>jobs.push({fn,at:now+ms}),
      openIntermission:()=>completed.push('inter'),showEnd:won=>completed.push(won)
    });
    const makeEnemy=()=>({type:run('ETYPES.rifle'),pos:new FXVector(2,0,3),flash:{material:{opacity:1}}});
    ctx.e=makeEnemy();enemies.push(ctx.e);
    run('killEnemy(e,true,false)');
    assert.equal(G.waveKilled,1);assert.equal(enemies.length,0);
    assert.equal(G.state,'playing');assert.equal(jobs.length,0);
    flushMicrotasks();
    assert.equal(G.state,'playing');assert.equal(jobs.length,0);
    G.waveSpawned=2;ctx.e=makeEnemy();enemies.push(ctx.e);
    run('killEnemy(e,true,false)');
    assert.equal(G.waveKilled,2);assert.equal(enemies.length,0);
    assert.equal(G.state,'playing');assert.equal(G.score,0);assert.equal(jobs.length,0);
    flushMicrotasks();
    assert.equal(G.state,state);assert.equal(G.stats.waves,1);
    assert.deepEqual(scoreCounts,[2]);assert.equal(G.score,500+wave*120);
    assert.deepEqual(player,{kills:4,streak:3});assert.equal(G.stats.kills,4);
    assert.equal(G.stats.head,2);assert.equal(G.bonusProgress,2);
    assert.equal(jobs.length,1);assert.equal(jobs[0].at,delay);assert.deepEqual(completed,[]);
    const advance=ms=>{now+=ms;for(const job of jobs.splice(0))if(job.at<=now)job.fn();else jobs.push(job);};
    advance(delay-1);assert.deepEqual(completed,[]);
    advance(1);assert.deepEqual(completed,[wave===10?true:'inter']);
    run('checkWave()');assert.equal(jobs.length,0);assert.equal(G.stats.waves,1);
  });
}

// Real combat, scoring and line-of-sight functions in an empty arena; only UI/audio/FX are doubled.
function explosionWave(wave=10,hp=100) {
  const microtasks=microtaskQueue(),enemies=[],corpses=[],barrels=[],jobs=[],completed=[];
  const {run,ctx}=load([
    'G','WEAPONS','createShotState','player','DIFF','ETYPES','RANKS','explode','killBarrel','damageEnemy','killEnemy',
    'splitDamage','shieldFX','updateShieldFeedback',
    'bloodFX','hurtPlayer','killPlayer','checkWave','bonusValue','addScore',
    'losClear','rayWorld','rayBox','query','RH'
  ],{
    enemies,corpses,barrels,S:{diff:1},THREE:{Color:FXColor,Vector3:FXVector},
    q:{particles:1},rnd:fxRnd,Math:fxRandom,TAU:Math.PI*2,_dir:new FXVector(0,0,1),
    hash:new Map(),HC:8,queryStamp:0,queryOut:[],
    clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),
    pSmoke:{spawn(){}},pAdd:{spawn(){}},addDecal(){},addTrauma(){},
    flashLight:{position:{copy(){}},intensity:0},flashT:0,
    gradePass:{uniforms:{uFlash:{value:0},uDamage:{value:0}}},
    Audio:{explosion(){},impact(){},hurt(){},tone(){},clear(){}},
    $:()=>({style:{}}),document:{exitPointerLock(){}},toast(){},hideRadio(){},
    showDamageDir(){},updateHpHUD(){},updateObjectiveHUD(){},
    queueMicrotask:microtasks.queueMicrotask,setTimeout:(fn,ms)=>jobs.push({fn,ms}),
    openIntermission:()=>completed.push('inter'),showEnd:won=>completed.push(won)
  });
  const G=run('G'),player=run('player');
  Object.assign(G,{state:'playing',wave,waveTotal:1,waveSpawned:1,time:5,
    bonus:{k:'barrel'},bonusGoal:2,bonusStartBarrels:0});
  Object.assign(player,{hp,armor:0});player.pos.set(0,0,0);
  const enemy={type:run('ETYPES.rifle'),pos:new FXVector(1,0,0),hp:100,shield:0,maxShield:0,
    dead:false,flinch:0,flash:{material:{opacity:1}}};
  enemies.push(enemy);
  ctx.barrel={alive:true,pos:new FXVector(),mesh:{visible:true},col:{enabled:true}};
  return {run,G,player,enemy,enemies,barrel:ctx.barrel,jobs,completed,
    flushMicrotasks:microtasks.flushMicrotasks};
}

test('second barrel killing the last enemy grants the 750 bonus after microtasks',()=>{
  const {run,G,player,enemy,enemies,barrel,jobs,completed,flushMicrotasks}=explosionWave(1);
  G.stats.barrels=1;player.pos.set(20,0,0);
  run('barrels.push(barrel); killBarrel(barrel)');
  const before={state:G.state,score:G.score,waves:G.stats.waves,timers:jobs.length};
  assert.equal(enemy.dead,true);assert.equal(enemies.length,0);assert.equal(G.waveKilled,1);
  assert.equal(barrel.alive,false);assert.equal(barrel.mesh.visible,false);assert.equal(barrel.col.enabled,false);
  assert.equal(G.stats.barrels,2);
  flushMicrotasks();
  assert.equal(G.score,1370); // 620 wave reward + 750 barrel bonus, no player kill reward.
  assert.deepEqual(before,{state:'playing',score:0,waves:0,timers:0});
  assert.equal(G.state,'waveclear');assert.equal(G.stats.waves,1);
  assert.equal(G.stats.kills,0);assert.equal(player.kills,0);
  assert.deepEqual(jobs.map(job=>job.ms),[1400]);assert.deepEqual(completed,[]);
  jobs.shift().fn();assert.deepEqual(completed,['inter']);
  run('checkWave()');flushMicrotasks();assert.equal(G.score,1370);assert.equal(G.stats.waves,1);
});

test('last-enemy explosion killing the player preserves death instead of victory',()=>{
  const {run,G,player,enemy,jobs,completed,flushMicrotasks}=explosionWave(10,50);
  run('explode(player.pos.clone())');
  assert.equal(enemy.dead,true);assert.equal(G.waveKilled,1);
  assert.equal(player.dead,true);assert.equal(player.hp,0);assert.equal(G.state,'dead');
  assert.equal(G.stats.dmgTaken,50);assert.equal(player.lastDmg,5);
  assert.equal(G.score,0);assert.equal(G.stats.waves,0);
  flushMicrotasks();
  assert.equal(G.state,'dead');assert.equal(G.score,0);assert.equal(G.stats.waves,0);
  assert.deepEqual(jobs.map(job=>job.ms),[900]);assert.deepEqual(completed,[]);
  jobs.shift().fn();assert.deepEqual(completed,[false]);
});

test('last-enemy explosion applies nonlethal player damage before deferred victory',()=>{
  const {run,G,player,enemy,jobs,completed,flushMicrotasks}=explosionWave();
  run('explode(player.pos.clone())');
  assert.equal(enemy.dead,true);assert.equal(G.waveKilled,1);
  assert.equal(player.hp,28);assert.equal(player.dead,false);
  assert.equal(G.stats.dmgTaken,72);assert.equal(player.lastDmg,5);
  assert.equal(G.state,'playing');assert.equal(G.score,0);assert.equal(jobs.length,0);
  flushMicrotasks();
  assert.equal(G.state,'victory');assert.equal(G.stats.waves,1);assert.equal(G.score,1700);
  assert.equal(player.hp,28);assert.equal(player.dead,false);
  assert.deepEqual(jobs.map(job=>job.ms),[1200]);assert.deepEqual(completed,[]);
  jobs.shift().fn();assert.deepEqual(completed,[true]);
});

test('all enemy types shoot finite projectiles at their expected speed',()=>{
  const eProjectiles=[];
  const {run,ctx}=load(['ETYPES','DIFF','enemyShoot'],{
    eProjectiles,S:{diff:1},player:{pos:new FXVector(8,0,12),eye:1.6},THREE:{Vector3:FXVector},
    q:{particles:0},rnd:fxRnd,Math:fxRandom,TAU:Math.PI*2,D2R:Math.PI/180,
    clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),Audio:{shot(){}}
  });
  for (const [key,speed,pellets] of [['rifle',130,1],['rush',110,6],['marks',260,1],['heavy',130,1]]) {
    eProjectiles.length=0;
    ctx.e={type:run(`ETYPES.${key}`),tkey:key,eye:()=>new FXVector(0,1.4,0),
      flash:{material:{opacity:0},getWorldPosition:v=>v.set(0,1.4,0)}};
    run('enemyShoot(e)');
    assert.equal(eProjectiles.length,pellets);
    for (const {p,v,dmg,owner} of eProjectiles) {
      assert.ok([p.x,p.y,p.z,v.x,v.y,v.z].every(Number.isFinite),`${key} projectile must stay finite`);
      assert.ok(Math.abs(Math.hypot(v.x,v.y,v.z)-speed)<1e-9);
      assert.equal(dmg,ctx.e.type.dmg);assert.equal(owner,ctx.e);
    }
  }
});

test('radio alternates after six playing seconds, freezes paused and preserves rereading',()=>{
  const node=()=>({children:[],dataset:{},hidden:true,replaceChildren(){this.children=[];},
    append(...children){this.children.push(...children);},appendChild(child){this.children.push(child);}});
  const radio=node(),lines=node(),pause=node(),inter=node(),G={state:'playing'};
  const {run}=load(['STORY','CONTAINMENT','getWaveStory','radioState','renderRadio','showRadio','hideRadio','updateRadio'],{
    G,pause,inter,$:selector=>({'#radio':radio,'#radioLines':lines})[selector],
    document:{createElement:node,createTextNode:text=>({textContent:text})}
  });
  run('showRadio(getWaveStory(6))');
  assert.equal(radio.hidden,false);assert.equal(radio.dataset.reply,'0');assert.equal(lines.children.length,2);
  run('updateRadio(5.9)');assert.equal(radio.dataset.reply,'0');
  const remaining=run('radioState.remaining');G.state='paused';
  run('updateRadio(30)');assert.equal(run('radioState.remaining'),remaining);assert.equal(radio.dataset.reply,'0');
  run('renderRadio(pause,getWaveStory(6));renderRadio(inter,getWaveStory(6));');
  for (const el of [pause,inter]) assert.deepEqual(el.children.map(p=>p.children.map(c=>c.textContent)),lines.children.map(p=>p.children.map(c=>c.textContent)));
  G.state='playing';run('updateRadio(.1)');assert.equal(radio.dataset.reply,'1');assert.equal(radio.hidden,false);
  G.state='paused';run('updateRadio(30)');assert.equal(radio.dataset.reply,'1');assert.equal(radio.hidden,false);
  G.state='playing';run('updateRadio(6)');assert.equal(radio.hidden,true);assert.equal(run('radioState.remaining'),0);
  run('showRadio(getWaveStory(7))');assert.equal(radio.dataset.reply,'0');assert.equal(lines.children.length,2);
  run('hideRadio()');assert.equal(radio.hidden,true);assert.equal(run('radioState.remaining'),0);
});

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const accuracyNames=['WEAPONS','createShotState','canSteadyAim','advanceShotState','shotAfterFire','weaponSpread','resetShotStates','updateShotStates'];
function combatHarness(extra=[]) {
  const nodes=new Map(),numbers=[];
  const node=()=>({style:{},hidden:false,children:[],classList:{add(){},remove(){},toggle(){}},
    appendChild(el){this.children.push(el);numbers.push(el);},remove(){},get childElementCount(){return this.children.length;}});
  const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const model=()=>({group:{visible:true},muzzle:{getWorldPosition:v=>v.set(0,1,0)},
    flash:{material:{opacity:0},rotation:{},scale:{setScalar(){}}},flashLight:{intensity:0}});
  const globals={THREE:{Vector3:FXVector,Color:FXColor},G:{state:'playing',wave:10,time:0,upg:{},stats:{shots:0,hits:0,dmgTaken:0,dmgDealt:0}},
    VM:{models:{ar:model(),smg:model(),dmr:model()},cur:null},S:{diff:1},mouse:{fire:false,ads:false},
    clamp,lerp,Math:fxRandom,rnd:fxRnd,D2R:Math.PI/180,TAU:Math.PI*2,q:{particles:1},
    camera:{quaternion:{},matrixWorld:{},getWorldPosition:v=>v.set(0,1,0)},
    _org:new FXVector(),_dir:new FXVector(0,0,-1),_right:new FXVector(),_fwd:new FXVector(),_hitP:new FXVector(),
    pSmoke:{spawn(){}},pAdd:{spawn(){}},ejectCasing(){},addTrauma(){},alertEnemies(){},hitscan(){},
    Audio:{reload(){},ui(){},shot(){},pickup(){},hit(){},hurt(){}},updateAmmoHUD(){},updateHpHUD(){},
    toast(){},trauma:0,$,document:{createElement:node},innerWidth:1000,innerHeight:700,
    gradePass:{uniforms:{uDamage:{value:0}}},showDamageDir(){},killPlayer(){globals.G.state='dead';},
    lockPointer(){},startWave:w=>{globals.G.wave=w;},scene:{remove(){}}};
  const loaded=load([...accuracyNames,'player','currentWeapon','switchWeapon','startReload','finishReload','resetPlayer','aimDir',...extra],globals);
  loaded.run('VM.cur=VM.models.ar; resetPlayer(true)');
  return {...loaded,globals,nodes,numbers,player:loaded.run('player'),weapons:loaded.run('WEAPONS')};
}

test('shield distribution handles below, exact, overflow, lethal and overkill without negatives',()=>{
  const {run}=load(['splitDamage']);
  for(const [hp,shield,damage,expected] of [
    [100,100,30,[100,70,0,30,30,false]], [100,100,100,[100,0,0,100,100,true]],
    [100,20,50,[70,0,30,20,50,true]], [20,10,100,[0,0,20,10,30,true]],
    [0,0,100,[0,0,0,0,0,false]], [-10,-2,-50,[0,0,0,0,0,false]]]) {
    const result=run(`splitDamage(${hp},${shield},${damage})`);
    assert.deepEqual([result.hp,result.shield,result.hpDamage,result.shieldDamage,result.total,result.shieldBroken],expected);
  }
});

test('each weapon has linear near/middle/far falloff with a fixed minimum',()=>{
  const {run}=load(['WEAPONS','damageAtDistance'],{clamp,lerp});
  for(const [i,start,end,min] of [[0,25,100,.65],[1,15,60,.5],[2,60,180,.8]]) {
    const w=run(`WEAPONS[${i}]`);
    for(const [d,mult] of [[0,1],[start,1],[(start+end)/2,(1+min)/2],[end,min],[end+1000,min]])
      assert.ok(Math.abs(run(`damageAtDistance(WEAPONS[${i}],${d})`)-w.dmg*mult)<1e-9);
  }
});

test('hitscan uses actual hit distance before modifiers and preserves helmet headshot multiplier',()=>{
  const hits=[],e={dead:false,type:{helmet:true},raycast:()=>({t:62.5,head:true})};
  const {run}=load(['WEAPONS','damageAtDistance','hitscan'],{clamp,lerp,enemies:[e],barrels:[],
    rayWorld:()=>-1,_hitP:new FXVector(),spawnTracer(){},player:{mods:{dmg:1.18}},
    G:{stats:{hits:0}},damageEnemy:(...args)=>hits.push(args),org:new FXVector(),dir:new FXVector(0,0,-1)});
  run('hitscan(org,dir,WEAPONS[0],org)');
  assert.ok(Math.abs(hits[0][1]-27*.825*1.18*2.4)<1e-9);
  assert.equal(hits[0][2],true);assert.equal(hits[0][3],true);assert.equal(hits[0][4].z,-62.5);
});

test('first-shot precision requires grounded still ADS and a fresh quarter second',()=>{
  const {run,player:p}=combatHarness();
  Object.assign(p,{ads:true,adsT:1,grounded:true});
  run('updateShotStates(.24)');assert.ok(run('weaponSpread(currentWeapon(),player.shotStates[0],player)')>0);
  run('updateShotStates(.01)');assert.equal(run('weaponSpread(currentWeapon(),player.shotStates[0],player)'),0);
  for(const changes of [{grounded:false},{ads:false},{adsT:.95},{reloading:.5},{swapT:.2}]) {
    Object.assign(p,{ads:true,adsT:1,grounded:true,reloading:0,swapT:0},changes);
    run('updateShotStates(1)');assert.ok(run('weaponSpread(currentWeapon(),player.shotStates[0],player)')>0);
    assert.equal(p.shotStates[0].steadySeconds,0);
  }
  Object.assign(p,{ads:true,adsT:1,grounded:true,reloading:0,swapT:0});p.vel.x=.1;
  run('updateShotStates(1)');assert.equal(p.shotStates[0].steadySeconds,0);
  const walking=run('weaponSpread(currentWeapon(),player.shotStates[0],player)');p.vel.x=5;
  assert.ok(run('weaponSpread(currentWeapon(),player.shotStates[0],player)')>walking);
});

test('real shots increase per-weapon bloom, cap it, and reset steady aim',()=>{
  const {run,player:p,weapons}=combatHarness(['fire']);
  const expected=[[.30,2,2.5],[.40,2.6,3.2],[.55,1.2,2.2]];
  for(let i=0;i<3;i++) {
    run(`switchWeapon(${i},true)`);Object.assign(p,{ads:true,adsT:1,grounded:true});
    run('updateShotStates(.25); fire()');
    assert.deepEqual([p.shotStates[i].bloom,p.shotStates[i].steadySeconds],[expected[i][0],0]);
    assert.ok(run(`weaponSpread(WEAPONS[${i}],player.shotStates[${i}],player)`)>0);
    p.ammo[i]=30;for(let n=0;n<20;n++)run('fire()');
    assert.equal(p.shotStates[i].bloom,expected[i][1]);
    run('updateShotStates(.1)');assert.ok(Math.abs(p.shotStates[i].bloom-(expected[i][1]-expected[i][2]*.1))<1e-9);
    assert.equal(Object.hasOwn(weapons[i],'bloom'),false);
  }
});

test('recovery is finite and time-based at 2, 30 and 120 fps, including hidden weapons and pause',()=>{
  for(const fps of [2,30,120]) {
    const {run,player:p,globals}=combatHarness(['fire']);Object.assign(p,{ads:true,adsT:1});
    p.ammo[0]=30;for(let i=0;i<10;i++)run('fire()');
    for(let i=0;i<fps;i++)run(`updateShotStates(${1/fps})`);
    assert.equal(p.shotStates[0].bloom,0);assert.equal(run('weaponSpread(currentWeapon(),player.shotStates[0],player)'),0);
    assert.equal(p.shotStates[1].steadySeconds,0);assert.equal(p.shotStates[2].steadySeconds,0);
    run('fire()');const before=JSON.stringify(p.shotStates);globals.G.state='paused';
    run('updateShotStates(20)');assert.equal(JSON.stringify(p.shotStates),before);
  }
});

test('real swap and reload schedules prevent instantly perfect first shots',()=>{
  const {run,player:p}=combatHarness();Object.assign(p,{ads:true,adsT:1});
  run('updateShotStates(1); switchWeapon(1); updateShotStates(.5)');
  assert.equal(p.shotStates[1].steadySeconds,0);assert.equal(p.shotStates[0].steadySeconds,0);
  p.swapT=0;run('updateShotStates(.24)');assert.ok(run('weaponSpread(currentWeapon(),player.shotStates[1],player)')>0);
  run('updateShotStates(.01)');assert.equal(run('weaponSpread(currentWeapon(),player.shotStates[1],player)'),0);
  p.ammo[1]=1;run('startReload(); updateShotStates(3)');assert.equal(p.shotStates[1].steadySeconds,0);
  p.reloading=0;run('finishReload(); updateShotStates(.24)');assert.ok(run('weaponSpread(currentWeapon(),player.shotStates[1],player)')>0);
  run('switchWeapon(0,true)');assert.equal(p.shotStates[0].steadySeconds,0);
});

test('fresh and retry reset shield, bloom, ADS, recoil and combat timestamps',()=>{
  const {run,player:p,globals}=combatHarness();
  for(const full of [false,true]) {
    Object.assign(p,{armor:2,maxArmor:130,nextShot:90,lastDmg:89,ads:true,adsT:1,
      recoilP:1,recoilY:1,recoilPV:1,recoilYV:1,reloading:2,swapT:1,firedOnce:true});
    p.mods.shieldPickup=65;p.shotStates[0].bloom=2;p.shotStates[0].steadySeconds=1;
    globals.mouse.fire=globals.mouse.ads=true;
    run(`resetPlayer(${full})`);
    assert.deepEqual([p.hp,p.armor,p.maxArmor,p.mods.armorMax],[100,100,100,100]);
    assert.deepEqual([p.nextShot,p.lastDmg,p.ads,p.adsT,p.recoilP,p.recoilY,p.recoilPV,p.recoilYV,p.firedOnce],[0,-99,false,0,0,0,0,0,false]);
    assert.equal(globals.mouse.fire,false);assert.equal(globals.mouse.ads,false);
    for(const state of p.shotStates)assert.deepEqual({...state},{bloom:0,steadySeconds:0});
    assert.equal(p.mods.shieldPickup,full?35:65);
  }
  assert.ok(script.lastIndexOf('resetPlayer(true)')>script.indexOf('const touchState='));
});

test('shield upgrade increases pickup recovery only, capped at three levels; wave and crate refill to 100',()=>{
  const {run,player:p,globals}=combatHarness(['UPGRADES','chooseUpgrade','nextWave','interact','updatePickups']);
  const upgrade=run('UPGRADES.find(u=>u.id==="armor")');
  assert.match(upgrade.n,/CÉLULA DE ESCUDO/);
  for(let level=1;level<=3;level++) {
    globals.G.state='inter';p.armor=1;
    run('chooseUpgrade(UPGRADES.find(u=>u.id==="armor"))');
    assert.equal(p.mods.shieldPickup,35+level*10);assert.equal(p.armor,100);assert.equal(p.maxArmor,100);
    assert.match(upgrade.d,new RegExp(String(p.mods.shieldPickup)));
    assert.match(upgrade.d,/100/);
  }
  globals.G.state='inter';run('chooseUpgrade(UPGRADES.find(u=>u.id==="armor"))');assert.equal(p.mods.shieldPickup,65);
  globals.G.state='playing';p.armor=0;
  run('let supplyCrate={pos:player.pos.clone(),mesh:{},light:{}}; interact()');assert.equal(p.armor,100);
  run('let pickups=[];');
  for(const recovery of [35,45,55,65])for(const initial of [0,90]) {
    p.mods.shieldPickup=recovery;p.armor=initial;
    run('pickups.push({kind:"armor",t:0,life:26,m:{position:player.pos.clone(),rotation:{y:0},material:{dispose(){}}},glow:{position:new THREE.Vector3()}}); updatePickups(.016)');
    assert.equal(p.armor,Math.min(100,initial+recovery));
  }
});

test('player shield absorbs difficulty-scaled damage and breaks once with game-time feedback',()=>{
  const {run,player:p,globals,nodes}=combatHarness(['DIFF','splitDamage','hurtPlayer','updateShieldFeedback']);
  globals.S.diff=2;run('hurtPlayer(40,null)');
  assert.equal(p.hp,100);assert.equal(p.armor,42);assert.equal(globals.G.stats.dmgTaken,58);
  run('hurtPlayer(40,null)');assert.equal(p.hp,84);assert.equal(p.armor,0);
  assert.equal(nodes.get('#shieldBreakHint').hidden,false);assert.ok(p.shieldFlash>0);
  const timer=p.shieldBreakT;globals.G.state='paused';run('updateShieldFeedback(10)');assert.equal(p.shieldBreakT,timer);
  globals.G.state='playing';run('updateShieldFeedback(.2); hurtPlayer(1,null)');assert.ok(p.shieldBreakT<timer);
  run('updateShieldFeedback(2)');assert.equal(nodes.get('#shieldBreakHint').hidden,true);assert.equal(nodes.get('#shieldFlash').style.opacity,0);
  run('hurtPlayer(1000,null)');assert.equal(p.hp,0);assert.equal(globals.G.stats.dmgTaken,200);
});

test('enemy shield numbers split from HP, avoid juice on shield-only hits and break only once',()=>{
  const juice=[],sparks=[],markers=[];
  const {run,ctx,globals,numbers}=combatHarness(['splitDamage','damageEnemy','shieldFX','numPool','showDamageNum','showShieldBreak','updateDamageNumbers']);
  Object.assign(ctx,{bloodFX:(...a)=>juice.push(a),pAdd:{spawn:(...a)=>sparks.push(a)},showHitmarker:(...a)=>markers.push(a)});
  ctx.e={hp:100,shield:20,maxShield:100,dead:false,flinch:0,state:'cover',pos:new FXVector(),type:{juice:0xff0000}};
  run('damageEnemy(e,10,true,true,e.pos)');
  assert.deepEqual([ctx.e.hp,ctx.e.shield,globals.G.stats.dmgDealt],[100,10,10]);assert.equal(juice.length,0);
  assert.ok(sparks.length>0);assert.ok(sparks.every(a=>a[7]>a[6]&&a[8]>a[6]));
  assert.match(numbers[0].className,/shield/);assert.match(numbers[0].textContent,/10.*CRÍTICO/);assert.equal(markers[0][1],true);
  run('damageEnemy(e,30,false,true,e.pos)');
  assert.deepEqual([ctx.e.hp,ctx.e.shield,globals.G.stats.dmgDealt],[80,0,40]);assert.equal(juice.length,1);
  const crossing=numbers.slice(1);assert.ok(crossing.some(n=>n.textContent==='20'&&!n.className.includes('shield')));
  assert.equal(new Set(crossing.map(n=>n.style.top)).size,3);
  run('damageEnemy(e,10,false,true,e.pos)');
  assert.equal(numbers.filter(n=>n.textContent==='ESCUDO ROTO').length,1);
  assert.ok(numbers.every(n=>!String(n.textContent).includes('NaN')&&!n.style.top.includes('NaN')));
  const dealt=globals.G.stats.dmgDealt;run('damageEnemy(e,1,false,false,e.pos)');assert.equal(globals.G.stats.dmgDealt,dealt);
  run('updateDamageNumbers(1); showDamageNum(e.pos,5,false,false,0)');assert.ok(run('numPool.length')<=18);
});

test('heavy constructor shields are independent; other fruit have none and HP scaling is unchanged',()=>{
  class Model {
    constructor(g,m){this.position=new FXVector();this.rotation={};this.material=m;this.quaternion={};}
    add(){} traverse(){}
  }
  const g={muzzle:[0,0,0]},THREE={Vector3:FXVector,Group:Model,Mesh:Model,Line:Model,
    PlaneGeometry:class{},Box3:class{},BufferGeometry:class{setFromPoints(){return this;}},
    MeshBasicMaterial:class{},LineBasicMaterial:class{}};
  const {run}=load(['ETYPES','Enemy'],{THREE,soldierGeos:{rifle:g,rush:g,marks:g,heavy:g,commander:g},enemyMat:{},
    TEX:{},scene:{add(){}},rnd:fxRnd,Math:fxRandom,TAU:Math.PI*2});
  run('let a=new Enemy("heavy",0,0,1),b=new Enemy("heavy",0,0,10,true); a.shield=0');
  assert.equal(run('b.shield'),100);assert.equal(run('b.maxShield'),100);assert.equal(run('a.maxShield'),100);
  assert.equal(run('a.hp'),320);assert.equal(run('b.hp'),320*(1+7*.055));assert.equal(run('ETYPES.heavy.shield'),undefined);
  for(const key of ['rifle','rush','marks'])assert.equal(run(`new Enemy('${key}',0,0,1).shield`),0);
});

test('HUD uses shared ballistic spread with visible ADS dot/lines, and separate shield labels',()=>{
  const {run,player:p,nodes}=combatHarness(['updateCrosshair','updateHpHUD','updateBossBar']);
  Object.assign(p,{ads:true,adsT:1});run('updateShotStates(.25); updateCrosshair()');
  assert.equal(nodes.get('#cross').style.opacity,.65);assert.equal(nodes.get('#cR').style.left,'33px');
  assert.ok(html.includes('#cross.precise'));assert.ok(html.includes('id="shieldFlash"'));
  p.vel.x=5;run('updateShotStates(.1); updateCrosshair()');
  assert.equal(parseFloat(nodes.get('#cR').style.left),33+run('weaponSpread(currentWeapon(),player.shotStates[0],player)')*7);
  run('updateHpHUD()');assert.equal(String(nodes.get('#apNum').textContent),'100');
  run('updateBossBar({displayName:"Sandión",hp:320,maxHp:320,shield:75,maxShield:100})');
  assert.match(nodes.get('#bossShieldNum').textContent,/75/);assert.equal(nodes.get('#bossShieldFill').style.width,'75%');
  assert.match(html,/Detente y apunta para el primer tiro preciso\. El escudo absorbe el daño antes de la vida\./);
  const update=declaration('updatePlayer');assert.ok(update.indexOf('updateShotStates(dt)')<update.indexOf('fire();'));
});

test('a saturated number pool keeps shield, HP and break labels visible together without allocating',()=>{
  const {run,ctx}=combatHarness(['numPool','showDamageNum','showShieldBreak','updateDamageNumbers']);
  ctx.pos=new FXVector();
  for(let i=0;i<18;i++)run(`showDamageNum(pos,${i+100},false,false)`);
  run('showShieldBreak(pos); showDamageNum(pos,10,true,true,0); showDamageNum(pos,20,true,false,32)');
  const labels=Array.from(run('numPool'),n=>n.el);
  assert.equal(labels.length,18);
  for(const text of ['ESCUDO ROTO','10 CRÍTICO','20 CRÍTICO'])assert.ok(labels.some(n=>n.textContent===text&&!n.hidden),text);
  run('G.state="paused"; updateDamageNumbers(5)');assert.ok(run('numPool.every(n=>n.life>0&&n.el.style.animationPlayState==="paused")'));
  run('G.state="playing"; updateDamageNumbers(1)');assert.ok(run('numPool.every(n=>n.el.hidden)'));
});

test('lethal player damage counts only shield and HP lost and runs real kill rewards once',()=>{
  const {run,ctx,globals,player:p,numbers}=combatHarness(['splitDamage','damageEnemy','killEnemy','shieldFX','numPool','showDamageNum','showShieldBreak']);
  const microtasks=microtaskQueue(),enemies=[],corpses=[],rewards=[],feeds=[],pickups=[];
  Object.assign(ctx,{enemies,corpses,queueMicrotask:microtasks.queueMicrotask,checkWave(){},
    bloodFX(){},showHitmarker(){},addScore:n=>rewards.push(n),feed:(...a)=>feeds.push(a),
    spawnPickup:(...a)=>pickups.push(a),activateUAV(){assert.fail('No eight-kill streak yet');}});
  Object.assign(globals.G,{waveKilled:0,bonusProgress:0});Object.assign(globals.G.stats,{kills:0,head:0});
  ctx.e={hp:20,shield:10,maxShield:100,dead:false,flinch:0,state:'cover',pos:new FXVector(),
    type:{juice:0xff7394,score:320},displayName:'Sandía',flash:{material:{opacity:1}}};enemies.push(ctx.e);
  run('damageEnemy(e,1000,true,true,e.pos)');
  assert.deepEqual([ctx.e.hp,ctx.e.shield,globals.G.stats.dmgDealt],[0,0,30]);
  assert.equal(ctx.e.dead,true);assert.equal(enemies.length,0);assert.equal(corpses.length,1);
  assert.deepEqual(rewards,[480]);assert.equal(feeds.length,1);assert.equal(pickups.length,1);
  assert.equal(p.kills,1);assert.equal(globals.G.stats.head,1);assert.equal(globals.G.waveKilled,1);
  assert.ok(numbers.some(n=>n.textContent==='20 CRÍTICO'));assert.ok(numbers.some(n=>n.textContent==='10 CRÍTICO'));
  run('damageEnemy(e,1000,true,true,e.pos)');microtasks.flushMicrotasks();
  assert.equal(globals.G.stats.dmgDealt,30);assert.equal(rewards.length,1);
});

test('real frame updates enforce swap/reload settling, shared shot spread and freeze outside playing',()=>{
  const {run,ctx,globals,player:p}=combatHarness(['fire','updatePlayer','updateCrosshair']);
  Object.assign(ctx,{keys:{},touchMode:false,damp:(a,b,k,dt)=>lerp(a,b,1-Math.exp(-k*dt)),
    moveActor(pos,vel){vel.y=0;return true;},supplyCrate:null});
  Object.assign(globals.camera,{position:new FXVector(),rotation:{set(){}},fov:80,updateProjectionMatrix(){},updateMatrixWorld(){}});
  Object.assign(globals.S,{fov:80,crouchToggle:false});globals.Audio.step=()=>{};
  const shots=[];ctx.hitscan=(org,dir)=>shots.push(dir.clone());
  globals.mouse.ads=true;
  const tick=(dt=1/60)=>{globals.G.time+=dt;run(`updatePlayer(${dt})`);};
  const spread=()=>run('weaponSpread(currentWeapon(),player.shotStates[player.wIdx],player)');
  for(let i=0;i<150;i++)tick();assert.equal(spread(),0);
  const expected=run('aimDir(new THREE.Vector3())');globals.mouse.fire=true;tick();globals.mouse.fire=false;
  assert.ok(shots[0].distanceTo(expected)<1e-12);assert.ok(spread()>0);
  tick();assert.ok(shots[0].x===expected.x);assert.ok(p.shotStates[0].bloom>0);
  run('switchWeapon(1)');tick(.5);assert.equal(p.swapT,0);assert.equal(p.shotStates[1].steadySeconds,0);assert.ok(spread()>0);
  for(let i=0;i<150;i++)tick();assert.equal(spread(),0);assert.equal(p.shotStates[0].steadySeconds,0);
  p.ammo[1]=1;run('startReload()');tick();assert.equal(p.shotStates[1].steadySeconds,0);
  while(p.reloading>0)tick();assert.ok(spread()>0);
  for(let i=0;i<150;i++)tick();assert.equal(spread(),0);
  const before=JSON.stringify(p);globals.G.state='paused';run('updatePlayer(.5)');assert.equal(JSON.stringify(p),before);
});
