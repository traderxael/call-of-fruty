const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','call of fruty.html'),'utf8');
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
function declaration(name){
  const match=new RegExp(`(?:const|let) ${name}\\s*=|function ${name}\\s*\\(`).exec(script);
  assert.ok(match,`Missing production declaration: ${name}`);
  const start=match.index,open=script.slice(start).search(/[\[{]/)+start;
  let depth=0,quote='',line=false,block=false;
  for(let i=open;i<script.length;i++){
    const c=script[i],next=script[i+1];
    if(line){if(c==='\n')line=false;continue;}
    if(block){if(c==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
    if(c==='/'&&next==='/'){line=true;i++;continue;}
    if(c==='/'&&next==='*'){block=true;i++;continue;}
    if('\'"`'.includes(c)){quote=c;continue;}
    if(c==='{'||c==='[')depth++;
    if(c==='}'||c===']'){if(--depth===0)return script.slice(start,i+1);}
  }
  assert.fail(`Unclosed declaration: ${name}`);
}
class Vector{
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  normalize(){const n=Math.hypot(this.x,this.y,this.z)||1;return this.set(this.x/n,this.y/n,this.z/n);}
}
function harness({coarse=false,request=()=>undefined}={}){
  const listeners=new Map(),nodes=new Map(),jobs=[],colliders=[];
  const listen=(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);};
  const node=id=>{
    const classes=new Set(),events=new Map();
    return {id,style:{},hidden:false,textContent:'',dataset:{},
      classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){if(on===undefined)on=!classes.has(c);on?classes.add(c):classes.delete(c);}},
      addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},
      dispatch(type,event){for(const fn of events.get(type)||[])fn(event);},
      closest(selector){return selector.split(',').map(s=>s.trim()).includes(id==='#gl'?'canvas':'button')?this:null;},
      getBoundingClientRect:()=>({left:0,top:0,width:108,height:108})};
  };
  const $=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};
  const model=()=>({group:{visible:false},flash:{material:{opacity:0}},flashLight:{intensity:0}});
  const G={state:'menu',wave:1,time:0,stats:{shots:0,hits:0,head:0,kills:0,barrels:0,time:0},picks:[{id:'one'},{id:'two'},{id:'three'}]};
  const mouse={dx:0,dy:0,fire:false,ads:false},keys={};
  const document={pointerLockElement:null,addEventListener:listen,exitPointerLock(){this.pointerLockElement=null;}};
  $('#gl').requestPointerLock=request;
  const box=()=>({min:new Vector(),max:new Vector()});
  const globals={G,mouse,keys,document,$,$$:selector=>[...nodes.values()].filter(n=>n.id.startsWith('#t')&&n.id!=='#touch'),
    THREE:{Vector3:Vector},VM:{models:{ar:model(),smg:model(),dmr:model()},swayX:0,swayY:0},
    S:{sens:1,inv:false,fov:80,diff:1,crouchToggle:true},DIFF:[{}, {name:'NORMAL'}],
    camera:{position:new Vector(),rotation:{set(){}},fov:80,updateProjectionMatrix(){},updateMatrixWorld(){}},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),lerp:(a,b,t)=>a+(b-a)*t,
    damp:(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt)),rnd:()=>0,trauma:0,
    Audio:{step(){},reload(){},ui(){},resume(){},init(){}},
    updateAmmoHUD(){},updateHpHUD(){},updateSlots(){},addScore(){},addTrauma(){},updateCrosshair(){},fire(){},toast(){},
    renderStats(){},renderRadio(){},renderDiag(){},getWaveStory:()=>({}),
    clearEntities(){},startWave(w){G.wave=w;},chooseUpgrade(){G.state='playing';},toggleMute(){},
    _pb:box(),_tb:box(),ARENA:75,query:()=>colliders,
    addEventListener:listen,matchMedia:()=>({matches:coarse}),navigator:{userActivation:{isActive:true}},innerWidth:1000,
    setTimeout:(fn,ms)=>jobs.push({fn,ms})};
  const ctx=vm.createContext(globals),run=code=>vm.runInContext(code,ctx);
  const names=['WEAPONS','createShotState','canSteadyAim','advanceShotState','resetShotStates','updateShotStates','player',
    'currentWeapon','playerBox','moveActor','resetPlayer','switchWeapon','startReload','finishReload','aimDir','nextWave','startGame','pauseGame','resumeGame'];
  run(names.map(declaration).join(';')+';');
  const inputStart=script.indexOf('let pointerLocked=false'),inputEnd=script.indexOf('/*────────────────────────── CÁMARA',inputStart);
  run(script.slice(inputStart,inputEnd));
  run(declaration('updatePlayer')+'; initTouch(); resetPlayer(true);');
  const p=run('player');
  const event=extra=>({target:$('#gl'),button:0,changedTouches:[],prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){},...extra});
  const emit=(type,extra={})=>{const e=event(extra);for(const fn of listeners.get(type)||[])fn(e);return e;};
  const touch=(id,type,touches)=>{const e=event({target:$(id),changedTouches:touches});$(id).dispatch(type,e);emit(type,{target:$(id),changedTouches:touches});return e;};
  const capture=()=>{document.pointerLockElement=$('#gl');emit('pointerlockchange');};
  const begin=()=>{run('startGame(true)');if(!coarse)capture();};
  return {run,ctx,G,p,keys,mouse,$,nodes,document,globals,jobs,colliders,emit,touch,capture,begin};
}
const cardinal=[
  [0,[0,-1],[1,0]], [Math.PI/2,[-1,0],[0,-1]],
  [Math.PI,[0,1],[-1,0]], [-Math.PI/2,[1,0],[0,1]]
];
// Reversing forward or dropping lateral rotation must move the real player the wrong way.
for(const [yaw,forward,right] of cardinal)test(`real movement follows view at yaw ${yaw}`,()=>{
  for(const [code,expected] of [['KeyW',forward],['KeyS',forward.map(v=>-v)],['KeyA',right.map(v=>-v)],['KeyD',right]]){
    const h=harness();h.begin();h.p.pos.set(0,0,0);h.p.yaw=yaw;h.keys[code]=true;
    h.run('updatePlayer(.1)');
    assert.ok(Math.abs(h.p.pos.x-expected[0]*.47)<1e-9,code+' x');
    assert.ok(Math.abs(h.p.pos.z-expected[1]*.47)<1e-9,code+' z');
    if(code==='KeyW'){
      const aim=h.run('aimDir(new THREE.Vector3())');
      assert.ok(h.p.pos.x*aim.x+h.p.pos.z*aim.z>.46);
    }
  }
  for(const [x,y,expected] of [[0,-.5,forward],[0,.5,forward.map(v=>-v)],[-.5,0,right.map(v=>-v)],[.5,0,right]]){
    const h=harness({coarse:true});h.begin();h.p.pos.set(0,0,0);h.p.yaw=yaw;
    h.run(`touchState.move.x=${x}; touchState.move.y=${y}; updatePlayer(.1)`);
    assert.ok(Math.abs(h.p.pos.x-expected[0]*.235)<1e-9,'stick x');
    assert.ok(Math.abs(h.p.pos.z-expected[1]*.235)<1e-9,'stick z');
  }
});
test('diagonal movement normalizes keyboard and joystick without passing colliders',()=>{
  for(const coarse of [false,true]){
    const h=harness({coarse});h.begin();h.p.pos.set(0,0,0);h.p.yaw=0;
    if(coarse)h.run('touchState.move.x=.8;touchState.move.y=-.8;mouse.ads=true;');
    else Object.assign(h.keys,{KeyW:true,KeyD:true});
    h.run('updatePlayer(.1)');
    assert.ok(Math.abs(Math.hypot(h.p.pos.x,h.p.pos.z)-.47)<1e-9);
    assert.ok(h.p.pos.x>0&&h.p.pos.z<0);
  }
  const h=harness();h.begin();h.p.pos.set(0,0,0);h.p.yaw=0;h.keys.KeyW=true;
  h.colliders.push({min:new Vector(-2,0,-1),max:new Vector(2,3,-.4)});
  h.run('updatePlayer(.1)');assert.ok(h.p.pos.z>=-.06);
});
// Setting playing before capture exposes the player to simulation while controls are unavailable.
for(const action of ['startGame(true)','resumeGame()','nextWave()'])test(`${action} freezes until confirmed canvas capture`,()=>{
  const h=harness();h.G.state=action==='nextWave()'?'inter':'paused';h.$('#scPause').classList.add('on');
  h.run(action);assert.equal(h.G.state,'paused');assert.equal(h.$('#scPause').classList.contains('on'),true);
  const before=JSON.stringify(h.p);h.emit('mousemove',{movementX:50,movementY:20});h.emit('mousedown');
  h.run('updatePlayer(.5)');assert.equal(JSON.stringify(h.p),before);assert.equal(h.mouse.fire,false);
  h.capture();assert.equal(h.G.state,'playing');assert.equal(h.$('#scPause').classList.contains('on'),false);
});
for(const [name,request] of [['absent',null],['throw',()=>{throw Error('Denied');}],['rejected',()=>Promise.reject(Error('Denied'))],['silent',()=>new Promise(()=>{})]])test(`capture ${name} never enables desktop gameplay`,async()=>{
  const h=harness({request});h.run('startGame(true)');await Promise.resolve();await Promise.resolve();
  assert.equal(h.G.state,'paused');assert.equal(h.mouse.fire,false);assert.match(h.$('#pauseSub').textContent,/REANUDAR|ratón/i);
});
test('resume retries a silent request and ignores an older rejection',async()=>{
  let rejectOld,calls=0;
  const h=harness({request:()=>{calls++;return calls===1?new Promise((resolve,reject)=>{rejectOld=reject;}):undefined;}});
  h.run('startGame(true);resumeGame()');assert.equal(calls,2);assert.equal(h.G.state,'paused');
  rejectOld(Error('Earlier request failed'));await Promise.resolve();await Promise.resolve();
  h.capture();assert.equal(h.G.state,'playing');
});
test('resume request B survives an older pointerlockerror from pending request A until capture B',()=>{
  let calls=0;
  const h=harness({request:()=>{calls++;return new Promise(()=>{});}});
  h.run('startGame(true)');assert.equal(calls,1);
  h.run('resumeGame()');assert.equal(calls,2);
  const before=JSON.stringify({G:h.G,player:h.p});
  h.emit('pointerlockerror');
  assert.equal(h.G.state,'paused');assert.equal(h.$('#scPause').classList.contains('on'),true);
  assert.match(h.$('#pauseSub').textContent,/No se pudo capturar.*REANUDAR/i);
  h.emit('keydown',{code:'KeyW'});h.emit('mousemove',{movementX:50,movementY:20});
  h.run('updatePlayer(.5)');assert.equal(JSON.stringify({G:h.G,player:h.p}),before);assert.equal(h.mouse.fire,false);
  assert.equal(calls,2);
  h.capture();assert.equal(h.G.state,'playing');assert.equal(h.$('#scPause').classList.contains('on'),false);
});
test('resolved request is not capture confirmation',async()=>{
  const h=harness({request:()=>Promise.resolve()});h.run('startGame(true)');await Promise.resolve();
  assert.equal(h.G.state,'paused');h.capture();assert.equal(h.G.state,'playing');
});
test('pointerlockerror is actionable and Escape while paused never requests capture',()=>{
  let calls=0;
  const h=harness({request:()=>{calls++;}});h.run('startGame(true)');h.emit('pointerlockerror');
  assert.equal(h.G.state,'paused');assert.match(h.$('#pauseSub').textContent,/No se pudo capturar.*REANUDAR/i);
  h.emit('keydown',{code:'Escape'});assert.equal(h.G.state,'paused');assert.equal(calls,1);
  h.capture();assert.equal(h.G.state,'playing');assert.equal(h.$('#scPause').classList.contains('on'),false);
});
test('legacy void request error keeps gameplay frozen and allows manual resume retry',()=>{
  let calls=0;
  const h=harness({request:()=>{calls++;}});h.run('startGame(true)');
  const before=JSON.stringify({G:h.G,player:h.p});
  h.emit('pointerlockerror');
  assert.match(h.$('#pauseSub').textContent,/No se pudo capturar.*REANUDAR/i);
  assert.equal(h.$('#scPause').classList.contains('on'),true);
  h.emit('keydown',{code:'KeyW'});h.emit('mousemove',{movementX:50,movementY:20});h.run('updatePlayer(.5)');
  assert.equal(JSON.stringify({G:h.G,player:h.p}),before);assert.equal(h.G.state,'paused');assert.equal(h.mouse.fire,false);
  h.run('resumeGame()');assert.equal(calls,2);assert.equal(h.G.state,'paused');
  h.capture();assert.equal(h.G.state,'playing');assert.equal(h.$('#scPause').classList.contains('on'),false);
  const message=h.$('#pauseSub').textContent;
  h.emit('pointerlockerror');assert.equal(h.G.state,'playing');assert.equal(h.$('#pauseSub').textContent,message);
});
test('current request rejection after pointerlockerror still invalidates capture and allows manual retry',async()=>{
  let rejectCurrent,calls=0;
  const h=harness({request:()=>{calls++;return calls===1?new Promise((resolve,reject)=>{rejectCurrent=reject;}):undefined;}});
  h.run('startGame(true)');h.emit('pointerlockerror');rejectCurrent(Error('Current request failed'));
  await Promise.resolve();await Promise.resolve();
  assert.equal(h.G.state,'paused');assert.equal(h.$('#scPause').classList.contains('on'),true);
  assert.match(h.$('#pauseSub').textContent,/No se pudo capturar.*REANUDAR/i);
  const before=JSON.stringify({G:h.G,player:h.p});
  h.emit('keydown',{code:'KeyW'});h.emit('mousemove',{movementX:50,movementY:20});h.run('updatePlayer(.5)');
  assert.equal(JSON.stringify({G:h.G,player:h.p}),before);assert.equal(h.mouse.fire,false);
  h.capture();assert.equal(h.G.state,'paused');assert.equal(h.document.pointerLockElement,null);
  h.run('resumeGame()');assert.equal(calls,2);assert.equal(h.G.state,'paused');
  h.capture();assert.equal(h.G.state,'playing');assert.equal(h.$('#scPause').classList.contains('on'),false);
});
test('automatic next wave without user activation shows pause rather than requesting capture',()=>{
  const h=harness({request:()=>{throw Error('No user gesture should request capture');}});
  h.G.state='inter';h.globals.navigator.userActivation.isActive=false;h.run('nextWave()');
  assert.equal(h.G.state,'paused');assert.match(h.$('#pauseSub').textContent,/REANUDAR/i);
});
for(const state of ['menu','inter','dead','victory'])test(`late capture cannot revive ${state}`,()=>{
  const h=harness();h.run('startGame(true)');h.G.state=state;h.capture();
  assert.equal(h.G.state,state);assert.equal(h.document.pointerLockElement,null);assert.equal(h.run('pointerLocked'),false);
});
test('manual pause invalidates pending capture and already active capture does not pause',()=>{
  const h=harness();h.run('startGame(true);pauseGame()');h.capture();assert.equal(h.G.state,'paused');
  h.run('resumeGame()');h.capture();assert.equal(h.G.state,'playing');h.run('lockPointer()');assert.equal(h.G.state,'playing');
});
function dirty(h){
  Object.assign(h.keys,{KeyW:true,Space:true,ShiftLeft:true});Object.assign(h.mouse,{dx:5,dy:3,fire:true,ads:true});h.p.firedOnce=true;
  h.run('touchState.move.x=1;touchState.move.y=-1;touchState.look={id:9,x:1,y:1};touchState.fire=true;');
  for(const id of ['#tFire','#tAds','#tCrouch'])h.$(id).classList.add('act');h.$('#stickN').style.transform='translate(36px,0)';
}
function clean(h){
  assert.ok(Object.values(h.keys).every(v=>!v));assert.deepEqual(h.mouse,{dx:0,dy:0,fire:false,ads:false});
  assert.equal(h.p.firedOnce,false);assert.equal(h.run('touchState.move.x'),0);assert.equal(h.run('touchState.move.y'),0);assert.equal(h.run('touchState.look'),null);
  assert.equal(h.run('touchState.fire'),false);assert.equal(h.$('#stickN').style.transform,'');
  for(const id of ['#tFire','#tAds','#tCrouch'])assert.equal(h.$(id).classList.contains('act'),false);
}
for(const reason of ['pause','blur','loss','reset'])test(`${reason} clears held keyboard, mouse and touch state`,()=>{
  const h=harness();h.begin();dirty(h);
  if(reason==='pause')h.run('pauseGame()');
  if(reason==='blur')h.emit('blur');
  if(reason==='loss'){h.document.pointerLockElement=null;h.emit('pointerlockchange');}
  if(reason==='reset'){h.p.crouchToggle=true;h.run('resetPlayer(false)');assert.equal(h.p.crouchToggle,false);}
  clean(h);
});
test('menu keys and native buttons never latch gameplay or advance intermission',()=>{
  const h=harness();h.emit('keydown',{code:'KeyW'});assert.notEqual(h.keys.KeyW,true);
  for(const kind of ['button','summary'])for(const code of ['Enter','Space']){
    h.G.state='inter';const target={closest:s=>s.split(',').some(v=>v.trim()===kind)?target:null};
    const e=h.emit('keydown',{code,target});assert.equal(e.prevented,false);assert.equal(h.G.state,'inter');assert.notEqual(h.keys[code],true);
  }
  h.G.state='inter';assert.equal(h.emit('keydown',{code:'Space',target:{closest:()=>null}}).prevented,true);
  assert.notEqual(h.keys.Space,true);
});
test('editable fields ignore all gameplay shortcuts and keyup safely clears old keys',()=>{
  const h=harness();h.begin();
  for(const tag of ['input','select','textarea','editable']){
    const target={isContentEditable:tag==='editable',closest:s=>s.includes(tag)?target:null};
    h.emit('keydown',{code:'KeyW',target});h.emit('keydown',{code:'Escape',target});
    assert.notEqual(h.keys.KeyW,true);assert.equal(h.G.state,'playing');
  }
  h.keys.KeyW=true;h.emit('keyup',{code:'KeyW',target:{isContentEditable:true}});assert.equal(h.keys.KeyW,false);
});
test('intermission upgrade keys and Space do not carry held actions into gameplay',()=>{
  for(const code of ['Digit1','Digit2','Digit3','Enter','Space']){
    const h=harness({coarse:true});h.G.state='inter';h.emit('keydown',{code,target:{closest:()=>null}});
    assert.notEqual(h.keys[code],true);assert.equal(h.G.state,'playing');
  }
});
const finger=(identifier,clientX=54,clientY=54)=>({identifier,clientX,clientY});
test('touch fire cancel, pointer release and toggled ADS release never latch fire',()=>{
  const h=harness({coarse:true});assert.equal(h.$('#touch').classList.contains('on'),false);h.begin();
  h.touch('#tFire','touchstart',[finger(1)]);assert.equal(h.mouse.fire,true);
  h.touch('#tFire','touchcancel',[finger(1)]);assert.equal(h.mouse.fire,false);assert.equal(h.$('#tFire').classList.contains('act'),false);
  h.touch('#tFire','touchstart',[finger(2)]);h.emit('pointerup',{button:0});assert.equal(h.mouse.fire,false);
  h.touch('#tAds','touchstart',[finger(3)]);h.touch('#tAds','touchend',[finger(3)]);
  assert.equal(h.mouse.ads,true);assert.equal(h.$('#tAds').classList.contains('act'),true);
  h.touch('#tAds','touchstart',[finger(4)]);assert.equal(h.mouse.ads,false);
  h.touch('#tAds','touchend',[finger(4)]);h.touch('#tAds','touchstart',[finger(5)]);h.touch('#tAds','touchcancel',[finger(5)]);
  assert.equal(h.mouse.ads,false);assert.equal(h.$('#tAds').classList.contains('act'),false);
});
test('touch ownership, pause and late touch events cannot move or reactivate controls',()=>{
  const h=harness({coarse:true});h.begin();
  h.touch('#stick','touchstart',[finger(1)]);h.touch('#stick','touchstart',[finger(2)]);
  h.emit('touchmove',{changedTouches:[finger(1,90,20)]});assert.ok(h.run('touchState.move.x')>0);
  h.touch('#gl','touchstart',[finger(3,700,200)]);h.touch('#gl','touchstart',[finger(4,800,200)]);
  const yaw=h.p.yaw;h.emit('touchmove',{changedTouches:[finger(3,710,200)]});assert.notEqual(h.p.yaw,yaw);
  h.run('pauseGame()');const pausedYaw=h.p.yaw;
  h.emit('touchmove',{changedTouches:[finger(1,100,10),finger(3,900,200)]});h.touch('#tFire','touchstart',[finger(6)]);
  assert.equal(h.p.yaw,pausedYaw);assert.equal(h.mouse.fire,false);assert.equal(h.run('touchState.move.x'),0);
  assert.equal(h.$('#touch').classList.contains('on'),false);
  h.emit('blur');h.run('resumeGame()');h.emit('touchmove',{changedTouches:[finger(1,100,10),finger(3,900,200)]});
  assert.equal(h.run('touchState.move.x'),0);assert.equal(h.p.yaw,pausedYaw);
});
test('switching captured mouse to touch survives delayed pointerlockchange',()=>{
  const h=harness();h.begin();h.touch('#gl','touchstart',[finger(1,700,200)]);
  h.emit('pointerlockchange');assert.equal(h.G.state,'playing');assert.equal(h.$('#touch').classList.contains('on'),true);
  const yaw=h.p.yaw;h.emit('touchmove',{changedTouches:[finger(1,710,200)]});assert.notEqual(h.p.yaw,yaw);
});
test('unrelated touch pointer releases cannot stop the owning fire finger',()=>{
  const h=harness({coarse:true});h.begin();h.touch('#tFire','touchstart',[finger(1)]);
  h.emit('pointerup',{pointerType:'touch',pointerId:8,button:0});assert.equal(h.mouse.fire,true);
  h.emit('pointercancel',{pointerType:'touch',pointerId:8});assert.equal(h.mouse.fire,true);
  h.touch('#tFire','touchend',[finger(2)]);assert.equal(h.mouse.fire,true);
  h.touch('#tFire','touchend',[finger(1)]);assert.equal(h.mouse.fire,false);
});
test('hybrid hardware initializes touch once and a real mouse requires capture',()=>{
  const h=harness();h.begin();h.run('initTouch()');h.document.pointerLockElement=null;h.emit('pointerlockchange');
  h.touch('#gl','touchstart',[finger(1,700,200)]);assert.equal(h.G.state,'playing');assert.equal(h.run('touchMode'),true);
  h.emit('mousedown',{sourceCapabilities:{firesTouchEvents:true}});assert.equal(h.run('touchMode'),true);
  h.touch('#tAds','touchstart',[finger(2)]);assert.equal(h.mouse.ads,true);
  h.emit('mousedown',{sourceCapabilities:{firesTouchEvents:false}});assert.equal(h.run('touchMode'),false);
  assert.equal(h.G.state,'paused');assert.equal(h.mouse.fire,false);assert.equal(h.$('#touch').classList.contains('on'),false);
  h.capture();assert.equal(h.G.state,'playing');
});
