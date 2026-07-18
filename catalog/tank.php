<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<title>Steel Brigade</title>
<style>
  :root{
    --panel-bg:#1b1f16;
    --panel-edge:#3a4530;
    --accent:#e8a33d;
    --accent-dim:#8a611f;
    --text:#e8e6d9;
    --text-dim:#9aa08c;
    --danger:#c1502e;
    --ok:#6fae4a;
  }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
  html,body{
    margin:0;padding:0;width:100%;height:100%;overflow:hidden;
    background:#0a0c08;
    font-family:'Courier New',monospace;
    color:var(--text);
    touch-action:none;
    -webkit-user-select:none;user-select:none;
    -webkit-touch-callout:none;
    overscroll-behavior:none;
  }
  #stage{
    position:fixed;inset:0;overflow:hidden;
    background:#0a0c08;
  }
  /* #rotWrap is sized in JS-driven CSS custom logic via inline width/height
     (matched to the physical screen's dimensions), and is rotated 90deg
     when the screen is taller than it is wide, so the game always fills
     the full screen edge-to-edge like a real landscape game. Every child
     is positioned relative to this box, so "bottom-left" etc. below is
     authored from the game's own point of view and travels correctly
     with the rotation. */
  #rotWrap{
    position:fixed;top:0;left:0;
    display:flex;align-items:center;justify-content:center;
    background:
      radial-gradient(ellipse at center, #14170f 0%, #080906 100%);
    transform-origin:0 0;
  }
  #stage.rotated #rotWrap{
    left:100%;
    transform:rotate(90deg);
  }
  #canvasWrap{
    position:relative;
    box-shadow:0 0 0 3px var(--panel-edge), 0 0 40px rgba(0,0,0,0.8);
    background:#000;
  }
  canvas{display:block;image-rendering:pixelated;}

  /* ---------- Touch controls (positioned relative to #rotWrap, so they move
     correctly together with the rotation) ---------- */
  #touchLayer{
    position:absolute;inset:0;pointer-events:none;z-index:50;
  }
  .joyBase{
    position:absolute;left:22px;bottom:22px;
    width:132px;height:132px;border-radius:50%;
    background:rgba(232,163,61,0.08);
    border:3px solid rgba(232,163,61,0.35);
    pointer-events:auto;
    touch-action:none;
  }
  .joyStick{
    position:absolute;left:50%;top:50%;
    width:56px;height:56px;margin:-28px 0 0 -28px;
    border-radius:50%;
    background:radial-gradient(circle at 35% 30%, #f2c877, var(--accent-dim));
    border:2px solid #6b4c17;
    box-shadow:0 3px 6px rgba(0,0,0,0.5);
  }
  #fireBtn{
    position:absolute;right:26px;bottom:30px;
    width:96px;height:96px;border-radius:50%;
    background:radial-gradient(circle at 35% 30%, #e2745a, #8f2c1a);
    border:3px solid #4a160a;
    box-shadow:0 4px 8px rgba(0,0,0,0.6);
    pointer-events:auto;touch-action:none;
    display:flex;align-items:center;justify-content:center;
    font-weight:bold;font-size:13px;color:#ffe9df;letter-spacing:1px;
  }
  #fireBtn.active{filter:brightness(1.3);transform:scale(0.94);}
  #pauseBtn{
    position:absolute;right:16px;top:16px;
    width:46px;height:46px;border-radius:8px;
    background:rgba(20,24,16,0.75);border:2px solid var(--panel-edge);
    color:var(--text);pointer-events:auto;touch-action:none;
    display:flex;align-items:center;justify-content:center;font-size:20px;
  }

  /* ---------- Overlay screens ---------- */
  .screen{
    position:absolute;inset:0;z-index:100;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:
      linear-gradient(180deg, rgba(10,12,8,0.97), rgba(6,7,5,0.98));
    padding:16px;
    overflow-y:auto;
  }
  .hidden{display:none !important;}
  .titleWrap{
    text-align:center;margin-bottom:18px;
  }
  .gameTitle{
    font-size:clamp(28px,7vw,52px);
    letter-spacing:4px;color:var(--accent);
    text-shadow:0 0 18px rgba(232,163,61,0.5), 3px 3px 0 #000;
    margin:0;font-weight:bold;
  }
  .gameSubtitle{
    color:var(--text-dim);font-size:clamp(11px,2.4vw,14px);
    letter-spacing:2px;margin-top:6px;
  }
  .menuBtn{
    font-family:inherit;
    display:block;
    width:min(280px,72vw);
    margin:8px auto;
    padding:14px 18px;
    background:linear-gradient(180deg,#2b3322,#1a2016);
    border:2px solid var(--panel-edge);
    border-radius:6px;
    color:var(--text);
    font-size:16px;letter-spacing:1px;
    cursor:pointer;
    text-align:center;
  }
  .menuBtn:active{background:linear-gradient(180deg,#3a4530,#232b1c);transform:translateY(1px);}
  .menuBtn.primary{
    border-color:var(--accent);
    color:#1a1305;
    background:linear-gradient(180deg,#f2c877,var(--accent));
    font-weight:bold;
  }
  .menuBtn.small{width:min(220px,60vw);font-size:14px;padding:10px 14px;}
  .menuRow{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}

  #mapGrid{
    display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
    gap:12px;max-width:640px;width:100%;padding:0 10px;margin:10px 0 18px;
  }
  .mapCard{
    background:#161a11;border:2px solid var(--panel-edge);border-radius:8px;
    padding:10px;text-align:center;cursor:pointer;
  }
  .mapCard.locked{opacity:0.45;}
  .mapCard.selected{border-color:var(--accent);box-shadow:0 0 12px rgba(232,163,61,0.4);}
  .mapCard canvas{width:100%;height:64px;image-rendering:pixelated;border:1px solid #000;background:#0d0f0a;}
  .mapCard .mName{font-size:12px;margin-top:6px;color:var(--text);letter-spacing:1px;}
  .mapCard .mDiff{font-size:10px;color:var(--accent);margin-top:2px;}

  .langRow{display:flex;gap:8px;justify-content:center;margin-top:14px;}
  .langBtn{
    padding:6px 12px;font-size:12px;border-radius:5px;border:2px solid var(--panel-edge);
    background:#161a11;color:var(--text-dim);cursor:pointer;
  }
  .langBtn.active{border-color:var(--accent);color:var(--accent);}

  #hudBar{display:none;}
  .footNote{font-size:11px;color:var(--text-dim);margin-top:18px;text-align:center;max-width:520px;}
  .bigResult{font-size:clamp(22px,6vw,36px);letter-spacing:2px;margin-bottom:6px;}
  .bigResult.lose{color:var(--danger);}
  .bigResult.win{color:var(--ok);}
  .statLine{color:var(--text-dim);font-size:13px;margin:2px 0 16px;}
  #toast{
    position:absolute;top:14px;left:50%;transform:translateX(-50%);
    background:rgba(20,24,16,0.9);border:2px solid var(--accent);
    padding:8px 16px;border-radius:6px;font-size:13px;letter-spacing:1px;
    z-index:200;pointer-events:none;opacity:0;transition:opacity 0.25s;
  }
  #toast.show{opacity:1;}
</style>
</head>
<body>
<!--
  #stage never moves. #rotWrap is the element that gets rotated 90deg (via a
  CSS class toggled in JS) when the physical screen is taller than it is
  wide, so the whole game fills the entire screen edge-to-edge like a true
  landscape game, instead of shrinking into a small letterboxed box.
  Every child below is positioned relative to #rotWrap's own local box, so
  authoring "bottom-left", "top-right" etc. still works correctly no matter
  which physical corner that ends up at after the rotation is applied.
-->
<div id="stage">
  <div id="rotWrap">
    <div id="canvasWrap">
      <canvas id="game"></canvas>
    </div>

    <div id="touchLayer">
      <div class="joyBase" id="joyBase"><div class="joyStick" id="joyStick"></div></div>
      <div id="fireBtn" data-i18n="fire">FIRE</div>
      <div id="pauseBtn">&#10074;&#10074;</div>
    </div>

    <div id="toast"></div>

    <!-- MAIN MENU -->
    <div class="screen" id="screenMain">
      <div class="titleWrap">
        <h1 class="gameTitle" data-i18n="gameTitle">STEEL BRIGADE</h1>
        <div class="gameSubtitle" data-i18n="gameSubtitle">TANK COMBAT</div>
      </div>
      <button class="menuBtn primary" id="btnStart" data-i18n="startGame">START GAME</button>
      <button class="menuBtn" id="btnMaps" data-i18n="selectMap">SELECT MAP</button>
      <button class="menuBtn" id="btnSound" data-i18n="soundOn">SOUND: ON</button>
      <div class="langRow" id="langRowMain"></div>
    </div>

    <!-- MAP SELECT -->
    <div class="screen hidden" id="screenMaps">
      <div class="titleWrap">
        <h1 class="gameTitle" style="font-size:clamp(20px,5vw,32px)" data-i18n="selectMapTitle">SELECT MAP</h1>
      </div>
      <div id="mapGrid"></div>
      <button class="menuBtn small" id="btnMapsBack" data-i18n="back">BACK</button>
    </div>

    <!-- PAUSE -->
    <div class="screen hidden" id="screenPause">
      <h1 class="gameTitle" style="font-size:clamp(20px,5vw,30px)" data-i18n="paused">PAUSED</h1>
      <button class="menuBtn primary" id="btnResume" data-i18n="resume">RESUME</button>
      <button class="menuBtn" id="btnPauseSound" data-i18n="soundOn">SOUND: ON</button>
      <button class="menuBtn" id="btnPauseMenu" data-i18n="mainMenu">MAIN MENU</button>
    </div>

    <!-- GAME OVER -->
    <div class="screen hidden" id="screenOver">
      <div class="bigResult lose" data-i18n="gameOver">GAME OVER</div>
      <div class="statLine" id="overStats"></div>
      <button class="menuBtn primary" id="btnRetry" data-i18n="retry">RETRY</button>
      <button class="menuBtn" id="btnOverMenu" data-i18n="mainMenu">MAIN MENU</button>
    </div>

    <!-- WIN -->
    <div class="screen hidden" id="screenWin">
      <div class="bigResult win" data-i18n="congrats">CONGRATULATIONS!</div>
      <div class="statLine" id="winStats"></div>
      <button class="menuBtn primary" id="btnNextMap" data-i18n="nextMap">NEXT MAP</button>
      <button class="menuBtn" id="btnWinMenu" data-i18n="mainMenu">MAIN MENU</button>
    </div>
  </div>
</div>

<script>
/* =========================================================================
   STEEL BRIGADE — original Battle-City-style tank game
   Single-file HTML5 canvas game. No external assets/libraries.
   ========================================================================= */
(function(){
'use strict';

/* ----------------------------------------------------------------------
   0. LOCALIZATION
   ---------------------------------------------------------------------- */
const I18N = {
en:{
  gameTitle:"STEEL BRIGADE", gameSubtitle:"TANK COMBAT",
  startGame:"START GAME", selectMap:"SELECT MAP", soundOn:"SOUND: ON", soundOff:"SOUND: OFF",
  selectMapTitle:"SELECT MAP", back:"BACK", fire:"FIRE",
  paused:"PAUSED", resume:"RESUME", mainMenu:"MAIN MENU",
  gameOver:"GAME OVER", retry:"RETRY",
  congrats:"CONGRATULATIONS!", nextMap:"NEXT MAP",
  lives:"LIVES", enemies:"ENEMIES", mapLabel:"MAP",
  mapName1:"Training Field", mapName2:"River Crossing", mapName3:"Steel Fortress",
  mapName4:"Frozen Line", mapName5:"Final Assault",
  diffEasy:"EASY", diffMed:"MEDIUM", diffHard:"HARD", diffVHard:"VERY HARD", diffExtreme:"EXTREME",
  statsOver:"You survived {kills} of {total} enemies", statsWin:"All {total} enemies destroyed!",
  bonusShield:"SHIELD!", bonusLife:"EXTRA LIFE!", bonusBomb:"ENEMIES DESTROYED!",
  bonusFreeze:"ENEMIES FROZEN!", bonusUpgrade:"TANK UPGRADED!",
  locked:"LOCKED"
},
ru:{
  gameTitle:"СТАЛЬНАЯ БРИГАДА", gameSubtitle:"ТАНКОВЫЙ БОЙ",
  startGame:"НАЧАТЬ ИГРУ", selectMap:"ВЫБОР КАРТЫ", soundOn:"ЗВУК: ВКЛ", soundOff:"ЗВУК: ВЫКЛ",
  selectMapTitle:"ВЫБОР КАРТЫ", back:"НАЗАД", fire:"ОГОНЬ",
  paused:"ПАУЗА", resume:"ПРОДОЛЖИТЬ", mainMenu:"ГЛАВНОЕ МЕНЮ",
  gameOver:"ИГРА ОКОНЧЕНА", retry:"ЗАНОВО",
  congrats:"ПОЗДРАВЛЯЕМ!", nextMap:"СЛЕДУЮЩАЯ КАРТА",
  lives:"ЖИЗНИ", enemies:"ВРАГИ", mapLabel:"КАРТА",
  mapName1:"Учебное поле", mapName2:"Переправа", mapName3:"Стальная крепость",
  mapName4:"Ледяная линия", mapName5:"Последний штурм",
  diffEasy:"ЛЕГКО", diffMed:"СРЕДНЕ", diffHard:"СЛОЖНО", diffVHard:"ОЧЕНЬ СЛОЖНО", diffExtreme:"ЭКСТРИМ",
  statsOver:"Уничтожено {kills} из {total} врагов", statsWin:"Все {total} врагов уничтожены!",
  bonusShield:"ЩИТ!", bonusLife:"ДОП. ЖИЗНЬ!", bonusBomb:"ВРАГИ УНИЧТОЖЕНЫ!",
  bonusFreeze:"ВРАГИ ЗАМОРОЖЕНЫ!", bonusUpgrade:"ТАНК УЛУЧШЕН!",
  locked:"ЗАБЛОКИРОВАНО"
},
tr:{
  gameTitle:"ÇELİK TUGAY", gameSubtitle:"TANK SAVAŞI",
  startGame:"OYUNU BAŞLAT", selectMap:"HARİTA SEÇ", soundOn:"SES: AÇIK", soundOff:"SES: KAPALI",
  selectMapTitle:"HARİTA SEÇ", back:"GERİ", fire:"ATEŞ",
  paused:"DURAKLATILDI", resume:"DEVAM ET", mainMenu:"ANA MENÜ",
  gameOver:"OYUN BİTTİ", retry:"TEKRAR DENE",
  congrats:"TEBRİKLER!", nextMap:"SONRAKİ HARİTA",
  lives:"CAN", enemies:"DÜŞMAN", mapLabel:"HARİTA",
  mapName1:"Eğitim Alanı", mapName2:"Nehir Geçidi", mapName3:"Çelik Kale",
  mapName4:"Donmuş Hat", mapName5:"Son Saldırı",
  diffEasy:"KOLAY", diffMed:"ORTA", diffHard:"ZOR", diffVHard:"ÇOK ZOR", diffExtreme:"AŞIRI ZOR",
  statsOver:"{total} düşmandan {kills} tanesi yok edildi", statsWin:"Tüm {total} düşman yok edildi!",
  bonusShield:"KALKAN!", bonusLife:"EK CAN!", bonusBomb:"DÜŞMANLAR YOK EDİLDİ!",
  bonusFreeze:"DÜŞMANLAR DONDURULDU!", bonusUpgrade:"TANK GÜÇLENDİRİLDİ!",
  locked:"KİLİTLİ"
}
};

function getLangFromURL(){
  try{
    const params = new URLSearchParams(window.location.search);
    const l = (params.get('lang')||'').toLowerCase();
    if(l==='ru'||l==='tr'||l==='en') return l;
  }catch(e){}
  return 'en';
}
const CURRENT_LANG = getLangFromURL();
function t(key, vars){
  let s = (I18N[CURRENT_LANG] && I18N[CURRENT_LANG][key]) || I18N.en[key] || key;
  if(vars){
    Object.keys(vars).forEach(k=>{ s = s.replace('{'+k+'}', vars[k]); });
  }
  return s;
}
function applyStaticI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.title = t('gameTitle');
}

/* ----------------------------------------------------------------------
   1. CONSTANTS
   ---------------------------------------------------------------------- */
const TILE = 24;
const COLS = 20;
const ROWS = 15;
const MAP_W = TILE*COLS;      // 480
const MAP_H = TILE*ROWS;      // 360
const HUD_W = 160;
const CANVAS_W = MAP_W + HUD_W; // 640
const CANVAS_H = MAP_H;         // 360

const TileType = { EMPTY:0, BRICK:1, STEEL:2, WATER:3, FOREST:4, ICE:5, BASE:6 };

const BASE_COL = 9, BASE_ROW = ROWS-1;
const PLAYER_START = { col:4, row:ROWS-2 };
const ENEMY_SPAWNS = [ {col:1,row:0}, {col:9,row:0}, {col:18,row:0} ];

const DIR = { UP:{x:0,y:-1}, DOWN:{x:0,y:1}, LEFT:{x:-1,y:0}, RIGHT:{x:1,y:0} };
const DIR_LIST = ['UP','DOWN','LEFT','RIGHT'];

function rand(a,b){ return a + Math.random()*(b-a); }
function randInt(a,b){ return Math.floor(rand(a,b+1)); }
function choice(arr){ return arr[randInt(0,arr.length-1)]; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function rectsOverlap(a,b){
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}

/* ----------------------------------------------------------------------
   2. AUDIO MANAGER (Web Audio API synthesized SFX)
   ---------------------------------------------------------------------- */
class AudioManager{
  constructor(){
    this.ctx = null;
    this.enabled = true;
    this.unlocked = false;
  }
  ensureCtx(){
    if(!this.ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if(this.ctx.state === 'suspended'){ this.ctx.resume(); }
    this.unlocked = true;
  }
  toggle(){ this.enabled = !this.enabled; return this.enabled; }
  _tone(freq, dur, type, volume, delay, sweepTo){
    if(!this.enabled) return;
    this.ensureCtx();
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (delay||0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if(sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1,sweepTo), t0+dur);
    gain.gain.setValueAtTime(volume||0.15, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0+dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0+dur+0.02);
  }
  _noise(dur, volume, delay){
    if(!this.enabled) return;
    this.ensureCtx();
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (delay||0);
    const bufferSize = Math.floor(ctx.sampleRate*dur);
    const buffer = ctx.createBuffer(1,bufferSize,ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++){ data[i] = (Math.random()*2-1) * (1-i/bufferSize); }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume||0.25, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0+dur);
    const filt = ctx.createBiquadFilter();
    filt.type='lowpass'; filt.frequency.value = 1800;
    src.connect(filt).connect(gain).connect(ctx.destination);
    src.start(t0);
  }
  shoot(){ this._tone(520,0.09,'square',0.12,0,260); }
  explosion(){ this._noise(0.35,0.3,0); this._tone(90,0.3,'sawtooth',0.15,0,40); }
  bonus(){
    this._tone(523,0.09,'square',0.14,0);
    this._tone(659,0.09,'square',0.14,0.09);
    this._tone(784,0.14,'square',0.14,0.18);
  }
  hit(){ this._tone(180,0.08,'square',0.12,0,80); }
  win(){
    [523,659,784,1046].forEach((f,i)=> this._tone(f,0.22,'square',0.15,i*0.16));
  }
  lose(){
    [392,330,262,196].forEach((f,i)=> this._tone(f,0.28,'sawtooth',0.16,i*0.2));
  }
}

/* ----------------------------------------------------------------------
   3. INPUT (virtual joystick + fire button + keyboard fallback)
   ---------------------------------------------------------------------- */
class Input{
  constructor(){
    this.moveDir = null;     // 'UP'|'DOWN'|'LEFT'|'RIGHT'|null
    this.firing = false;
    this.fireJustPressed = false;
    this._keys = {};
    this._joyActive = false;
    this._joyTouchId = null;
    this._joyBase = document.getElementById('joyBase');
    this._joyStick = document.getElementById('joyStick');
    this._fireBtn = document.getElementById('fireBtn');
    this._bindJoystick();
    this._bindFire();
    this._bindKeyboard();
  }
  _bindJoystick(){
    const base = this._joyBase, stick = this._joyStick;
    const rect = ()=> base.getBoundingClientRect();
    const handleMove = (clientX, clientY)=>{
      const r = rect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      let dx = clientX - cx, dy = clientY - cy;
      const dist = Math.hypot(dx,dy);
      const maxD = r.width/2;
      const clampedDist = Math.min(dist,maxD);
      const ang = Math.atan2(dy,dx);
      const sx = Math.cos(ang)*clampedDist, sy = Math.sin(ang)*clampedDist;
      stick.style.transform = `translate(${sx}px, ${sy}px)`;
      if(dist < maxD*0.22){ this.moveDir = null; return; }
      // Determine dominant 4-direction
      const deg = ang*180/Math.PI;
      if(deg>=-45 && deg<45) this.moveDir='RIGHT';
      else if(deg>=45 && deg<135) this.moveDir='DOWN';
      else if(deg>=-135 && deg<-45) this.moveDir='UP';
      else this.moveDir='LEFT';
    };
    const reset = ()=>{ this.moveDir=null; stick.style.transform='translate(0,0)'; this._joyActive=false; this._joyTouchId=null; };
    base.addEventListener('touchstart', e=>{
      e.preventDefault();
      const touch = e.changedTouches[0];
      this._joyActive = true; this._joyTouchId = touch.identifier;
      handleMove(touch.clientX, touch.clientY);
    }, {passive:false});
    base.addEventListener('touchmove', e=>{
      e.preventDefault();
      for(const touch of e.changedTouches){
        if(touch.identifier === this._joyTouchId) handleMove(touch.clientX, touch.clientY);
      }
    }, {passive:false});
    base.addEventListener('touchend', e=>{
      e.preventDefault();
      for(const touch of e.changedTouches){ if(touch.identifier === this._joyTouchId) reset(); }
    }, {passive:false});
    base.addEventListener('touchcancel', e=>{ reset(); }, {passive:false});
    // mouse support (desktop testing)
    base.addEventListener('mousedown', e=>{ this._joyActive=true; handleMove(e.clientX,e.clientY); });
    window.addEventListener('mousemove', e=>{ if(this._joyActive) handleMove(e.clientX,e.clientY); });
    window.addEventListener('mouseup', e=>{ if(this._joyActive) reset(); });
  }
  _bindFire(){
    const btn = this._fireBtn;
    const start = (e)=>{ e.preventDefault(); this.firing=true; this.fireJustPressed=true; btn.classList.add('active'); };
    const end = (e)=>{ e.preventDefault(); this.firing=false; btn.classList.remove('active'); };
    btn.addEventListener('touchstart', start, {passive:false});
    btn.addEventListener('touchend', end, {passive:false});
    btn.addEventListener('touchcancel', end, {passive:false});
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', end);
    btn.addEventListener('mouseleave', end);
  }
  _bindKeyboard(){
    window.addEventListener('keydown', e=>{
      this._keys[e.key.toLowerCase()] = true;
      if(e.key===' ') { this.firing=true; this.fireJustPressed=true; }
      this._updateFromKeys();
    });
    window.addEventListener('keyup', e=>{
      this._keys[e.key.toLowerCase()] = false;
      if(e.key===' ') this.firing=false;
      this._updateFromKeys();
    });
  }
  _updateFromKeys(){
    const k = this._keys;
    if(k['arrowup']||k['w']) this.moveDir='UP';
    else if(k['arrowdown']||k['s']) this.moveDir='DOWN';
    else if(k['arrowleft']||k['a']) this.moveDir='LEFT';
    else if(k['arrowright']||k['d']) this.moveDir='RIGHT';
    else if(!this._joyActive) this.moveDir=null;
  }
  consumeFirePress(){
    const v = this.fireJustPressed;
    this.fireJustPressed = false;
    return v;
  }
}

/* ----------------------------------------------------------------------
   4. MAP DEFINITIONS & MAP CLASS
   ---------------------------------------------------------------------- */
// Region helper: returns list of {type,col,row}
function rectRegion(type,x,y,w,h){
  const cells=[];
  for(let r=y;r<y+h;r++) for(let c=x;c<x+w;c++) cells.push({type,col:c,row:r});
  return cells;
}
function cellsRegion(type, coords){
  return coords.map(([c,r])=>({type,col:c,row:r}));
}

function baseFort(){
  // Small brick fort around the base, leaves base cell itself open for BASE tile.
  return cellsRegion(TileType.BRICK, [
    [BASE_COL-1,BASE_ROW-1],[BASE_COL,BASE_ROW-1],[BASE_COL+1,BASE_ROW-1],
    [BASE_COL-1,BASE_ROW],[BASE_COL+1,BASE_ROW]
  ]);
}

const MAP_DEFS = [
  { // Map 1 - Training Field (easy)
    nameKey:'mapName1', diffKey:'diffEasy',
    enemyMix:{normal:0.8,fast:0.15,heavy:0.05}, spawnInterval:2600, enemySpeedMul:1.0,
    regions:[
      ...baseFort(),
      rectRegion(TileType.BRICK,2,3,3,1),
      rectRegion(TileType.BRICK,8,3,4,1),
      rectRegion(TileType.BRICK,15,3,3,1),
      rectRegion(TileType.BRICK,2,7,2,3),
      rectRegion(TileType.BRICK,16,7,2,3),
      rectRegion(TileType.FOREST,9,6,2,2),
      rectRegion(TileType.BRICK,6,10,1,3),
      rectRegion(TileType.BRICK,13,10,1,3),
    ].flat()
  },
  { // Map 2 - River Crossing (easy-medium)
    nameKey:'mapName2', diffKey:'diffMed',
    enemyMix:{normal:0.6,fast:0.3,heavy:0.1}, spawnInterval:2300, enemySpeedMul:1.05,
    regions:[
      ...baseFort(),
      rectRegion(TileType.WATER,0,6,6,2),
      rectRegion(TileType.WATER,14,6,6,2),
      rectRegion(TileType.BRICK,8,2,4,1),
      rectRegion(TileType.BRICK,3,2,2,4),
      rectRegion(TileType.BRICK,15,2,2,4),
      rectRegion(TileType.FOREST,8,9,4,2),
      rectRegion(TileType.BRICK,6,12,2,1),
      rectRegion(TileType.BRICK,12,12,2,1),
      rectRegion(TileType.STEEL,9,6,2,1),
    ].flat()
  },
  { // Map 3 - Steel Fortress (medium-hard)
    nameKey:'mapName3', diffKey:'diffHard',
    enemyMix:{normal:0.45,fast:0.3,heavy:0.25}, spawnInterval:2000, enemySpeedMul:1.1,
    regions:[
      ...baseFort(),
      rectRegion(TileType.STEEL,0,5,4,1),
      rectRegion(TileType.STEEL,16,5,4,1),
      rectRegion(TileType.BRICK,4,5,3,1),
      rectRegion(TileType.BRICK,13,5,3,1),
      rectRegion(TileType.BRICK,9,2,2,3),
      rectRegion(TileType.STEEL,2,9,2,3),
      rectRegion(TileType.STEEL,16,9,2,3),
      rectRegion(TileType.BRICK,6,9,2,4),
      rectRegion(TileType.BRICK,12,9,2,4),
      rectRegion(TileType.FOREST,9,9,2,2),
    ].flat()
  },
  { // Map 4 - Frozen Line (hard)
    nameKey:'mapName4', diffKey:'diffVHard',
    enemyMix:{normal:0.3,fast:0.35,heavy:0.35}, spawnInterval:1800, enemySpeedMul:1.15,
    regions:[
      ...baseFort(),
      rectRegion(TileType.ICE,0,6,20,3),
      rectRegion(TileType.STEEL,4,6,1,3),
      rectRegion(TileType.STEEL,15,6,1,3),
      rectRegion(TileType.BRICK,8,6,1,3),
      rectRegion(TileType.BRICK,11,6,1,3),
      rectRegion(TileType.BRICK,2,2,3,1),
      rectRegion(TileType.BRICK,15,2,3,1),
      rectRegion(TileType.WATER,9,10,2,2),
      rectRegion(TileType.FOREST,5,11,2,2),
      rectRegion(TileType.FOREST,13,11,2,2),
    ].flat()
  },
  { // Map 5 - Final Assault (extreme)
    nameKey:'mapName5', diffKey:'diffExtreme',
    enemyMix:{normal:0.2,fast:0.35,heavy:0.45}, spawnInterval:1500, enemySpeedMul:1.25,
    regions:[
      ...baseFort(),
      rectRegion(TileType.STEEL,7,12,6,1),
      rectRegion(TileType.STEEL,0,8,3,1),
      rectRegion(TileType.STEEL,17,8,3,1),
      rectRegion(TileType.BRICK,3,8,4,1),
      rectRegion(TileType.BRICK,13,8,4,1),
      rectRegion(TileType.WATER,9,4,2,2),
      rectRegion(TileType.ICE,2,10,4,2),
      rectRegion(TileType.ICE,14,10,4,2),
      rectRegion(TileType.BRICK,9,2,2,2),
      rectRegion(TileType.STEEL,5,4,1,3),
      rectRegion(TileType.STEEL,14,4,1,3),
      rectRegion(TileType.FOREST,0,0,2,2),
      rectRegion(TileType.FOREST,18,0,2,2),
    ].flat()
  }
];

class GameMap{
  constructor(def){
    this.def = def;
    this.grid = [];
    for(let r=0;r<ROWS;r++){ this.grid.push(new Array(COLS).fill(TileType.EMPTY)); }
    def.regions.forEach(cell=>{
      if(cell.col>=0 && cell.col<COLS && cell.row>=0 && cell.row<ROWS){
        this.grid[cell.row][cell.col] = cell.type;
      }
    });
    this.grid[BASE_ROW][BASE_COL] = TileType.BASE;
    this.baseDestroyed = false;
  }
  tileAt(col,row){
    if(col<0||col>=COLS||row<0||row>=ROWS) return TileType.STEEL; // treat OOB as solid boundary
    return this.grid[row][col];
  }
  setTile(col,row,type){ if(col>=0&&col<COLS&&row>=0&&row<ROWS) this.grid[row][col]=type; }
  isSolidForTank(type){
    return type===TileType.BRICK || type===TileType.STEEL || type===TileType.WATER || type===TileType.BASE;
  }
  isSolidForBullet(type){
    return type===TileType.BRICK || type===TileType.STEEL || type===TileType.BASE;
  }
  // Check collision of an axis-aligned box (pixel coords, map space) against solid tiles
  boxHitsSolid(box, forBullet){
    const c0 = Math.floor(box.x/TILE), c1 = Math.floor((box.x+box.w-1)/TILE);
    const r0 = Math.floor(box.y/TILE), r1 = Math.floor((box.y+box.h-1)/TILE);
    for(let r=r0;r<=r1;r++){
      for(let c=c0;c<=c1;c++){
        const type = this.tileAt(c,r);
        if(forBullet ? this.isSolidForBullet(type) : this.isSolidForTank(type)) return {col:c,row:r,type};
      }
    }
    return null;
  }
  destroyBrickAt(col,row){
    if(this.tileAt(col,row)===TileType.BRICK) this.setTile(col,row,TileType.EMPTY);
  }
  hitBase(){
    if(this.tileAt(BASE_COL,BASE_ROW)===TileType.BASE){
      this.setTile(BASE_COL,BASE_ROW,TileType.EMPTY);
      this.baseDestroyed = true;
      return true;
    }
    return false;
  }
  draw(ctx){
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        this.drawTile(ctx,c,r,this.grid[r][c]);
      }
    }
  }
  // forest drawn separately (on top of tanks) for cover effect
  drawForestOverlay(ctx){
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        if(this.grid[r][c]===TileType.FOREST) this.drawTile(ctx,c,r,TileType.FOREST);
      }
    }
  }
  drawTile(ctx,c,r,type){
    const x=c*TILE, y=r*TILE;
    switch(type){
      case TileType.EMPTY:
      case TileType.ICE:
        // ice drawn as pale blue floor
        if(type===TileType.ICE){
          ctx.fillStyle='#cfe8f2';
          ctx.fillRect(x,y,TILE,TILE);
          ctx.strokeStyle='rgba(255,255,255,0.6)';
          ctx.lineWidth=1;
          ctx.beginPath();
          ctx.moveTo(x+3,y+TILE-3); ctx.lineTo(x+TILE-6,y+4);
          ctx.stroke();
        }
        break;
      case TileType.BRICK:
        ctx.fillStyle='#8a4a2c';
        ctx.fillRect(x,y,TILE,TILE);
        ctx.strokeStyle='#5c2f1a';
        ctx.lineWidth=1;
        for(let i=0;i<TILE;i+=6){ ctx.beginPath(); ctx.moveTo(x,y+i); ctx.lineTo(x+TILE,y+i); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(x+TILE/2,y); ctx.lineTo(x+TILE/2,y+6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x+TILE/2,y+12); ctx.lineTo(x+TILE/2,y+18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x,y+9); ctx.lineTo(x+6,y+9); ctx.stroke();
        break;
      case TileType.STEEL:
        ctx.fillStyle='#7c8694';
        ctx.fillRect(x,y,TILE,TILE);
        ctx.strokeStyle='#3d4450';
        ctx.lineWidth=2;
        ctx.strokeRect(x+1,y+1,TILE-2,TILE-2);
        ctx.fillStyle='#a6afba';
        ctx.fillRect(x+3,y+3,6,6);
        ctx.fillRect(x+TILE-9,y+TILE-9,6,6);
        break;
      case TileType.WATER:
        ctx.fillStyle='#2a5fa0';
        ctx.fillRect(x,y,TILE,TILE);
        ctx.strokeStyle='rgba(255,255,255,0.35)';
        ctx.lineWidth=1;
        const wOff = (Math.floor(Date.now()/300)%2)*4;
        for(let i=-4;i<TILE+4;i+=8){
          ctx.beginPath(); ctx.moveTo(x+i+wOff,y+4); ctx.quadraticCurveTo(x+i+4+wOff,y+8,x+i+8+wOff,y+4); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x+i+wOff,y+16); ctx.quadraticCurveTo(x+i+4+wOff,y+20,x+i+8+wOff,y+16); ctx.stroke();
        }
        break;
      case TileType.FOREST:
        ctx.fillStyle='#2e5a2e';
        ctx.beginPath(); ctx.arc(x+7,y+8,8,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(x+16,y+7,7,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(x+11,y+16,8,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#3f7a3a';
        ctx.beginPath(); ctx.arc(x+8,y+9,4,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(x+15,y+8,3.5,0,Math.PI*2); ctx.fill();
        break;
      case TileType.BASE:
        ctx.fillStyle='#151a10';
        ctx.fillRect(x,y,TILE,TILE);
        ctx.fillStyle='#e8a33d';
        ctx.beginPath();
        ctx.moveTo(x+TILE/2,y+3);
        ctx.lineTo(x+TILE-4,y+TILE-4);
        ctx.lineTo(x+4,y+TILE-4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle='#c1502e';
        ctx.fillRect(x+TILE/2-2,y+TILE-9,4,5);
        break;
    }
  }
}

/* ----------------------------------------------------------------------
   5. TANKS (base class + Player + Enemy)
   ---------------------------------------------------------------------- */
let ENTITY_ID = 1;

class Tank{
  constructor(col,row,isPlayer){
    this.id = ENTITY_ID++;
    this.x = col*TILE;
    this.y = row*TILE;
    this.w = TILE-2; this.h = TILE-2;
    this.dir = 'UP';
    this.speed = 60; // px/sec
    this.isPlayer = !!isPlayer;
    this.alive = true;
    this.hp = 1;
    this.maxHp = 1;
    this.bulletSpeed = 220;
    this.bulletLimit = 1;
    this.activeBullets = 0;
    this.trackPhase = 0;
    this.shieldTime = 0;
    this.spawnTime = 1.0; // spawn invulnerability / animation
    this.frozen = 0;
  }
  get box(){ return {x:this.x, y:this.y, w:this.w, h:this.h}; }
  centerCol(){ return Math.floor((this.x+this.w/2)/TILE); }
  centerRow(){ return Math.floor((this.y+this.h/2)/TILE); }
  onIce(map){
    const c = this.centerCol(), r = this.centerRow();
    return map.tileAt(c,r)===TileType.ICE;
  }
  tryMove(map, dir, dt, otherTanks){
    const d = DIR[dir];
    let speedMul = this.onIce(map) ? 1.35 : 1.0;
    const dist = this.speed*speedMul*dt;
    let nx = this.x + d.x*dist;
    let ny = this.y + d.y*dist;
    // snap perpendicular axis toward grid alignment for clean turning
    if(d.x!==0){
      const targetRow = Math.round(this.y/TILE)*TILE;
      ny += (targetRow-this.y) * Math.min(1, dt*10);
    } else if(d.y!==0){
      const targetCol = Math.round(this.x/TILE)*TILE;
      nx += (targetCol-this.x) * Math.min(1, dt*10);
    }
    nx = clamp(nx,0,MAP_W-this.w);
    ny = clamp(ny,0,MAP_H-this.h);
    const testBox = {x:nx,y:ny,w:this.w,h:this.h};
    if(map.boxHitsSolid(testBox,false)) return false;
    for(const other of otherTanks){
      if(other===this || !other.alive) continue;
      if(rectsOverlap(testBox, other.box)) return false;
    }
    this.x = nx; this.y = ny;
    this.trackPhase += dist;
    return true;
  }
  colorScheme(){ return {body:'#8fae4a', dark:'#5c7a2c', turret:'#3f5a1e'}; }
  drawBody(ctx, cs){
    const x=this.x, y=this.y, w=this.w, h=this.h;
    ctx.save();
    ctx.translate(x+w/2, y+h/2);
    const angle = {UP:0, RIGHT:Math.PI/2, DOWN:Math.PI, LEFT:-Math.PI/2}[this.dir];
    ctx.rotate(angle);
    const hw=w/2, hh=h/2;
    // treads (animated)
    ctx.fillStyle = cs.dark;
    ctx.fillRect(-hw, -hh, 4, h);
    ctx.fillRect(hw-4, -hh, 4, h);
    ctx.fillStyle = '#20260f';
    const phase = Math.floor(this.trackPhase/4)%2;
    for(let i=-hh; i<hh; i+=6){
      const off = ((i+phase*3) % 6 + 6) % 6;
      ctx.fillRect(-hw, i+off-6, 4, 2);
      ctx.fillRect(hw-4, i+off-6, 4, 2);
    }
    // hull
    ctx.fillStyle = cs.body;
    ctx.fillRect(-hw+3, -hh+2, w-6, h-4);
    ctx.strokeStyle = cs.dark;
    ctx.lineWidth=1;
    ctx.strokeRect(-hw+3, -hh+2, w-6, h-4);
    // turret
    ctx.fillStyle = cs.turret;
    ctx.beginPath(); ctx.arc(0,0,hw-4,0,Math.PI*2); ctx.fill();
    // barrel
    ctx.fillStyle = cs.turret;
    ctx.fillRect(-2, -hh-4, 4, hh+4);
    ctx.restore();
    // shield ring
    if(this.shieldTime>0){
      ctx.strokeStyle = `rgba(120,200,255,${0.5+0.3*Math.sin(Date.now()/80)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x+w/2,y+h/2,w/2+4,0,Math.PI*2); ctx.stroke();
    }
  }
  update(dt, map, otherTanks){
    if(this.shieldTime>0) this.shieldTime -= dt;
    if(this.spawnTime>0) this.spawnTime -= dt;
  }
}

class PlayerTank extends Tank{
  constructor(col,row){
    super(col,row,true);
    this.speed = 72;
    this.lives = 3;
    this.level = 0; // upgrade level 0-2
    this.invulnTime = 1.5;
    this.applyLevel();
  }
  applyLevel(){
    this.bulletLimit = this.level>=1 ? 2 : 1;
    this.bulletSpeed = 220 + this.level*40;
    this.speed = 72 + this.level*8;
    this.pierceSteel = this.level>=2;
  }
  colorScheme(){ return {body:'#e8c96a', dark:'#8a6a1f', turret:'#6b4c17'}; }
  upgrade(){ this.level = Math.min(2,this.level+1); this.applyLevel(); }
  hitByBullet(){
    if(this.shieldTime>0 || this.invulnTime>0) return false;
    this.lives -= 1;
    this.invulnTime = 1.8;
    if(this.lives<=0) this.alive = false;
    return true;
  }
  update(dt, map, otherTanks, input){
    super.update(dt, map, otherTanks);
    if(this.invulnTime>0) this.invulnTime -= dt;
    if(input.moveDir){
      this.dir = input.moveDir;
      this.tryMove(map, input.moveDir, dt, otherTanks);
    }
  }
  draw(ctx){
    if(this.invulnTime>0 && Math.floor(this.invulnTime*12)%2===0) return; // blink while invulnerable
    this.drawBody(ctx, this.colorScheme());
  }
}

const ENEMY_TYPES = {
  normal: { hp:1, speed:46, color:{body:'#c1502e',dark:'#7a2d17',turret:'#5c2210'}, score:100, fireInterval:[1400,2600] },
  fast:   { hp:1, speed:78, color:{body:'#d9c23e',dark:'#8c7a1f',turret:'#6b5c17'}, score:150, fireInterval:[1000,2000] },
  heavy:  { hp:3, speed:32, color:{body:'#6a4fae',dark:'#3d2c6b',turret:'#2c1f4d'}, score:300, fireInterval:[1600,3000] }
};

class EnemyTank extends Tank{
  constructor(col,row,kind){
    super(col,row,false);
    this.kind = kind;
    const def = ENEMY_TYPES[kind];
    this.hp = def.hp; this.maxHp = def.hp;
    this.speed = def.speed;
    this.def = def;
    this.dir = 'DOWN';
    this.decisionTimer = rand(0.3,1.2);
    this.fireTimer = rand(def.fireInterval[0],def.fireInterval[1])/1000;
    this.spawnTime = 0.8;
  }
  colorScheme(){ return this.def.color; }
  chooseDirection(map, player, otherTanks){
    const toBase = Math.random() < 0.35;
    const toPlayer = !toBase && Math.random() < 0.25 && player && player.alive;
    let candidates = DIR_LIST.slice();
    if(toBase || toPlayer){
      const targetCol = toBase ? BASE_COL : player.centerCol();
      const targetRow = toBase ? BASE_ROW : player.centerRow();
      const dc = targetCol - this.centerCol();
      const dr = targetRow - this.centerRow();
      const preferred = Math.abs(dc) > Math.abs(dr)
        ? (dc>0?'RIGHT':'LEFT')
        : (dr>0?'DOWN':'UP');
      candidates = [preferred, ...candidates.filter(d=>d!==preferred)];
    }else{
      candidates.sort(()=>Math.random()-0.5);
    }
    for(const d of candidates){
      const dd = DIR[d];
      const test = {x:this.x+dd.x*6, y:this.y+dd.y*6, w:this.w, h:this.h};
      let blocked = map.boxHitsSolid(test,false);
      if(!blocked){
        for(const o of otherTanks){
          if(o===this||!o.alive) continue;
          if(rectsOverlap(test,o.box)){ blocked=true; break; }
        }
      }
      if(!blocked) return d;
    }
    return this.dir;
  }
  update(dt, map, otherTanks, player, frozenGlobal){
    super.update(dt, map, otherTanks);
    if(this.spawnTime>0) return;
    if(frozenGlobal>0 || this.frozen>0) return;
    this.decisionTimer -= dt;
    if(this.decisionTimer<=0){
      this.dir = this.chooseDirection(map, player, otherTanks);
      this.decisionTimer = rand(0.5,1.6);
    }
    const moved = this.tryMove(map, this.dir, dt, otherTanks);
    if(!moved){ this.decisionTimer = 0; }
    this.fireTimer -= dt;
  }
  wantsToFire(){
    if(this.spawnTime>0) return false;
    if(this.fireTimer<=0 && this.activeBullets < this.bulletLimit){
      this.fireTimer = rand(this.def.fireInterval[0],this.def.fireInterval[1])/1000;
      return true;
    }
    return false;
  }
  draw(ctx){
    if(this.spawnTime>0){
      // spawn flash animation
      const x=this.x,y=this.y;
      ctx.save();
      ctx.globalAlpha = 0.5+0.5*Math.sin(Date.now()/40);
      ctx.strokeStyle='#fff'; ctx.lineWidth=2;
      ctx.strokeRect(x,y,this.w,this.h);
      ctx.strokeStyle='#e8a33d';
      ctx.strokeRect(x+3,y+3,this.w-6,this.h-6);
      ctx.restore();
      return;
    }
    this.drawBody(ctx, this.colorScheme());
    if(this.frozen>0){
      ctx.fillStyle='rgba(150,220,255,0.35)';
      ctx.fillRect(this.x-2,this.y-2,this.w+4,this.h+4);
    }
    if(this.maxHp>1){
      // hp pips
      for(let i=0;i<this.maxHp;i++){
        ctx.fillStyle = i<this.hp ? '#e8e6d9' : '#3a4530';
        ctx.fillRect(this.x+2+i*5, this.y-6, 3,3);
      }
    }
  }
}

/* ----------------------------------------------------------------------
   6. BULLETS
   ---------------------------------------------------------------------- */
class Bullet{
  constructor(owner, x, y, dir, speed, pierceSteel){
    this.owner = owner;
    this.x=x; this.y=y;
    this.w=4; this.h=4;
    this.dir=dir;
    this.speed=speed;
    this.alive=true;
    this.pierceSteel=!!pierceSteel;
    owner.activeBullets = (owner.activeBullets||0)+1;
  }
  get box(){ return {x:this.x-this.w/2,y:this.y-this.h/2,w:this.w,h:this.h}; }
  update(dt){
    const d=DIR[this.dir];
    this.x += d.x*this.speed*dt;
    this.y += d.y*this.speed*dt;
    if(this.x<0||this.x>MAP_W||this.y<0||this.y>MAP_H) this.alive=false;
  }
  release(){
    if(this.owner) this.owner.activeBullets = Math.max(0,(this.owner.activeBullets||1)-1);
  }
  draw(ctx){
    ctx.save();
    ctx.translate(this.x,this.y);
    ctx.fillStyle = this.owner && this.owner.isPlayer ? '#fff2c9' : '#ffcfae';
    ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

/* ----------------------------------------------------------------------
   7. PARTICLES (explosions / spawn puffs)
   ---------------------------------------------------------------------- */
class Explosion{
  constructor(x,y,scale){
    this.x=x; this.y=y; this.t=0; this.dur=0.4; this.scale=scale||1; this.alive=true;
  }
  update(dt){ this.t+=dt; if(this.t>=this.dur) this.alive=false; }
  draw(ctx){
    const p = this.t/this.dur;
    const r = 4 + p*16*this.scale;
    ctx.save();
    ctx.globalAlpha = 1-p;
    ctx.fillStyle = '#ffd35c';
    ctx.beginPath(); ctx.arc(this.x,this.y,r*0.6,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#ff7a3c';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(this.x,this.y,r,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='#c1502e';
    for(let i=0;i<6;i++){
      const ang = i/6*Math.PI*2;
      ctx.beginPath();
      ctx.arc(this.x+Math.cos(ang)*r*0.9, this.y+Math.sin(ang)*r*0.9, Math.max(1,3-p*3), 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* ----------------------------------------------------------------------
   8. BONUS ITEMS
   ---------------------------------------------------------------------- */
const BONUS_TYPES = ['shield','life','bomb','freeze','upgrade'];
class Bonus{
  constructor(col,row,kind){
    this.col=col; this.row=row; this.kind=kind;
    this.x=col*TILE; this.y=row*TILE;
    this.w=TILE; this.h=TILE;
    this.alive=true;
    this.time=0;
    this.lifespan=9; // seconds before disappearing
  }
  get box(){ return {x:this.x,y:this.y,w:this.w,h:this.h}; }
  update(dt){ this.time+=dt; if(this.time>this.lifespan) this.alive=false; }
  draw(ctx){
    const blink = Math.sin(this.time*8) > -0.3;
    if(!blink) return;
    const x=this.x,y=this.y;
    ctx.save();
    ctx.fillStyle='#151a10';
    ctx.fillRect(x+1,y+1,TILE-2,TILE-2);
    ctx.strokeStyle='#e8a33d';
    ctx.lineWidth=2;
    ctx.strokeRect(x+1,y+1,TILE-2,TILE-2);
    ctx.fillStyle='#e8a33d';
    ctx.font='bold 13px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    const glyph = {shield:'S', life:'+', bomb:'X', freeze:'F', upgrade:'U'}[this.kind];
    ctx.fillText(glyph, x+TILE/2, y+TILE/2+1);
    ctx.restore();
  }
}

/* ----------------------------------------------------------------------
   9. HUD (drawn on canvas sidebar)
   ---------------------------------------------------------------------- */
class HUD{
  draw(ctx, game){
    const x0 = MAP_W;
    ctx.save();
    ctx.fillStyle = '#12150e';
    ctx.fillRect(x0,0,HUD_W,CANVAS_H);
    ctx.strokeStyle = '#3a4530';
    ctx.lineWidth=2;
    ctx.strokeRect(x0+1,1,HUD_W-2,CANVAS_H-2);

    ctx.fillStyle='#e8a33d';
    ctx.font='bold 13px monospace';
    ctx.textAlign='left';
    let y=22;
    ctx.fillText(t('mapLabel')+':', x0+12, y);
    ctx.fillStyle='#e8e6d9';
    ctx.font='12px monospace';
    ctx.fillText(t(game.currentMapDef.nameKey), x0+12, y+16);
    y+=44;

    ctx.fillStyle='#e8a33d';
    ctx.font='bold 13px monospace';
    ctx.fillText(t('lives')+':', x0+12, y);
    for(let i=0;i<Math.max(0,game.player?game.player.lives:0);i++){
      this.drawMiniTank(ctx, x0+14+i*22, y+14);
    }
    y+=42;

    ctx.fillStyle='#e8a33d';
    ctx.fillText(t('enemies')+':', x0+12, y);
    ctx.fillStyle='#e8e6d9';
    ctx.font='12px monospace';
    const remaining = game.totalEnemies - game.enemiesDestroyed;
    ctx.fillText(remaining+' / '+game.totalEnemies, x0+12, y+16);
    y+=30;
    // remaining enemy icons grid
    const iconsPerRow=5;
    for(let i=0;i<remaining;i++){
      const cx = x0+16+(i%iconsPerRow)*16;
      const cy = y+8+Math.floor(i/iconsPerRow)*14;
      ctx.fillStyle='#c1502e';
      ctx.fillRect(cx,cy,9,9);
    }
    y+=70;

    if(game.player){
      ctx.fillStyle='#e8a33d';
      ctx.font='bold 12px monospace';
      ctx.fillText('LV.'+ (game.player.level+1), x0+12, CANVAS_H-16);
    }
    ctx.restore();
  }
  drawMiniTank(ctx,x,y){
    ctx.fillStyle='#e8c96a';
    ctx.fillRect(x,y,14,10);
    ctx.fillStyle='#6b4c17';
    ctx.fillRect(x+5,y-3,4,5);
  }
}

/* ----------------------------------------------------------------------
   10. GAME (main orchestrator)
   ---------------------------------------------------------------------- */
class Game{
  constructor(){
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.audio = new AudioManager();
    this.input = new Input();
    this.hud = new HUD();

    this.state = 'menu'; // menu | mapselect | playing | paused | gameover | win
    this.currentMapIndex = 0;
    this.unlockedMaps = 1;
    this.lastTime = 0;

    this._setupResize();
    this._setupMenus();
    this._setupPauseTouch();
    requestAnimationFrame(this.loop.bind(this));
  }

  /* ---- responsive canvas scaling (mobile-first, letterboxed, no rotation) ---- */
  _setupResize(){
    const stage = document.getElementById('stage');
    const rotWrap = document.getElementById('rotWrap');
    const wrap = document.getElementById('canvasWrap');
    const resize = ()=>{
      const vw = window.innerWidth, vh = window.innerHeight;
      // If the physical screen is taller than it is wide, rotate the whole
      // game 90deg so it fills the ENTIRE screen like a real landscape
      // game, instead of shrinking into a small letterboxed box. The user
      // is never asked to rotate their device — we just rotate the pixels.
      const portrait = vh > vw;
      stage.classList.toggle('rotated', portrait);
      // availW/availH = the box #rotWrap occupies from its own (local,
      // pre-rotation) point of view. When rotated, that box's width runs
      // along the screen's long (height) axis and its height along the
      // screen's short (width) axis — so we swap them here.
      const availW = portrait ? vh : vw;
      const availH = portrait ? vw : vh;
      rotWrap.style.width = availW+'px';
      rotWrap.style.height = availH+'px';

      const aspect = CANVAS_W/CANVAS_H;
      let dispW = availW, dispH = availW/aspect;
      if(dispH > availH){ dispH = availH; dispW = availH*aspect; }
      wrap.style.width = dispW+'px';
      wrap.style.height = dispH+'px';
      const dpr = Math.min(window.devicePixelRatio||1, 2.5);
      this.canvas.width = Math.round(dispW*dpr);
      this.canvas.height = Math.round(dispH*dpr);
      this.canvas.style.width = dispW+'px';
      this.canvas.style.height = dispH+'px';
      this.ctx.setTransform(1,0,0,1,0,0);
      this.ctx.scale((dispW*dpr)/CANVAS_W, (dispH*dpr)/CANVAS_H);
    };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', ()=> setTimeout(resize,50));
    resize();
    // prevent gestures
    document.addEventListener('gesturestart', e=>e.preventDefault());
    document.addEventListener('contextmenu', e=>e.preventDefault());
    document.addEventListener('touchmove', e=>{ if(e.scale && e.scale!==1) e.preventDefault(); }, {passive:false});
  }

  _setupMenus(){
    applyStaticI18n();
    this._buildLangRow();
    this._buildMapGrid();
    this._updateSoundLabels();

    document.getElementById('btnStart').addEventListener('click', ()=>{
      this.audio.ensureCtx();
      this.startMap(this.currentMapIndex);
    });
    document.getElementById('btnMaps').addEventListener('click', ()=>{
      this.showScreen('screenMaps');
    });
    document.getElementById('btnMapsBack').addEventListener('click', ()=>{
      this.showScreen('screenMain');
    });
    document.getElementById('btnSound').addEventListener('click', ()=>{
      this.audio.ensureCtx();
      this.audio.toggle(); this._updateSoundLabels();
    });
    document.getElementById('btnPauseSound').addEventListener('click', ()=>{
      this.audio.toggle(); this._updateSoundLabels();
    });
    document.getElementById('btnResume').addEventListener('click', ()=> this.resume());
    document.getElementById('btnPauseMenu').addEventListener('click', ()=> this.toMainMenu());
    document.getElementById('btnRetry').addEventListener('click', ()=> this.startMap(this.currentMapIndex));
    document.getElementById('btnOverMenu').addEventListener('click', ()=> this.toMainMenu());
    document.getElementById('btnNextMap').addEventListener('click', ()=>{
      const next = Math.min(MAP_DEFS.length-1, this.currentMapIndex+1);
      this.startMap(next);
    });
    document.getElementById('btnWinMenu').addEventListener('click', ()=> this.toMainMenu());
  }

  _setupPauseTouch(){
    const btn = document.getElementById('pauseBtn');
    const handler = (e)=>{ e.preventDefault(); if(this.state==='playing') this.pause(); else if(this.state==='paused') this.resume(); };
    btn.addEventListener('touchstart', handler, {passive:false});
    btn.addEventListener('click', handler);
  }

  _buildLangRow(){
    const row = document.getElementById('langRowMain');
    row.innerHTML='';
    ['en','ru','tr'].forEach(l=>{
      const b = document.createElement('button');
      b.className='langBtn'+(l===CURRENT_LANG?' active':'');
      b.textContent = l.toUpperCase();
      b.addEventListener('click', ()=>{
        const params = new URLSearchParams(window.location.search);
        params.set('lang', l);
        window.location.search = params.toString();
      });
      row.appendChild(b);
    });
  }

  _updateSoundLabels(){
    const label = this.audio.enabled ? t('soundOn') : t('soundOff');
    document.getElementById('btnSound').textContent = label;
    document.getElementById('btnPauseSound').textContent = label;
  }

  _buildMapGrid(){
    const grid = document.getElementById('mapGrid');
    grid.innerHTML='';
    MAP_DEFS.forEach((def,i)=>{
      const card = document.createElement('div');
      card.className='mapCard'+(i>=this.unlockedMaps? ' locked':'')+(i===this.currentMapIndex?' selected':'');
      const cv = document.createElement('canvas');
      cv.width=100; cv.height=64;
      this._drawMapThumb(cv, def);
      const nm = document.createElement('div');
      nm.className='mName';
      nm.textContent = (i+1)+'. '+t(def.nameKey);
      const df = document.createElement('div');
      df.className='mDiff';
      df.textContent = i<this.unlockedMaps ? t(def.diffKey) : t('locked');
      card.appendChild(cv); card.appendChild(nm); card.appendChild(df);
      if(i<this.unlockedMaps){
        card.addEventListener('click', ()=>{
          this.currentMapIndex = i;
          this._buildMapGrid();
        });
      }
      grid.appendChild(card);
    });
  }
  _drawMapThumb(cv, def){
    const ctx = cv.getContext('2d');
    const sx = cv.width/COLS, sy = cv.height/ROWS;
    ctx.fillStyle='#0d0f0a'; ctx.fillRect(0,0,cv.width,cv.height);
    const tmpMap = new GameMap(def);
    const colorFor = {
      [TileType.BRICK]:'#8a4a2c', [TileType.STEEL]:'#7c8694', [TileType.WATER]:'#2a5fa0',
      [TileType.FOREST]:'#2e5a2e', [TileType.ICE]:'#cfe8f2', [TileType.BASE]:'#e8a33d'
    };
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const type = tmpMap.grid[r][c];
      if(type===TileType.EMPTY) continue;
      ctx.fillStyle = colorFor[type] || '#333';
      ctx.fillRect(c*sx, r*sy, sx+0.6, sy+0.6);
    }
  }

  showScreen(id){
    document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    document.getElementById('touchLayer').style.display = (id==='none')?'block':'none';
  }
  showGameUI(){
    document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
    document.getElementById('touchLayer').style.display='block';
  }

  toMainMenu(){
    this.state='menu';
    this._buildMapGrid();
    this.showScreen('screenMain');
  }

  /* ---- map lifecycle ---- */
  startMap(index){
    this.currentMapIndex = index;
    this.currentMapDef = MAP_DEFS[index];
    this.map = new GameMap(this.currentMapDef);
    this.player = new PlayerTank(PLAYER_START.col, PLAYER_START.row);
    this.enemies = [];
    this.bullets = [];
    this.explosions = [];
    this.bonuses = [];
    this.totalEnemies = 20;
    this.enemiesSpawned = 0;
    this.enemiesDestroyed = 0;
    this.spawnTimer = 0.6;
    this.freezeTime = 0;
    this.killsSinceBonus = 0;
    this.gameTime = 0;
    this.state = 'playing';
    this.showGameUI();
  }

  pause(){ if(this.state==='playing'){ this.state='paused'; this.showScreen('screenPause'); document.getElementById('touchLayer').style.display='none'; } }
  resume(){ if(this.state==='paused'){ this.state='playing'; this.showGameUI(); } }

  spawnEnemy(){
    if(this.enemiesSpawned >= this.totalEnemies) return;
    const spot = choice(ENEMY_SPAWNS);
    const box = {x:spot.col*TILE, y:spot.row*TILE, w:TILE-2, h:TILE-2};
    if(this.map.boxHitsSolid(box,false)) return;
    for(const e of this.enemies){ if(rectsOverlap(box,e.box)) return; }
    const mix = this.currentMapDef.enemyMix;
    const roll = Math.random();
    let kind = 'normal';
    if(roll < mix.heavy) kind='heavy';
    else if(roll < mix.heavy+mix.fast) kind='fast';
    const enemy = new EnemyTank(spot.col, spot.row, kind);
    enemy.speed *= this.currentMapDef.enemySpeedMul;
    this.enemies.push(enemy);
    this.enemiesSpawned++;
  }

  spawnBonus(){
    let col,row,tries=0;
    do{
      col = randInt(1,COLS-2); row = randInt(1,ROWS-3); tries++;
      var box = {x:col*TILE,y:row*TILE,w:TILE,h:TILE};
    }while(this.map.boxHitsSolid(box,false) && tries<30);
    const kind = choice(BONUS_TYPES);
    this.bonuses.push(new Bonus(col,row,kind));
  }

  applyBonus(kind){
    this.audio.bonus();
    let msgKey='';
    switch(kind){
      case 'shield': this.player.shieldTime = 8; msgKey='bonusShield'; break;
      case 'life': this.player.lives++; msgKey='bonusLife'; break;
      case 'bomb':
        this.enemies.forEach(e=>{
          if(e.alive && e.spawnTime<=0){
            e.alive=false;
            this.explosions.push(new Explosion(e.x+e.w/2,e.y+e.h/2,1.2));
            this.enemiesDestroyed++;
          }
        });
        msgKey='bonusBomb';
        break;
      case 'freeze': this.freezeTime = 6; msgKey='bonusFreeze'; break;
      case 'upgrade': this.player.upgrade(); msgKey='bonusUpgrade'; break;
    }
    this.showToast(t(msgKey));
  }

  showToast(msg){
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=> el.classList.remove('show'), 1600);
  }

  fireBullet(tank){
    if(tank.activeBullets >= tank.bulletLimit) return;
    const d = DIR[tank.dir];
    const bx = tank.x+tank.w/2 + d.x*(tank.w/2);
    const by = tank.y+tank.h/2 + d.y*(tank.h/2);
    const bullet = new Bullet(tank, bx, by, tank.dir, tank.bulletSpeed, tank.pierceSteel);
    this.bullets.push(bullet);
    this.audio.shoot();
  }

  endGame(won){
    this.state = won ? 'win' : 'gameover';
    if(won){
      this.audio.win();
      this.unlockedMaps = Math.max(this.unlockedMaps, this.currentMapIndex+2);
      this.unlockedMaps = Math.min(this.unlockedMaps, MAP_DEFS.length);
      document.getElementById('winStats').textContent = t('statsWin',{total:this.totalEnemies});
      document.getElementById('btnNextMap').style.display = (this.currentMapIndex < MAP_DEFS.length-1) ? 'block':'none';
      this.showScreen('screenWin');
    }else{
      this.audio.lose();
      document.getElementById('overStats').textContent = t('statsOver',{kills:this.enemiesDestroyed,total:this.totalEnemies});
      this.showScreen('screenOver');
    }
    document.getElementById('touchLayer').style.display='none';
  }

  /* ---- main update ---- */
  update(dt){
    this.gameTime += dt;
    const player = this.player;
    if(this.freezeTime>0) this.freezeTime -= dt;

    // player movement + shooting
    if(player.alive){
      player.update(dt, this.map, this.enemies, this.input);
      if(this.input.firing && player.activeBullets < player.bulletLimit){
        player._fireCooldown = (player._fireCooldown||0) - dt;
        if(!(player._fireCooldown>0)){
          this.fireBullet(player);
          player._fireCooldown = 0.35;
        }
      }
    }

    // enemy spawn logic
    if(this.enemiesSpawned < this.totalEnemies && this.enemies.length < 4){
      this.spawnTimer -= dt;
      if(this.spawnTimer<=0){
        this.spawnEnemy();
        this.spawnTimer = this.currentMapDef.spawnInterval/1000;
      }
    }

    // update enemies
    for(const e of this.enemies){
      if(!e.alive) continue;
      e.update(dt, this.map, [player,...this.enemies], player, this.freezeTime);
      if(e.wantsToFire() && this.freezeTime<=0){
        this.fireBullet(e);
      }
    }
    this.enemies = this.enemies.filter(e=>e.alive);

    // update bullets
    for(const b of this.bullets){
      if(!b.alive) continue;
      b.update(dt);
      if(!b.alive) continue;
      // wall collision
      const c = Math.floor(b.x/TILE), r = Math.floor(b.y/TILE);
      const tileType = this.map.tileAt(c,r);
      if(tileType===TileType.BRICK){
        this.map.destroyBrickAt(c,r);
        b.alive=false;
      }else if(tileType===TileType.STEEL){
        if(b.pierceSteel){ this.map.setTile(c,r,TileType.EMPTY); }
        b.alive=false;
      }else if(tileType===TileType.BASE){
        this.map.hitBase();
        b.alive=false;
        this.explosions.push(new Explosion(b.x,b.y,1.5));
      }
    }
    // bullet-bullet collision
    for(let i=0;i<this.bullets.length;i++){
      const b1=this.bullets[i]; if(!b1.alive) continue;
      for(let j=i+1;j<this.bullets.length;j++){
        const b2=this.bullets[j]; if(!b2.alive) continue;
        if(b1.owner.isPlayer === b2.owner.isPlayer) continue;
        if(rectsOverlap(b1.box,b2.box)){ b1.alive=false; b2.alive=false; }
      }
    }
    // bullet-tank collision
    for(const b of this.bullets){
      if(!b.alive) continue;
      if(b.owner.isPlayer){
        for(const e of this.enemies){
          if(!e.alive || e.spawnTime>0) continue;
          if(rectsOverlap(b.box, e.box)){
            b.alive=false;
            e.hp -= 1;
            this.audio.hit();
            if(e.hp<=0){
              e.alive=false;
              this.enemiesDestroyed++;
              this.explosions.push(new Explosion(e.x+e.w/2,e.y+e.h/2,1));
              this.audio.explosion();
              this.killsSinceBonus++;
              if(this.killsSinceBonus>=4 || Math.random()<0.12){
                this.killsSinceBonus=0;
                this.spawnBonus();
              }
            }
            break;
          }
        }
      }else{
        if(player.alive && rectsOverlap(b.box, player.box)){
          if(player.hitByBullet()){
            b.alive=false;
            this.explosions.push(new Explosion(player.x+player.w/2,player.y+player.h/2,1));
            this.audio.explosion();
          } else {
            b.alive=false; // absorbed by shield/invuln
          }
        }
      }
    }
    // release bullet slot references for dead bullets
    this.bullets.forEach(b=>{ if(!b.alive) b.release(); });
    this.bullets = this.bullets.filter(b=>b.alive);

    // bonuses
    for(const bn of this.bonuses){
      if(!bn.alive) continue;
      bn.update(dt);
      if(bn.alive && player.alive && rectsOverlap(bn.box, player.box)){
        bn.alive=false;
        this.applyBonus(bn.kind);
      }
    }
    this.bonuses = this.bonuses.filter(b=>b.alive);

    // explosions
    for(const ex of this.explosions){ ex.update(dt); }
    this.explosions = this.explosions.filter(e=>e.alive);

    // win/lose checks
    if(this.map.baseDestroyed){
      this.endGame(false);
      return;
    }
    if(!player.alive){
      this.endGame(false);
      return;
    }
    if(this.enemiesDestroyed >= this.totalEnemies && this.enemies.length===0){
      this.endGame(true);
      return;
    }
  }

  draw(){
    const ctx = this.ctx;
    ctx.fillStyle='#0d0f0a';
    ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
    if(this.state==='playing' || this.state==='paused'){
      this.map.draw(ctx);
      for(const bn of this.bonuses) bn.draw(ctx);
      if(this.player.alive) this.player.draw(ctx);
      for(const e of this.enemies) e.draw(ctx);
      for(const b of this.bullets) b.draw(ctx);
      this.map.drawForestOverlay(ctx);
      for(const ex of this.explosions) ex.draw(ctx);
      this.hud.draw(ctx, this);
      if(this.freezeTime>0){
        ctx.fillStyle='rgba(140,210,255,0.08)';
        ctx.fillRect(0,0,MAP_W,MAP_H);
      }
    }
  }

  loop(ts){
    if(!this.lastTime) this.lastTime = ts;
    let dt = (ts - this.lastTime)/1000;
    dt = Math.min(dt, 0.05); // clamp to avoid spikes
    this.lastTime = ts;
    if(this.state==='playing') this.update(dt);
    this.draw();
    requestAnimationFrame(this.loop.bind(this));
  }
}

/* ----------------------------------------------------------------------
   BOOTSTRAP
   ---------------------------------------------------------------------- */
window.addEventListener('load', ()=>{
  window.__game = new Game();
});

})();
</script>
</body>
</html>