<?php
header('Content-Type: text/html; charset=utf-8');
$lang = isset($_GET['lang']) ? strtolower(trim($_GET['lang'])) : 'en';
if (!in_array($lang, ['en', 'tr', 'ru'], true)) {
    $lang = 'en';
}

$titles = [
    'en' => 'Endless Adventure',
    'tr' => 'Sonsuz Macera',
    'ru' => 'Бесконечное приключение',
];
$pageTitle = $titles[$lang];
?>
<!DOCTYPE html>
<html lang="<?php echo htmlspecialchars($lang); ?>">
<head>
<meta charset="UTF-8">
<title><?php echo htmlspecialchars($pageTitle); ?></title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    width:100%; height:100%; overflow:hidden; background:#0b1330;
    touch-action:none; overscroll-behavior:none; user-select:none;
    -webkit-user-select:none; font-family:'Trebuchet MS', 'Segoe UI', Verdana, sans-serif;
  }
  #gameContainer { position:fixed; inset:0; width:100%; height:100%; overflow:hidden; }
  #gameCanvas { position:absolute; top:0; left:0; display:block; touch-action:none; }

  /* ---------- HUD ---------- */
  #hud {
    position:absolute; top:0; left:0; width:100%; padding: 10px 14px;
    display:flex; justify-content:space-between; align-items:flex-start;
    pointer-events:none; z-index:20;
  }
  .hud-pill {
    background:linear-gradient(180deg, rgba(15,20,45,0.75), rgba(15,20,45,0.55));
    border:2px solid rgba(255,255,255,0.25);
    border-radius:999px; padding:6px 16px; color:#fff; font-weight:bold;
    font-size:clamp(13px,2.6vw,18px); display:flex; align-items:center; gap:8px;
    box-shadow:0 3px 10px rgba(0,0,0,0.35);
    text-shadow:0 2px 3px rgba(0,0,0,0.5);
  }
  .hud-left { display:flex; flex-direction:column; gap:6px; }
  .hud-right { display:flex; flex-direction:column; gap:6px; align-items:flex-end; }
  #livesWrap { display:flex; gap:4px; }
  .heart { font-size:clamp(14px,3vw,20px); filter: drop-shadow(0 2px 2px rgba(0,0,0,0.5)); }

  /* ---------- Controls ---------- */
  #controls {
    position:absolute; inset:0; z-index:30; pointer-events:none;
  }
  .ctrl-btn {
    position:absolute; pointer-events:auto;
    display:flex; align-items:center; justify-content:center;
    border-radius:50%; user-select:none; -webkit-user-select:none;
    font-size:clamp(22px,6vw,34px); color:#fff;
    border:3px solid rgba(255,255,255,0.55);
    box-shadow:0 4px 12px rgba(0,0,0,0.45), inset 0 2px 6px rgba(255,255,255,0.25);
    transition:transform 0.06s ease, filter 0.06s ease;
    -webkit-user-select:none;
  }
  .ctrl-btn:active, .ctrl-btn.active {
    transform:scale(0.88); filter:brightness(1.25);
  }
  .btn-move {
    width:clamp(53px,14.2vw,76px); height:clamp(53px,14.2vw,76px);
    bottom:clamp(18px,5vh,34px);
    background:radial-gradient(circle at 35% 30%, #6ec6ff, #1976d2 70%, #0d47a1);
  }
  #btnLeft { left:clamp(14px,3vw,26px); }
  #btnRight { left:calc(clamp(14px,3vw,26px) + clamp(61px,16.1vw,86px)); }

  .btn-action {
    width:clamp(64px,17vw,92px); height:clamp(64px,17vw,92px);
    position:absolute;
  }
  #btnJump {
    right:clamp(14px,3vw,26px); bottom:clamp(18px,5vh,34px);
    background:radial-gradient(circle at 35% 30%, #ffe27a, #ffb300 70%, #e65100);
  }
  #btnFire {
    right:calc(clamp(14px,3vw,26px) + clamp(30px,8vw,44px));
    bottom:calc(clamp(18px,5vh,34px) + clamp(64px,17vw,92px) - 6px);
    width:clamp(52px,13vw,70px); height:clamp(52px,13vw,70px);
    background:radial-gradient(circle at 35% 30%, #ff9a7a, #ef4a2c 70%, #a51500);
  }
  #btnPunch {
    right:calc(clamp(14px,3vw,26px) + clamp(86px,22vw,118px));
    bottom:calc(clamp(18px,5vh,34px) + clamp(64px,17vw,92px) - 6px);
    width:clamp(52px,13vw,70px); height:clamp(52px,13vw,70px);
    background:radial-gradient(circle at 35% 30%, #64b5f6, #1565c0 70%, #0d47a1);
    font-size:clamp(18px,4vw,28px);
  }

  /* ---------- Overlays ---------- */
  .overlay {
    position:absolute; inset:0; z-index:50;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    background:radial-gradient(ellipse at center, rgba(20,25,60,0.92), rgba(6,8,25,0.97));
    color:#fff; text-align:center; padding:20px;
  }
  .hidden { display:none !important; }
  .game-title {
    font-size:clamp(28px,7vw,56px); font-weight:900; letter-spacing:1px;
    background:linear-gradient(180deg,#fff6c8,#ffd54a 40%, #ff8a00 100%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    text-shadow:0 4px 0 rgba(0,0,0,0.35);
    margin-bottom:clamp(14px,3vh,26px);
  }
  .tap-text {
    font-size:clamp(16px,3.6vw,24px); font-weight:bold; color:#fff;
    background:linear-gradient(180deg,#ff5252,#c62828);
    padding:10px 28px; border-radius:40px; margin-bottom:18px;
    box-shadow:0 5px 0 #7f0000, 0 8px 16px rgba(0,0,0,0.4);
    animation:pulse 1.1s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100%{transform:scale(1);} 50%{transform:scale(1.06);} }
  .instructions {
    font-size:clamp(12px,2.6vw,16px); max-width:640px; opacity:0.9; line-height:1.5;
  }
  .final-score { font-size:clamp(20px,4.4vw,30px); font-weight:bold; color:#ffd54a; margin:10px 0 22px; }
  .go-title { font-size:clamp(30px,7vw,54px); font-weight:900; color:#ff5252; text-shadow:0 4px 0 rgba(0,0,0,0.4); margin-bottom:10px;}
  .restart-btn {
    font-size:clamp(16px,3.6vw,22px); font-weight:bold; color:#fff; cursor:pointer;
    background:linear-gradient(180deg,#66bb6a,#2e7d32); border:none;
    padding:12px 34px; border-radius:40px; box-shadow:0 5px 0 #1b5e20, 0 8px 16px rgba(0,0,0,0.4);
    pointer-events:auto;
  }
  .restart-btn:active { transform:translateY(3px); box-shadow:0 2px 0 #1b5e20; }

  /* ---------- Milestone toast ---------- */
  .milestone-toast {
    position:absolute; top:16%; left:50%;
    transform:translate(-50%,-14px) scale(0.9);
    z-index:40; pointer-events:none; text-align:center;
    background:linear-gradient(180deg, #fff6c8, #ffd54a 55%, #ff9800 100%);
    color:#5c2e00; font-weight:900; letter-spacing:0.5px;
    padding:12px 30px; border-radius:18px;
    font-size:clamp(15px,3.8vw,24px);
    text-shadow:0 2px 0 rgba(255,255,255,0.5);
    box-shadow:0 10px 24px rgba(0,0,0,0.4), inset 0 2px 5px rgba(255,255,255,0.6), 0 0 0 3px rgba(255,255,255,0.35);
    opacity:0; transition:opacity 0.35s ease, transform 0.35s ease;
    white-space:nowrap;
  }
  .milestone-toast.show { opacity:1; transform:translate(-50%,0) scale(1); }

  /* ---------- Round complete overlay ---------- */
  .round-overlay {
    z-index:70;
    background:radial-gradient(circle, rgba(15,20,45,0.97), rgba(0,0,0,0.99));
    animation: roundOpen 0.35s ease;
  }
  .round-overlay.closing {
    animation: roundClose 0.5s ease forwards;
  }
  @keyframes roundOpen {
    from { opacity:0; }
    to { opacity:1; }
  }
  @keyframes roundClose {
    from { opacity:1; transform:scale(1); }
    to { opacity:0; transform:scale(1.2); }
  }
  .round-text {
    font-size:clamp(26px,6.5vw,52px);
    font-weight:900;
    color:#ffd54a;
    text-shadow:0 4px 0 rgba(0,0,0,0.5), 0 0 30px rgba(255,213,74,0.6);
    animation: roundTextPop 0.5s ease;
  }
  @keyframes roundTextPop {
    0% { transform:scale(0.5); opacity:0; }
    60% { transform:scale(1.15); opacity:1; }
    100% { transform:scale(1); opacity:1; }
  }
</style>
</head>
<body>
<div id="gameContainer">
  <canvas id="gameCanvas"></canvas>

  <div id="hud">
    <div class="hud-left">
      <div class="hud-pill">⭐ <span id="scoreVal">0</span></div>
      <div class="hud-pill">🪙 <span id="coinVal">0</span></div>
    </div>
    <div class="hud-right">
      <div class="hud-pill" id="muteBtn" style="pointer-events:auto; cursor:pointer;">🔊</div>
      <div class="hud-pill" id="livesWrap"></div>
    </div>
  </div>

  <div class="milestone-toast" id="milestoneToast"></div>

  <div id="controls">
    <div class="ctrl-btn btn-move" id="btnLeft">◀</div>
    <div class="ctrl-btn btn-move" id="btnRight">▶</div>
    <div class="ctrl-btn btn-action" id="btnFire">🔥</div>
    <div class="ctrl-btn btn-action" id="btnPunch">👊</div>
    <div class="ctrl-btn btn-action" id="btnJump">▲</div>
  </div>

  <div class="overlay" id="startScreen">
    <div class="game-title" id="titleText"></div>
    <div class="tap-text" id="tapText"></div>
    <div class="instructions" id="instrText"></div>
  </div>

  <div class="overlay hidden" id="gameOverScreen">
    <div class="go-title" id="goTitle"></div>
    <div class="final-score" id="finalScoreText"></div>
    <button class="restart-btn" id="restartBtn"></button>
  </div>

  <div class="overlay round-overlay hidden" id="roundOverlay">
    <div class="round-text" id="roundText"></div>
  </div>
</div>

<script>
(function(){
"use strict";

/* ============================ LOCALIZATION ============================ */
var LANG = "<?php echo $lang; ?>";
var STR = {
  en: {
    title: "Endless Adventure",
    tap: "TAP TO START",
    instr: "◀ ▶ Move &nbsp;•&nbsp; ▲ Jump (double-tap = super jump) &nbsp;•&nbsp; 🔥 Shoot (costs 1 coin) &nbsp;•&nbsp; 👊 Punch (close range) &nbsp;•&nbsp; Stomp or burn them before they reach you!",
    score: "Score", coins: "Coins",
    gameOver: "GAME OVER",
    finalScore: "Final Score: ",
    restart: "PLAY AGAIN",
    milestoneFirst: "First {n} Stars Reached!",
    milestoneNext: "{n} Stars Reached!",
    roundComplete: "Round {n} Complete!"
  },
  tr: {
    title: "Sonsuz Macera",
    tap: "BAŞLAMAK İÇİN DOKUN",
    instr: "◀ ▶ Hareket &nbsp;•&nbsp; ▲ Zıpla (çift dokunuş = süper zıplama) &nbsp;•&nbsp; 🔥 Ateş et (1 coin harcar) &nbsp;•&nbsp; 👊 Yumruk (yakın mesafe) &nbsp;•&nbsp; Sana ulaşmadan üzerlerine bas ya da ateşle!",
    score: "Skor", coins: "Altın",
    gameOver: "OYUN BİTTİ",
    finalScore: "Son Skor: ",
    restart: "TEKRAR OYNA",
    milestoneFirst: "İlk {n} Yıldıza Ulaşıldı!",
    milestoneNext: "{n} Yıldıza Ulaşıldı!",
    roundComplete: "Bölüm {n} Tamamlandı!"
  },
  ru: {
    title: "Бесконечное приключение",
    tap: "НАЖМИТЕ, ЧТОБЫ НАЧАТЬ",
    instr: "◀ ▶ Движение &nbsp;•&nbsp; ▲ Прыжок (двойное касание = супер прыжок) &nbsp;•&nbsp; 🔥 Стрелять (стоит 1 монету) &nbsp;•&nbsp; 👊 Удар (ближний бой) &nbsp;•&nbsp; Прыгайте на них или сжигайте, пока они не добрались до вас!",
    score: "Очки", coins: "Монеты",
    gameOver: "ИГРА ОКОНЧЕНА",
    finalScore: "Итоговый счёт: ",
    restart: "ИГРАТЬ СНОВА",
    milestoneFirst: "Достигнуто первых {n} звёзд!",
    milestoneNext: "Достигнуто {n} звёзд!",
    roundComplete: "Раунд {n} завершён!"
  }
};
var T = STR[LANG] || STR.en;

document.getElementById('titleText').textContent = T.title;
document.getElementById('tapText').textContent = T.tap;
document.getElementById('instrText').innerHTML = T.instr;
document.getElementById('goTitle').textContent = T.gameOver;
document.getElementById('restartBtn').textContent = T.restart;

/* ============================ CANVAS / VIEW ============================ */
var canvas = document.getElementById('gameCanvas');
var ctx = canvas.getContext('2d');
var BASE_H = 400;
var scale = 1, viewW = 800, viewH = BASE_H, dpr = 1;
var gameContainerEl = document.getElementById('gameContainer');

function applyForcedLandscape(){
  var w = window.innerWidth, h = window.innerHeight;
  if (h > w){
    gameContainerEl.style.width = h + 'px';
    gameContainerEl.style.height = w + 'px';
    gameContainerEl.style.position = 'fixed';
    gameContainerEl.style.top = '0';
    gameContainerEl.style.left = '0';
    gameContainerEl.style.transformOrigin = 'top left';
    gameContainerEl.style.transform = 'rotate(90deg) translateY(-100%)';
  } else {
    gameContainerEl.style.width = w + 'px';
    gameContainerEl.style.height = h + 'px';
    gameContainerEl.style.position = 'fixed';
    gameContainerEl.style.top = '0';
    gameContainerEl.style.left = '0';
    gameContainerEl.style.transform = 'none';
  }
}

function resize(){
  applyForcedLandscape();
  dpr = window.devicePixelRatio || 1;
  var w = gameContainerEl.clientWidth, h = gameContainerEl.clientHeight;
  canvas.style.width = w+'px';
  canvas.style.height = h+'px';
  canvas.width = Math.round(w*dpr);
  canvas.height = Math.round(h*dpr);
  scale = canvas.height / BASE_H;
  viewH = BASE_H;
  viewW = canvas.width/scale;
  ctx.setTransform(scale,0,0,scale,0,0);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', function(){ setTimeout(resize,50); });
resize();

/* ============================ AUDIO ============================ */
var actx = null;
function initAudio(){
  if (actx) return;
  try { actx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){ actx=null; }
}
function beep(freq, dur, type, gain, slideTo){
  if (!actx) return;
  try{
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type||'square';
    o.frequency.setValueAtTime(freq, actx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, actx.currentTime+dur);
    g.gain.setValueAtTime(gain||0.15, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime+dur);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime+dur);
  }catch(e){}
}
function playToneAt(freq, startTime, dur, type, peakGain){
  if (!actx) return;
  try{
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type||'square';
    o.frequency.setValueAtTime(freq, startTime);
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(peakGain||0.12, startTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime+dur*0.9);
    o.connect(g); g.connect(actx.destination);
    o.start(startTime); o.stop(startTime+dur);
  }catch(e){}
}
var SFX = {
  jump: function(){ beep(420,0.18,'square',0.12,760); },
  superJump: function(){ beep(420,0.22,'square',0.14,980); beep(700,0.16,'square',0.10,1300); },
  coin: function(){ beep(880,0.10,'square',0.10,1400); beep(1200,0.08,'square',0.07,1700); },
  fire: function(){ beep(220,0.12,'sawtooth',0.10,90); },
  enemyFire: function(){ beep(160,0.14,'sawtooth',0.09,70); },
  stomp: function(){ beep(180,0.14,'triangle',0.14,60); },
  hit: function(){ beep(140,0.28,'sawtooth',0.18,40); },
  die: function(){ beep(300,0.5,'sawtooth',0.16,40); },
  kill: function(){ beep(500,0.12,'square',0.12,900); },
  heal: function(){ beep(520,0.14,'sine',0.12,880); beep(880,0.16,'sine',0.10,1240); },
  punch: function(){ beep(150,0.1,'square',0.2,60); beep(80,0.15,'square',0.15,40); },
  noCoins: function(){ beep(200,0.08,'square',0.05,180); },
  milestone: function(){
    if (!actx) return;
    var t = actx.currentTime;
    var notes = [523.25,659.25,783.99,1046.50];
    for (var i=0;i<notes.length;i++) playToneAt(notes[i], t+i*0.16, 0.3, 'square', 0.13);
    playToneAt(1318.51, t+0.68, 0.5, 'triangle', 0.10);
  },
  powerStar: function(){
    if (!actx) return;
    var t = actx.currentTime;
    var notes = [660,880,1108,1320,1568];
    for (var i=0;i<notes.length;i++) playToneAt(notes[i], t+i*0.06, 0.22, 'square', 0.1);
  },
  roundComplete: function(){
    if (!actx) return;
    var t = actx.currentTime;
    var notes = [523.25,659.25,783.99,1046.50,1318.51,1567.98,2093.00];
    for (var i=0;i<notes.length;i++) playToneAt(notes[i], t+i*0.28, 0.5, 'square', 0.14);
    playToneAt(2093.00, t+2.0, 0.9, 'triangle', 0.12);
  }
};

/* ============================ BACKGROUND MUSIC ============================ */
var NOTE_FREQ = {
  C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196.00, A3:220.00, B3:246.94,
  C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.00, A4:440.00, B4:493.88,
  C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880.00, B5:987.77
};
var MUSIC_BASS = [
  {n:'C3',d:1},{n:0,d:1},{n:'G3',d:1},{n:0,d:1},
  {n:'A3',d:1},{n:0,d:1},{n:'F3',d:1},{n:0,d:1}
];
var MUSIC_LEAD = [
  {n:'E4',d:0.5},{n:0,d:0.5},{n:'G4',d:0.5},{n:'A4',d:0.5},
  {n:'C5',d:0.5},{n:0,d:0.5},{n:'A4',d:0.5},{n:'G4',d:0.5},
  {n:'E4',d:0.5},{n:'G4',d:0.5},{n:0,d:0.5},{n:'F4',d:0.5},
  {n:'D4',d:0.5},{n:0,d:0.5},{n:'E4',d:1},
  {n:'G4',d:0.5},{n:0,d:0.5},{n:'B4',d:0.5},{n:'C5',d:0.5},
  {n:'D5',d:0.5},{n:0,d:0.5},{n:'C5',d:0.5},{n:'B4',d:0.5},
  {n:'A4',d:0.5},{n:'C5',d:0.5},{n:0,d:0.5},{n:'G4',d:0.5},
  {n:'E4',d:0.5},{n:0,d:0.5},{n:'D4',d:1}
];
var MUSIC_LOOKAHEAD_MS = 25;
var MUSIC_SCHEDULE_AHEAD_S = 0.12;
var musicEnabled = true;
var musicState = { playing:false, tempo:148, bassIdx:0, leadIdx:0, bassNextTime:0, leadNextTime:0, gain:null };
var musicTimer = null;

function scheduleMusicNote(freq, startTime, dur, type, peakGain){
  if (!actx) return;
  try{
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, startTime);
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime+dur*0.9);
    o.connect(g); g.connect(musicState.gain);
    o.start(startTime); o.stop(startTime+dur);
  }catch(e){}
}
function musicSchedulerTick(){
  if (!musicState.playing || !actx) return;
  var secPerBeat = 60/musicState.tempo;
  while (musicState.bassNextTime < actx.currentTime + MUSIC_SCHEDULE_AHEAD_S){
    var bn = MUSIC_BASS[musicState.bassIdx % MUSIC_BASS.length];
    if (bn.n) scheduleMusicNote(NOTE_FREQ[bn.n], musicState.bassNextTime, bn.d*secPerBeat*0.95, 'triangle', 0.10);
    musicState.bassNextTime += bn.d*secPerBeat;
    musicState.bassIdx++;
  }
  while (musicState.leadNextTime < actx.currentTime + MUSIC_SCHEDULE_AHEAD_S){
    var ln = MUSIC_LEAD[musicState.leadIdx % MUSIC_LEAD.length];
    if (ln.n) scheduleMusicNote(NOTE_FREQ[ln.n], musicState.leadNextTime, ln.d*secPerBeat*0.82, 'square', 0.05);
    musicState.leadNextTime += ln.d*secPerBeat;
    musicState.leadIdx++;
  }
}
function startMusic(){
  if (!actx) return;
  if (!musicState.gain){
    musicState.gain = actx.createGain();
    musicState.gain.gain.value = musicEnabled ? 0.9 : 0;
    musicState.gain.connect(actx.destination);
  }
  if (musicState.playing) return;
  musicState.playing = true;
  musicState.bassIdx = 0; musicState.leadIdx = 0;
  musicState.bassNextTime = actx.currentTime + 0.05;
  musicState.leadNextTime = actx.currentTime + 0.05;
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = setInterval(musicSchedulerTick, MUSIC_LOOKAHEAD_MS);
}
function stopMusic(){
  musicState.playing = false;
  if (musicTimer){ clearInterval(musicTimer); musicTimer = null; }
}
function toggleMusic(){
  musicEnabled = !musicEnabled;
  if (musicState.gain) musicState.gain.gain.setTargetAtTime(musicEnabled?0.9:0, actx ? actx.currentTime : 0, 0.05);
  return musicEnabled;
}

/* ============================ INPUT ============================ */
var input = { left:false, right:false, jump:false, jumpPressed:false, fire:false, firePressed:false, punch:false, punchPressed:false, doubleJumpNext:false };
var lastJumpTapTime = -10000;
var DOUBLE_TAP_MS = 320;
function registerJumpTap(){
  var now = (window.performance && performance.now) ? performance.now() : Date.now();
  if (now - lastJumpTapTime < DOUBLE_TAP_MS){
    input.doubleJumpNext = true;
  }
  lastJumpTapTime = now;
}
function bindBtn(id, key){
  var el = document.getElementById(id);
  var down = function(e){ e.preventDefault(); input[key]=true; if(key==='jump') input.jumpPressed=true; if(key==='fire') input.firePressed=true; if(key==='punch') input.punchPressed=true; el.classList.add('active'); initAudio(); };
  var up = function(e){ e.preventDefault(); input[key]=false; el.classList.remove('active'); };
  el.addEventListener('touchstart', down, {passive:false});
  el.addEventListener('touchend', up, {passive:false});
  el.addEventListener('touchcancel', up, {passive:false});
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}
bindBtn('btnLeft','left');
bindBtn('btnRight','right');
bindBtn('btnJump','jump');
bindBtn('btnFire','fire');
bindBtn('btnPunch','punch');

(function(){
  var jbtn = document.getElementById('btnJump');
  jbtn.addEventListener('touchstart', function(){ registerJumpTap(); }, {passive:false});
  jbtn.addEventListener('mousedown', function(){ registerJumpTap(); });
})();

window.addEventListener('keydown', function(e){
  if (e.repeat) return;
  if (e.code==='ArrowLeft') input.left=true;
  if (e.code==='ArrowRight') input.right=true;
  if (e.code==='Space' || e.code==='ArrowUp'){ input.jump=true; input.jumpPressed=true; registerJumpTap(); }
  if (e.code==='KeyF' || e.code==='ControlLeft'){ input.fire=true; input.firePressed=true; }
  if (e.code==='KeyD'){ input.punch=true; input.punchPressed=true; }
});
window.addEventListener('keyup', function(e){
  if (e.code==='ArrowLeft') input.left=false;
  if (e.code==='ArrowRight') input.right=false;
  if (e.code==='Space' || e.code==='ArrowUp') input.jump=false;
  if (e.code==='KeyF' || e.code==='ControlLeft') input.fire=false;
  if (e.code==='KeyD') input.punch=false;
});

/* ============================ UTIL ============================ */
function rand(a,b){ return a + Math.random()*(b-a); }
function irand(a,b){ return Math.floor(rand(a,b+1)); }
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function aabb(ax,ay,aw,ah,bx,by,bw,bh){ return ax<bx+bw && ax+aw>bx && ay<by+bh && ay+ah>by; }

/* ============================ WORLD / TERRAIN ============================ */
var GROUND_Y = 320;
var CHUNK_W = 900;
var world = {
  segments: [],
  platforms: [],
  decor: [],
  stones: [],
  generatedUntil: 0
};

function genChunk(startX){
  var x = startX;
  var endX = startX + CHUNK_W;
  var hasPit = Math.random() < 0.32 && startX > 500;
  if (hasPit){
    var pitStart = startX + rand(250, 500);
    var pitW = rand(70, 130);
    world.segments.push({x1:startX, x2:pitStart});
    world.segments.push({x1:pitStart+pitW, x2:endX});
  } else {
    world.segments.push({x1:startX, x2:endX});
  }

  var numPlat = irand(0,2);
  for (var i=0;i<numPlat;i++){
    var pw = rand(110,220);
    var px = startX + rand(80, CHUNK_W-pw-80);
    var py = GROUND_Y - rand(70,170);
    world.platforms.push({x:px, y:py, w:pw, h:18});
  }

  var numBush = irand(2,4);
  for (var b=0;b<numBush;b++){
    world.decor.push({x:startX+rand(20,CHUNK_W-20), scale:rand(0.7,1.3), hue:irand(0,1), type:'bush'});
  }

  var numTree = irand(2,4);
  for (var tI=0;tI<numTree;tI++){
    world.decor.push({x:startX+rand(20,CHUNK_W-20), scale:rand(0.8,1.5), hue:irand(0,4), type:'tree'});
  }

  var numEn = irand(1,3);
  for (var e=0;e<numEn;e++){
    var type = irand(0,3);
    var ex = startX + rand(150, CHUNK_W-100);
    if (Math.abs(ex - playerSpawnX) < 220) continue; // keep hero's spawn point clear of enemies
    var ey;
    if (type===2){
      ey = GROUND_Y - rand(90,220);
    } else {
      ey = GROUND_Y - 20;
    }
    spawnEnemy(type, ex, ey);
  }

  if (shooterSpawned[4] < 10 && Math.random() < 0.4 && startX > 400){
    var ex4 = startX+rand(150,CHUNK_W-100);
    if (Math.abs(ex4 - playerSpawnX) >= 220){
      spawnEnemy(4, ex4, GROUND_Y-15);
      shooterSpawned[4]++;
    }
  }
  if (shooterSpawned[5] < 10 && Math.random() < 0.4 && startX > 600){
    var ex5 = startX+rand(150,CHUNK_W-100);
    if (Math.abs(ex5 - playerSpawnX) >= 220){
      spawnEnemy(5, ex5, GROUND_Y-rand(80,170));
      shooterSpawned[5]++;
    }
  }

  if (Math.random() < 0.45 && startX > 300){
    var stoneX = startX + rand(220, CHUNK_W-140);
    if (groundSolidAt(stoneX) && groundSolidAt(stoneX+40)){
      var singleH = JUMP_HEIGHT_SINGLE;
      var tier = Math.random() < 0.5 ? 'single' : 'double';
      var sh = tier==='single' ? rand(singleH*0.55, singleH*0.82) : rand(singleH*1.05, singleH*1.35);
      world.stones.push({ x: stoneX, w: rand(30,44), h: sh });
    }
  }

  var numCoinArcs = irand(1,2);
  for (var c=0;c<numCoinArcs;c++){
    var cx = startX + rand(100, CHUNK_W-100);
    var cy = GROUND_Y - rand(60,150);
    var arcLen = irand(3,6);
    for (var k=0;k<arcLen;k++){
      coins.push({x:cx+k*26, y:cy - Math.sin(k/(arcLen-1)*Math.PI)*40, taken:false, bob:Math.random()*10});
    }
  }

  world.generatedUntil = endX;
}

function groundSolidAt(x){
  for (var i=0;i<world.segments.length;i++){
    var s = world.segments[i];
    if (x>=s.x1 && x<=s.x2) return true;
  }
  return false;
}

function pruneWorld(camX){
  var cutoff = camX - 700;
  world.segments = world.segments.filter(function(s){ return s.x2 > cutoff; });
  world.platforms = world.platforms.filter(function(p){ return p.x+p.w > cutoff; });
  world.decor = world.decor.filter(function(d){ return d.x > cutoff; });
  world.stones = world.stones.filter(function(s){ return s.x+s.w > cutoff; });
  enemies = enemies.filter(function(e){ return e.x > cutoff && e.alive; });
  coins = coins.filter(function(c){ return c.x > cutoff && !c.taken; });
  projectiles = projectiles.filter(function(p){ return p.x > cutoff; });
  enemyBullets = enemyBullets.filter(function(b){ return b.x > cutoff-50; });
  hearts = hearts.filter(function(h){ return h.x > cutoff && !h.taken; });
  powerStars = powerStars.filter(function(s){ return s.x > cutoff && !s.taken; });
}

/* ============================ ENTITIES ============================ */
var enemies = [], coins = [], particles = [], projectiles = [], enemyBullets = [], hearts = [], powerStars = [];
var shooterSpawned = { 4:0, 5:0 };

var RAIN_COUNT = 70;
var rainDrops = [];
for (var rdI=0; rdI<RAIN_COUNT; rdI++){
  rainDrops.push({ xFrac: Math.random(), y: rand(-400,400), len: rand(10,22), speed: rand(260,420) });
}

var planes = [];
var planeTimer = 0;
var PLANE_INTERVAL = 15;
var PLANE_COLORS = ['#e53935','#43a047','#fdd835','#fb8c00','#1e88e5'];
var planeColorIdx = 0;

var helicopters = [];
var heliTimer = 0;
var HELI_INTERVAL = 15;
var heliKindIdx = 0;

var ENEMY_DEF = {
  0: { name:'walker',      w:34, h:31, speed:40, stompable:true,  color:'#8d5a2b' },
  1: { name:'shell',       w:34, h:29, speed:30, stompable:true,  color:'#2e7d32' },
  2: { name:'flyer',       w:36, h:29, speed:55, stompable:true,  color:'#6a1b9a' },
  3: { name:'spiky',       w:34, h:34, speed:35, stompable:false, color:'#b71c1c' },
  4: { name:'turret',      w:30, h:30, speed:22, stompable:true,  color:'#455a64', shooter:true, fireInterval:4.4, bulletSpeed:110 },
  5: { name:'skyshooter',  w:32, h:26, speed:38, stompable:true,  color:'#6d4c41', shooter:true, flyer:true, fireInterval:5.2, bulletSpeed:100 }
};

function spawnEnemy(type,x,y){
  var d = ENEMY_DEF[type];
  enemies.push({
    type:type, x:x, y:y, w:d.w, h:d.h, vx: (Math.random()<0.5?-1:1)*d.speed,
    baseY:y, t:Math.random()*10, alive:true, dying:false, dieT:0,
    fireTimer: d.shooter ? rand(0.6,2.2) : 0,
    fireCount: 0, fleeing:false, fleeVx:0, fleeVy:0
  });
}

/* ============================ PLAYER ============================ */
var player = {
  x: 80, y: GROUND_Y-34, w:26, h:32,
  vx:0, vy:0,
  onGround:false, facing:1, alive:true, invuln:0,
  animT:0, fireCooldown:0, lives:3, punchCooldown:0, isPunching:false
};
var GRAVITY = 1900, MOVE_SPEED=205, JUMP_V=610, MAX_FALL=820;
var JUMP_HEIGHT_SINGLE = (JUMP_V*JUMP_V)/(2*GRAVITY);
var JUMP_HEIGHT_DOUBLE = ((JUMP_V*Math.SQRT2)*(JUMP_V*Math.SQRT2))/(2*GRAVITY);

var camX = 0, maxCamX = 0, lastSafeX = 80, lastSafeY = GROUND_Y-34;

var score = 0, coinCount = 0, distanceScore = 0;
var nextHeartScoreThreshold = 320;
var nextCoinLifeThreshold = 100;
var nextPowerStarThreshold = 1000;
var nextMilestone = 300;
var milestoneDone = false;
var milestoneToastTimer = null;
var weatherState = 'clear';
var nextWeatherTrigger = 1000;
var rainEndScore = 0;
var rainStartScore = 0;
var RAIN_MIN_DURATION = 30; // Rain must last at least 30 seconds
var gameState = 'start';
var rainTimer = 0;
var currentRound = 1;
var nextRoundThreshold = 3000;
var roundState = { active: false };
var playerSpawnX = 0;

function resetGame(){
  world.segments = []; world.platforms = []; world.decor = []; world.stones = []; world.generatedUntil = 0;
  enemies = []; coins = []; particles = []; projectiles = []; enemyBullets = []; hearts = []; powerStars = [];
  shooterSpawned = { 4:0, 5:0 };
  planes = []; planeTimer = 0; planeColorIdx = 0;
  helicopters = []; heliTimer = 0; heliKindIdx = 0;

  var startX = viewW/2;
  playerSpawnX = startX;
  player.x=startX; player.y=GROUND_Y-34; player.vx=0; player.vy=0; player.onGround=false;
  player.facing=1; player.alive=true; player.invuln=3.0; player.lives=3; player.fireCooldown=0; player.punchCooldown=0; player.isPunching=false;
  input.doubleJumpNext = false;
  camX=0; maxCamX=0; lastSafeX=startX; lastSafeY=GROUND_Y-34;
  score=0; coinCount=0; distanceScore=0;
  nextHeartScoreThreshold = 320;
  nextCoinLifeThreshold = 100;
  nextPowerStarThreshold = 1000;
  nextMilestone = 300;
  milestoneDone = false;
  currentRound = 1;
  nextRoundThreshold = 3000;
  roundState.active = false;
  weatherState = 'clear'; nextWeatherTrigger = 1000; rainEndScore = 0; rainStartScore = 0; rainTimer = 0;
  var toastEl = document.getElementById('milestoneToast');
  if (toastEl) toastEl.classList.remove('show');
  if (milestoneToastTimer){ clearTimeout(milestoneToastTimer); milestoneToastTimer=null; }
  var roundOverlayEl = document.getElementById('roundOverlay');
  if (roundOverlayEl){ roundOverlayEl.classList.add('hidden'); roundOverlayEl.classList.remove('closing'); }
  while(world.generatedUntil < viewW*3) genChunk(world.generatedUntil);
  updateHUD();
}

function showMilestoneToast(text){
  var el = document.getElementById('milestoneToast');
  if (!el) return;
  el.textContent = '⭐ ' + text + ' ⭐';
  el.classList.add('show');
  if (milestoneToastTimer) clearTimeout(milestoneToastTimer);
  milestoneToastTimer = setTimeout(function(){ el.classList.remove('show'); }, 1000);
}

function triggerRoundComplete(){
  roundState.active = true;
  gameState = 'roundTransition';
  SFX.roundComplete();
  var txt = T.roundComplete.replace('{n}', currentRound);
  var textEl = document.getElementById('roundText');
  var overlay = document.getElementById('roundOverlay');
  if (textEl) textEl.textContent = txt;
  if (overlay){
    overlay.classList.remove('hidden');
    overlay.classList.remove('closing');
  }
  setTimeout(function(){
    if (overlay) overlay.classList.add('closing');
    setTimeout(function(){
      if (overlay){
        overlay.classList.add('hidden');
        overlay.classList.remove('closing');
      }
      currentRound++;
      nextRoundThreshold += 3000;
      roundState.active = false;
      gameState = 'playing';
    }, 500);
  }, 3000);
}

function updateHUD(){
  document.getElementById('scoreVal').textContent = Math.floor(score);
  document.getElementById('coinVal').textContent = coinCount;
  var lw = document.getElementById('livesWrap');
  lw.innerHTML='';
  for (var i=0;i<3;i++){
    var s=document.createElement('span');
    s.className='heart';
    s.textContent = i<player.lives ? '❤️' : '🖤';
    lw.appendChild(s);
  }
}

function gainLife(){
  if (player.lives < 3){
    player.lives++;
    updateHUD();
  }
}

/* ============================ PARTICLES ============================ */
function spawnBurst(x,y,color,count,spd){
  for (var i=0;i<count;i++){
    var ang = Math.random()*Math.PI*2;
    var sp = rand(spd*0.4, spd);
    particles.push({x:x,y:y,vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp - 60, life:rand(0.35,0.7), t:0, color:color, size:rand(2,5)});
  }
}
function spawnSpark(x,y){
  for (var i=0;i<6;i++){
    var ang = -Math.PI/2 + rand(-1,1);
    particles.push({x:x,y:y,vx:Math.cos(ang)*rand(20,60), vy:Math.sin(ang)*rand(20,60)-40, life:0.5, t:0, color:'#fff59d', size:rand(2,4), star:true});
  }
}

/* ============================ GAME LOGIC ============================ */
var lastTime = 0;
function damagePlayer(){
  if (player.invuln>0) return;
  player.lives--;
  player.invuln = 1.6;
  player.vy = -420; player.vx = (player.facing>=0? -1:1)*140;
  SFX.hit();
  updateHUD();
  if (player.lives<=0){
    endGame();
  }
}

function endGame(){
  gameState = 'gameover';
  stopMusic();
  SFX.die();
  document.getElementById('finalScoreText').textContent = T.finalScore + Math.floor(score);
  document.getElementById('gameOverScreen').classList.remove('hidden');
}

function update(dt){
  if (gameState !== 'playing') return;
  dt = Math.min(dt, 1/30);

  while (world.generatedUntil < camX + viewW*2.2) genChunk(world.generatedUntil);
  pruneWorld(camX);

  // Spawn heart pickups every 320 star-score points
  while (score >= nextHeartScoreThreshold){
    var heartSpawnX = Math.max(world.generatedUntil - CHUNK_W*0.5, camX + viewW + rand(80,260));
    var heartY = GROUND_Y - rand(40,90);
    hearts.push({x:heartSpawnX, y:heartY, taken:false, bob:Math.random()*10});
    nextHeartScoreThreshold += 320;
  }

  // Spawn power stars every 1000 star-score points
  while (score >= nextPowerStarThreshold){
    var pStarX = Math.max(world.generatedUntil - CHUNK_W*0.5, camX + viewW + rand(80,260));
    var pStarY = GROUND_Y - rand(50,110);
    powerStars.push({x:pStarX, y:pStarY, taken:false, bob:Math.random()*10});
    nextPowerStarThreshold += 1000;
  }

  // Milestone toast: first at 300, then every 1000
  while (score >= nextMilestone){
    if (nextMilestone === 300 && !milestoneDone) {
      var milestoneMsg = T.milestoneFirst.replace('{n}', nextMilestone);
      showMilestoneToast(milestoneMsg);
      SFX.milestone();
      milestoneDone = true;
      nextMilestone = 1000;
    } else if (nextMilestone >= 1000) {
      var milestoneMsg2 = T.milestoneNext.replace('{n}', nextMilestone);
      showMilestoneToast(milestoneMsg2);
      SFX.milestone();
      nextMilestone += 1000;
    }
  }

  // Round complete every 3000 stars: pause briefly, celebrate, then continue
  if (!roundState.active && score >= nextRoundThreshold){
    triggerRoundComplete();
    return;
  }

  // Weather cycle: changes every 1000 star-score points, but rain must last at least 30 seconds
  if (weatherState === 'clear' && score >= nextWeatherTrigger){
    weatherState = 'rain';
    rainStartScore = score;
    rainTimer = 0;
    // Rain ends after 70 score points, but we track time to ensure at least 30 seconds
    rainEndScore = nextWeatherTrigger + 70;
    nextWeatherTrigger += 1000;
  } else if (weatherState === 'rain') {
    rainTimer += dt;
    // Only clear if we've reached the end score AND at least 30 seconds have passed
    if (score >= rainEndScore && rainTimer >= RAIN_MIN_DURATION) {
      weatherState = 'clear';
    }
  }
  
  if (weatherState==='rain'){
    for (var rdU=0; rdU<rainDrops.length; rdU++){
      var rd = rainDrops[rdU];
      rd.y += rd.speed*dt;
      if (rd.y > BASE_H+20){ rd.y = -20; rd.xFrac = Math.random(); }
    }
  }

  // Planes
  planeTimer += dt;
  if (planeTimer >= PLANE_INTERVAL){
    planeTimer = 0;
    planes.push({
      x: viewW+120,
      y: rand(35,100),
      speed: rand(55,85),
      color: PLANE_COLORS[planeColorIdx % PLANE_COLORS.length]
    });
    planeColorIdx++;
  }
  for (var pi=0; pi<planes.length; pi++){
    planes[pi].x -= planes[pi].speed*dt;
  }
  planes = planes.filter(function(p){ return p.x > -160; });

  // Helicopters
  heliTimer += dt;
  if (heliTimer >= HELI_INTERVAL){
    heliTimer = 0;
    var kind = heliKindIdx % 2;
    helicopters.push({
      x: viewW+140,
      y: rand(60,140),
      speed: rand(40,60),
      kind: kind,
      rotorAngle: 0
    });
    heliKindIdx++;
  }
  for (var hi=0; hi<helicopters.length; hi++){
    helicopters[hi].x -= helicopters[hi].speed*dt;
    helicopters[hi].rotorAngle += dt*38;
  }
  helicopters = helicopters.filter(function(h){ return h.x > -180; });

  // Player movement
  var moveDir = 0;
  if (input.left) moveDir -= 1;
  if (input.right) moveDir += 1;
  player.vx = moveDir*MOVE_SPEED;
  if (moveDir !== 0) player.facing = moveDir;

  // Face nearest enemy
  var nearestEnemy = null, nearestDist = 260;
  for (var ni=0; ni<enemies.length; ni++){
    var ncand = enemies[ni];
    if (!ncand.alive || ncand.dying) continue;
    var ddist = Math.abs(ncand.x - (player.x+player.w/2));
    if (ddist < nearestDist){ nearestDist = ddist; nearestEnemy = ncand; }
  }
  if (nearestEnemy){
    player.facing = nearestEnemy.x >= (player.x+player.w/2) ? 1 : -1;
  }

  // Jump
  if (input.jumpPressed && player.onGround){
    var jumpPower = JUMP_V;
    if (input.doubleJumpNext){
      jumpPower = JUMP_V*Math.SQRT2;
      input.doubleJumpNext = false;
      SFX.superJump();
      spawnBurst(player.x+player.w/2, player.y+player.h, '#ffd54a', 12, 100);
    } else {
      SFX.jump();
    }
    player.vy = -jumpPower;
    player.onGround = false;
    spawnBurst(player.x+player.w/2, player.y+player.h, '#ffffff', 6, 60);
  }
  input.jumpPressed = false;

  // Fire (costs 1 coin)
  player.fireCooldown -= dt;
  if (input.firePressed && player.fireCooldown<=0){
    if (coinCount > 0) {
      coinCount--;
      projectiles.push({x:player.x+player.w/2+player.facing*14, y:player.y+player.h*0.42, vx:player.facing*430, life:1.1, t:0});
      player.fireCooldown = 0.35;
      SFX.fire();
      updateHUD();
    } else {
      SFX.noCoins();
    }
  }
  input.firePressed = false;

  // Punch (close range melee attack)
  player.punchCooldown -= dt;
  if (input.punchPressed && player.punchCooldown<=0){
    player.punchCooldown = 0.3;
    player.isPunching = true;
    SFX.punch();
    // Check for enemies in close range
    var punchRange = 50;
    var punchX = player.x + player.w/2 + player.facing * 20;
    var punchY = player.y + player.h/2;
    for (var ei=0; ei<enemies.length; ei++){
      var en = enemies[ei];
      if (!en.alive || en.dying) continue;
      var dist = Math.sqrt(Math.pow(en.x - punchX, 2) + Math.pow((en.y - en.h/2) - punchY, 2));
      if (dist < punchRange) {
        killEnemy(en, false);
        spawnBurst(en.x, en.y-en.h/2, '#64b5f6', 15, 160);
        break;
      }
    }
    spawnBurst(punchX, punchY, '#64b5f6', 8, 80);
    // Reset punching flag after a short delay
    setTimeout(function(){ player.isPunching = false; }, 150);
  }
  input.punchPressed = false;

  // Physics
  player.vy += GRAVITY*dt;
  if (player.vy > MAX_FALL) player.vy = MAX_FALL;

  var nx = player.x + player.vx*dt;
  var ny = player.y + player.vy*dt;

  player.x = nx;
  var leftWall = camX + 6;
  if (player.x < leftWall) player.x = leftWall;

  // Stone obstacles
  for (var si=0; si<world.stones.length; si++){
    var stH = world.stones[si];
    var stoneTopH = GROUND_Y - stH.h;
    var overlapsXH = (player.x + player.w > stH.x) && (player.x < stH.x + stH.w);
    if (overlapsXH && (player.y + player.h) > stoneTopH + 6){
      if (player.vx > 0) player.x = stH.x - player.w;
      else if (player.vx < 0) player.x = stH.x + stH.w;
    }
  }

  var wasBelow = player.y + player.h;
  player.onGround = false;

  // Check ground
  var onGroundSpan = groundSolidAt(player.x + player.w/2);
  if (onGroundSpan && ny + player.h >= GROUND_Y && wasBelow <= GROUND_Y+2){
    ny = GROUND_Y - player.h;
    player.vy = 0;
    player.onGround = true;
    lastSafeX = player.x; lastSafeY = ny;
  } else if (onGroundSpan && ny + player.h > GROUND_Y && player.vy>=0 && wasBelow<=GROUND_Y+40){
    ny = GROUND_Y - player.h;
    player.vy = 0;
    player.onGround = true;
    lastSafeX = player.x; lastSafeY = ny;
  }

  // Platforms
  for (var i=0;i<world.platforms.length;i++){
    var p = world.platforms[i];
    if (player.x + player.w > p.x && player.x < p.x+p.w){
      if (player.vy >= 0 && wasBelow <= p.y+2+ (player.vy*dt<0?0:player.vy*dt+2) && ny+player.h >= p.y && ny+player.h <= p.y + 20){
        ny = p.y - player.h;
        player.vy = 0;
        player.onGround = true;
        lastSafeX = player.x; lastSafeY = ny;
      }
    }
  }

  // Land on stones
  for (var sj=0; sj<world.stones.length; sj++){
    var stV = world.stones[sj];
    var stoneTopV = GROUND_Y - stV.h;
    if (player.x + player.w > stV.x && player.x < stV.x + stV.w){
      if (player.vy >= 0 && wasBelow <= stoneTopV+2+(player.vy*dt<0?0:player.vy*dt+2) && ny+player.h >= stoneTopV && ny+player.h <= stoneTopV+20){
        ny = stoneTopV - player.h;
        player.vy = 0;
        player.onGround = true;
        lastSafeX = player.x; lastSafeY = ny;
      }
    }
  }

  player.y = ny;

  if (player.y > GROUND_Y + 140){
    if (player.alive){
      damagePlayer();
      if (gameState==='playing'){
        player.x = lastSafeX; player.y = lastSafeY-2; player.vy=0; player.vx=0;
        camX = Math.max(0, player.x - viewW*0.35);
      }
    }
  }

  if (player.invuln>0) player.invuln -= dt;

  // Camera
  var targetCam = player.x - viewW*0.35;
  camX = Math.max(camX, targetCam);
  camX = Math.max(0, camX);
  maxCamX = Math.max(maxCamX, camX);

  distanceScore = maxCamX/8;

  // Enemies update
  var FLEE_ACCEL_X = 260, FLEE_ACCEL_Y = 190;
  for (i=0;i<enemies.length;i++){
    var en = enemies[i];
    if (!en.alive) continue;
    en.t += dt;
    if (en.dying){
      en.dieT += dt;
      if (en.dieT>0.3) en.alive=false;
      continue;
    }
    var d = ENEMY_DEF[en.type];

    if (en.fleeing){
      en.fleeVx -= FLEE_ACCEL_X*dt;
      en.fleeVy -= FLEE_ACCEL_Y*dt;
      en.x += en.fleeVx*dt;
      en.y += en.fleeVy*dt;
      if (en.y < -260 || en.x < camX-420){ en.alive = false; }
      continue;
    }

    if (en.type===2 || en.type===5){
      en.x += en.vx*dt;
      en.y = en.baseY + Math.sin(en.t*2.4)*22;
    } else {
      en.x += en.vx*dt;
      if (!groundSolidAt(en.x) ) en.vx *= -1;
      if (Math.random()<0.002) en.vx *= -1;
    }

    if (d.shooter){
      en.fireTimer -= dt;
      var distToPlayer = Math.abs(en.x - (player.x+player.w/2));
      if (en.fireTimer<=0 && distToPlayer < 520){
        var dxp = (player.x+player.w/2) - en.x;
        var dyp = (player.y+player.h/2) - (en.y-en.h/2);
        var dlen = Math.max(1, Math.sqrt(dxp*dxp+dyp*dyp));
        enemyBullets.push({
          x: en.x, y: en.y-en.h/2,
          vx: dxp/dlen*d.bulletSpeed, vy: dyp/dlen*d.bulletSpeed,
          life: 4, t:0
        });
        en.fireCount++;
        en.fireTimer = d.fireInterval + rand(-0.3,0.3);
        SFX.enemyFire();
        if (en.fireCount>=2){
          en.fleeing = true;
          en.fleeVx = -70; en.fleeVy = -55;
        }
      }
    }

    if (aabb(player.x,player.y,player.w,player.h, en.x-en.w/2,en.y-en.h,en.w,en.h)){
      var stompFromAbove = player.vy > 40 && (player.y+player.h) - (en.y-en.h) < 18;
      if (d.stompable && stompFromAbove){
        killEnemy(en, true);
        player.vy = -JUMP_V*0.62;
      } else {
        damagePlayer();
      }
    }
  }

  // Enemy bullets
  for (i=0;i<enemyBullets.length;i++){
    var eb = enemyBullets[i];
    eb.x += eb.vx*dt; eb.y += eb.vy*dt; eb.t += dt;
    if (eb.t > eb.life){ eb.dead = true; continue; }
    if (aabb(player.x,player.y,player.w,player.h, eb.x-6,eb.y-6,12,12)){
      eb.dead = true;
      damagePlayer();
    }
  }
  enemyBullets = enemyBullets.filter(function(b){ return !b.dead; });

  // Player projectiles (bullets)
  for (i=0;i<projectiles.length;i++){
    var pr = projectiles[i];
    pr.x += pr.vx*dt; pr.t += dt;
    if (pr.t > pr.life) { pr.dead=true; continue; }
    for (var j=0;j<enemies.length;j++){
      var en2 = enemies[j];
      if (!en2.alive || en2.dying) continue;
      if (Math.abs(pr.x-en2.x) < en2.w/2+6 && Math.abs(pr.y-(en2.y-en2.h/2)) < en2.h/2+6){
        killEnemy(en2, false);
        pr.dead = true;
      }
    }
  }
  projectiles = projectiles.filter(function(p){ return !p.dead; });

  // Coins
  for (i=0;i<coins.length;i++){
    var c = coins[i];
    if (c.taken) continue;
    c.bob += dt*4;
    if (aabb(player.x,player.y,player.w,player.h, c.x-8,c.y-8,16,16)){
      c.taken = true; coinCount++; score += 10;
      spawnSpark(c.x,c.y);
      SFX.coin();
      if (coinCount >= nextCoinLifeThreshold){
        gainLife();
        nextCoinLifeThreshold += 100;
      }
      updateHUD();
    }
  }

  // Hearts
  for (i=0;i<hearts.length;i++){
    var ht = hearts[i];
    if (ht.taken) continue;
    ht.bob += dt*4;
    if (aabb(player.x,player.y,player.w,player.h, ht.x-9,ht.y-9,18,18)){
      ht.taken = true;
      gainLife();
      spawnBurst(ht.x,ht.y,'#ff5252',12,110);
      SFX.heal();
    }
  }

  // Power stars
  for (i=0;i<powerStars.length;i++){
    var pst = powerStars[i];
    if (pst.taken) continue;
    pst.bob += dt*4;
    if (aabb(player.x,player.y,player.w,player.h, pst.x-18,pst.y-18,36,36)){
      pst.taken = true;
      player.invuln = Math.max(player.invuln, 10);
      spawnBurst(pst.x,pst.y,'#ffd54a',18,150);
      SFX.powerStar();
    }
  }

  // Particles
  for (i=0;i<particles.length;i++){
    var pt = particles[i];
    pt.t += dt;
    pt.x += pt.vx*dt; pt.y += pt.vy*dt; pt.vy += 500*dt;
  }
  particles = particles.filter(function(p){ return p.t < p.life; });

  score = Math.floor(distanceScore + coinCount*10);
  updateHUD();
}

function killEnemy(en, stomped){
  en.dying = true; en.dieT = 0;
  score += 20;
  spawnBurst(en.x, en.y-en.h/2, ENEMY_DEF[en.type].color, 10, 140);
  if (stomped) SFX.stomp(); else SFX.kill();
}

/* ============================ RENDER ============================ */
function drawBackground(){
  var raining = weatherState==='rain';

  var g = ctx.createLinearGradient(0,0,0,viewH);
  if (raining){
    g.addColorStop(0, '#4a5568');
    g.addColorStop(0.55, '#7c8a99');
    g.addColorStop(1, '#a9b6c0');
  } else {
    g.addColorStop(0, '#3a8dde');
    g.addColorStop(0.55, '#7ec8f2');
    g.addColorStop(1, '#cdeafd');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0,0,viewW,viewH);

  if (!raining){
    ctx.save();
    var sunX = viewW-70, sunY = 60;
    var sg = ctx.createRadialGradient(sunX,sunY,4,sunX,sunY,50);
    sg.addColorStop(0,'#fff9c4'); sg.addColorStop(1,'rgba(255,249,196,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sunX,sunY,50,0,7); ctx.fill();
    ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.arc(sunX,sunY,22,0,7); ctx.fill();
    ctx.restore();
  }

  var mOff = -(camX*0.15) % 400;
  ctx.fillStyle = raining ? '#6b7c8f' : '#8fb0d9';
  for (var i=-1;i<4;i++){
    var bx = mOff + i*400;
    ctx.beginPath();
    ctx.moveTo(bx,260); ctx.lineTo(bx+120,150); ctx.lineTo(bx+240,260); ctx.closePath(); ctx.fill();
  }
  var cloudColor = raining ? '#78828c' : '#ffffff';
  var cloudAlpha = raining ? 0.95 : 0.9;
  var cOff = -(camX*0.3) % 320;
  for (i=-1;i<6;i++){
    drawCloud(cOff + i*320 + 40, 45 + (i%2)*28, 0.85, cloudColor, cloudAlpha);
    drawCloud(cOff + i*320 + 190, 85 + (i%3)*22, 0.6, cloudColor, cloudAlpha);
  }
  var cOff2 = -(camX*0.42) % 420;
  for (i=-1;i<5;i++){
    drawCloud(cOff2 + i*420 + 130, 30 + (i%3)*18, 1.1, cloudColor, cloudAlpha);
  }
  if (raining){
    var cOff3 = -(camX*0.36) % 260;
    for (i=-1;i<7;i++){
      drawCloud(cOff3 + i*260 + 80, 20 + (i%3)*24, 1.3, '#5c6773', 0.85);
    }
  }
  drawPlanes();
  drawHelicopters();
  var hOff = -(camX*0.5) % 600;
  ctx.fillStyle = raining ? '#4f8a58' : '#6fbf73';
  for (i=-1;i<3;i++){
    var hx = hOff + i*600;
    ctx.beginPath();
    ctx.ellipse(hx+100, GROUND_Y+40, 180, 70, 0, Math.PI, 0, true);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hx+380, GROUND_Y+55, 150, 60, 0, Math.PI, 0, true);
    ctx.fill();
  }
}
function drawCloud(x,y,s,color,alpha){
  ctx.save();
  ctx.globalAlpha = alpha===undefined ? 0.9 : alpha;
  ctx.fillStyle = color || '#ffffff';
  ctx.beginPath();
  ctx.ellipse(x,y,26*s,15*s,0,0,7);
  ctx.ellipse(x+22*s,y-8*s,20*s,14*s,0,0,7);
  ctx.ellipse(x+42*s,y,24*s,15*s,0,0,7);
  ctx.fill();
  ctx.restore();
}
function drawRain(){
  if (weatherState!=='rain') return;
  ctx.save();
  ctx.fillStyle = 'rgba(60,70,90,0.08)';
  ctx.fillRect(0,0,viewW,viewH);
  ctx.strokeStyle = 'rgba(210,230,255,0.55)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (var i=0;i<rainDrops.length;i++){
    var rd = rainDrops[i];
    var x = rd.xFrac*viewW;
    ctx.beginPath();
    ctx.moveTo(x, rd.y);
    ctx.lineTo(x-4, rd.y+rd.len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlane(p){
  var x = p.x, y = p.y;
  ctx.save();
  ctx.translate(x,y);
  var trail = ctx.createLinearGradient(0,0,90,0);
  trail.addColorStop(0,'rgba(255,255,255,0.55)');
  trail.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = trail;
  ctx.fillRect(6,-2,90,4);

  ctx.scale(-1,1);
  var fg = ctx.createLinearGradient(0,-6,0,6);
  fg.addColorStop(0,'#f5f5f5'); fg.addColorStop(1,'#c9c9c9');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.ellipse(0,0,26,6,0,0,7);
  ctx.fill();
  ctx.fillStyle = '#e0e0e0';
  ctx.beginPath();
  ctx.moveTo(24,0); ctx.lineTo(31,0); ctx.lineTo(24,-3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#37474f';
  ctx.beginPath(); ctx.ellipse(16,-1.5,4,2.4,0,0,7); ctx.fill();
  ctx.fillStyle = 'rgba(55,71,79,0.55)';
  for (var wI=-14; wI<10; wI+=6){
    ctx.beginPath(); ctx.ellipse(wI,-1,1.6,1.6,0,0,7); ctx.fill();
  }
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.moveTo(-22,-1); ctx.lineTo(-30,-16); ctx.lineTo(-16,-2); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-22,0); ctx.lineTo(-32,5); ctx.lineTo(-18,2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#dcdcdc';
  ctx.beginPath();
  ctx.moveTo(0,2); ctx.lineTo(-6,22); ctx.lineTo(6,4); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0,-2); ctx.lineTo(-6,-22); ctx.lineTo(6,-4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#616161';
  ctx.beginPath(); ctx.ellipse(-2,12,6,3,0,0,7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-2,-12,6,3,0,0,7); ctx.fill();
  ctx.fillStyle = p.color;
  ctx.fillRect(-20,-1.5,40,3);

  ctx.restore();
}
function drawPlanes(){
  for (var i=0;i<planes.length;i++) drawPlane(planes[i]);
}

function drawHelicopter(h){
  var x = h.x, y = h.y;
  var isHospital = h.kind===1;
  var body   = isHospital ? '#f5f5f5' : '#ffca28';
  var bodyDk = isHospital ? '#cfd8dc' : '#f57f17';
  var trim   = isHospital ? '#e53935' : '#3949ab';
  ctx.save();
  ctx.translate(x,y);
  var trail = ctx.createLinearGradient(0,0,60,0);
  trail.addColorStop(0,'rgba(255,255,255,0.35)');
  trail.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = trail;
  ctx.fillRect(4,-1,60,3);

  ctx.scale(-1,1);

  var tailG = ctx.createLinearGradient(0,-3,0,3);
  tailG.addColorStop(0,body); tailG.addColorStop(1,bodyDk);
  ctx.fillStyle = tailG;
  ctx.beginPath();
  ctx.moveTo(-8,-3); ctx.lineTo(-30,-1); ctx.lineTo(-30,2); ctx.lineTo(-8,4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = trim;
  ctx.beginPath(); ctx.moveTo(-27,-1); ctx.lineTo(-33,-9); ctx.lineTo(-24,-1.5); ctx.closePath(); ctx.fill();
  ctx.save();
  ctx.translate(-30,0.5); ctx.rotate(h.rotorAngle*2.2);
  ctx.strokeStyle='rgba(60,60,60,0.55)'; ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.moveTo(-6,0); ctx.lineTo(6,0); ctx.stroke();
  ctx.restore();

  var cabinG = ctx.createLinearGradient(0,-8,0,8);
  cabinG.addColorStop(0,body); cabinG.addColorStop(1,bodyDk);
  ctx.fillStyle = cabinG;
  ctx.beginPath();
  ctx.ellipse(2,0,17,8,0,0,7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth=1;
  ctx.stroke();
  ctx.fillStyle = '#37474f';
  ctx.beginPath(); ctx.ellipse(11,-1,6.5,5,0,0,7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.ellipse(12,-2.5,3,1.8,0,0,7); ctx.fill();
  ctx.fillStyle = trim;
  ctx.fillRect(-8,-2,20,4);
  if (isHospital){
    ctx.fillStyle = '#e53935';
    ctx.fillRect(-3,-6,3,8);
    ctx.fillRect(-6,-3.5,9,3);
  } else {
    ctx.fillStyle = 'rgba(55,71,79,0.5)';
    for (var cw=-6; cw<8; cw+=5){
      ctx.beginPath(); ctx.ellipse(cw,-0.5,1.6,1.6,0,0,7); ctx.fill();
    }
  }
  ctx.strokeStyle = '#455a64'; ctx.lineWidth=1.6;
  ctx.beginPath(); ctx.moveTo(-6,8); ctx.lineTo(14,8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4,5); ctx.lineTo(-4,8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(10,5); ctx.lineTo(10,8); ctx.stroke();

  ctx.fillStyle = '#37474f';
  ctx.fillRect(0,-9,2,3);
  ctx.save();
  ctx.translate(1,-10); ctx.rotate(h.rotorAngle);
  ctx.strokeStyle='rgba(50,50,50,0.6)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(-24,0); ctx.lineTo(24,0); ctx.stroke();
  ctx.strokeStyle='rgba(50,50,50,0.3)'; ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.moveTo(0,-24); ctx.lineTo(0,24); ctx.stroke();
  ctx.fillStyle='rgba(60,60,60,0.18)';
  ctx.beginPath(); ctx.arc(0,0,24,0,7); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#263238';
  ctx.beginPath(); ctx.arc(1,-10,1.6,0,7); ctx.fill();

  ctx.restore();
}
function drawHelicopters(){
  for (var i=0;i<helicopters.length;i++) drawHelicopter(helicopters[i]);
}

function drawGround(){
  for (var i=0;i<world.segments.length;i++){
    var s = world.segments[i];
    var x1 = s.x1 - camX, x2 = s.x2 - camX;
    if (x2 < -20 || x1 > viewW+20) continue;
    var w = x2-x1;
    var grd = ctx.createLinearGradient(0,GROUND_Y,0,GROUND_Y+80);
    grd.addColorStop(0,'#8d5a2b'); grd.addColorStop(1,'#5d3a1a');
    ctx.fillStyle = grd;
    ctx.fillRect(x1, GROUND_Y+8, w, 200);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(x1, GROUND_Y, w, 10);
    ctx.fillStyle = '#66bb6a';
    for (var gx=x1+6; gx<x2-6; gx+=18){
      ctx.beginPath();
      ctx.moveTo(gx,GROUND_Y); ctx.lineTo(gx+5,GROUND_Y-8); ctx.lineTo(gx+10,GROUND_Y); ctx.closePath(); ctx.fill();
    }
  }
  for (i=0;i<world.decor.length;i++){
    var d = world.decor[i];
    var dx = d.x - camX;
    if (dx< -60 || dx>viewW+60) continue;
    var s2 = d.scale;
    if (d.type==='tree'){
      var trunkH = 46*s2, trunkW = 8*s2;
      var tg = ctx.createLinearGradient(dx-trunkW/2, GROUND_Y-trunkH, dx+trunkW/2, GROUND_Y);
      tg.addColorStop(0,'#8d6e4a'); tg.addColorStop(1,'#5d4126');
      ctx.fillStyle = tg;
      ctx.fillRect(dx-trunkW/2, GROUND_Y-trunkH, trunkW, trunkH);
      var TREE_PALETTES = [
        ['#2e7d32','#388e3c','#66bb6a'],
        ['#33691e','#558b2f','#8bc34a'],
        ['#1b5e20','#2e7d32','#4caf50'],
        ['#e65100','#fb8c00','#ffb74d'],
        ['#b71c1c','#d32f2f','#ef5350']
      ];
      var fg = TREE_PALETTES[d.hue % TREE_PALETTES.length];
      ctx.fillStyle = fg[0];
      ctx.beginPath(); ctx.ellipse(dx, GROUND_Y-trunkH-6*s2, 30*s2, 24*s2, 0,0,7); ctx.fill();
      ctx.fillStyle = fg[1];
      ctx.beginPath(); ctx.ellipse(dx-18*s2, GROUND_Y-trunkH+2*s2, 20*s2, 17*s2, 0,0,7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(dx+18*s2, GROUND_Y-trunkH+2*s2, 20*s2, 17*s2, 0,0,7); ctx.fill();
      ctx.fillStyle = fg[2];
      ctx.beginPath(); ctx.ellipse(dx-6*s2, GROUND_Y-trunkH-16*s2, 14*s2, 11*s2, 0,0,7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(dx+10*s2, GROUND_Y-trunkH-14*s2, 12*s2, 10*s2, 0,0,7); ctx.fill();
    } else {
      ctx.fillStyle = d.hue===0 ? '#388e3c' : '#43a047';
      ctx.beginPath();
      ctx.ellipse(dx, GROUND_Y-6*s2, 22*s2,14*s2,0,0,7);
      ctx.ellipse(dx-16*s2, GROUND_Y-2*s2, 16*s2,11*s2,0,0,7);
      ctx.ellipse(dx+16*s2, GROUND_Y-2*s2, 16*s2,11*s2,0,0,7);
      ctx.fill();
    }
  }
  for (i=0;i<world.platforms.length;i++){
    var p = world.platforms[i];
    var px = p.x - camX;
    if (px+p.w < -20 || px>viewW+20) continue;
    var pg = ctx.createLinearGradient(0,p.y,0,p.y+p.h);
    pg.addColorStop(0,'#ffb74d'); pg.addColorStop(1,'#e65100');
    ctx.fillStyle = pg;
    roundRect(px,p.y,p.w,p.h,6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(px+3,p.y+3,p.w-6,3);
  }
}
function drawStones(){
  for (var i=0;i<world.stones.length;i++){
    var s = world.stones[i];
    var sx = s.x - camX;
    if (sx+s.w < -20 || sx > viewW+20) continue;
    var topY = GROUND_Y - s.h;
    var grd = ctx.createLinearGradient(0, topY, 0, GROUND_Y);
    grd.addColorStop(0, '#9e9e9e');
    grd.addColorStop(1, '#5b5b5b');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(sx, GROUND_Y);
    ctx.lineTo(sx+2, topY+6);
    ctx.lineTo(sx+s.w*0.35, topY);
    ctx.lineTo(sx+s.w*0.7, topY+4);
    ctx.lineTo(sx+s.w-2, topY+10);
    ctx.lineTo(sx+s.w, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx+s.w*0.3, topY+10); ctx.lineTo(sx+s.w*0.45, topY+s.h*0.5);
    ctx.moveTo(sx+s.w*0.6, topY+8); ctx.lineTo(sx+s.w*0.5, topY+s.h*0.4);
    ctx.stroke();
  }
}
function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function radialShade(cx,cy,r,light,mid,dark){
  var g = ctx.createRadialGradient(cx-r*0.35, cy-r*0.4, Math.max(1,r*0.12), cx, cy, r);
  g.addColorStop(0,light); g.addColorStop(0.55,mid); g.addColorStop(1,dark);
  return g;
}
function linearShade(x0,y0,x1,y1,light,mid,dark){
  var g = ctx.createLinearGradient(x0,y0,x1,y1);
  g.addColorStop(0,light); g.addColorStop(0.55,mid); g.addColorStop(1,dark);
  return g;
}
function shadedEllipse(cx,cy,rx,ry,rot,light,mid,dark,stroke){
  ctx.fillStyle = radialShade(cx,cy,Math.max(rx,ry),light,mid,dark);
  ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,rot,0,7); ctx.fill();
  if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = 1.1; ctx.stroke(); }
}
function aoSmudge(cx,cy,rx,ry,rot,alpha){
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,'+(alpha||0.18)+')';
  ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,rot||0,0,7); ctx.fill();
  ctx.restore();
}
function specDot(cx,cy,r,alpha){
  ctx.fillStyle = 'rgba(255,255,255,'+(alpha||0.85)+')';
  ctx.beginPath(); ctx.arc(cx,cy,r,0,7); ctx.fill();
}

function drawCoins(){
  for (var i=0;i<coins.length;i++){
    var c = coins[i];
    if (c.taken) continue;
    var cx = c.x-camX, cy = c.y + Math.sin(c.bob)*3;
    if (cx<-20||cx>viewW+20) continue;
    var sx = Math.abs(Math.cos(c.bob*0.7))*8+4;
    ctx.save();
    ctx.translate(cx,cy);
    var cg = ctx.createRadialGradient(-2,-2,1,0,0,9);
    cg.addColorStop(0,'#fff9c4'); cg.addColorStop(0.6,'#ffd600'); cg.addColorStop(1,'#f57f17');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.ellipse(0,0,sx,9,0,0,7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.ellipse(0,0,sx*0.55,5,0,0,7); ctx.stroke();
    ctx.restore();
  }
}

function drawHearts(){
  for (var i=0;i<hearts.length;i++){
    var h = hearts[i];
    if (h.taken) continue;
    var hx = h.x-camX, hy = h.y + Math.sin(h.bob)*3;
    if (hx<-20||hx>viewW+20) continue;
    ctx.save();
    ctx.translate(hx,hy);
    var glow = ctx.createRadialGradient(0,0,2,0,0,16);
    glow.addColorStop(0,'rgba(255,120,120,0.55)'); glow.addColorStop(1,'rgba(255,120,120,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0,0,16,0,7); ctx.fill();
    ctx.scale(0.9,0.9);
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.moveTo(0,7);
    ctx.bezierCurveTo(-12,-2,-10,-13,0,-6);
    ctx.bezierCurveTo(10,-13,12,-2,0,7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(-4,-6,2.6,3.6,-0.5,0,7);
    ctx.fill();
    ctx.restore();
  }
}

function drawPowerStars(){
  for (var i=0;i<powerStars.length;i++){
    var s = powerStars[i];
    if (s.taken) continue;
    var sx = s.x-camX, sy = s.y + Math.sin(s.bob)*4;
    if (sx<-40||sx>viewW+40) continue;
    ctx.save();
    ctx.translate(sx,sy);
    var pulse = 1 + Math.sin(s.bob*1.6)*0.08;
    var glow = ctx.createRadialGradient(0,0,3,0,0,32*pulse);
    glow.addColorStop(0,'rgba(255,220,110,0.65)'); glow.addColorStop(1,'rgba(255,220,110,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0,0,32*pulse,0,7); ctx.fill();
    ctx.rotate(Math.sin(s.bob*0.5)*0.25);
    ctx.fillStyle = radialShade(-4,-6,24,'#fff9c4','#ffd600','#e65100');
    ctx.strokeStyle = 'rgba(140,70,0,0.5)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (var p=0; p<5; p++){
      var outerA = -Math.PI/2 + p/5*Math.PI*2;
      var innerA = outerA + Math.PI/5;
      var ox = Math.cos(outerA)*24, oy = Math.sin(outerA)*24;
      var ix = Math.cos(innerA)*10.5, iy = Math.sin(innerA)*10.5;
      if (p===0) ctx.moveTo(ox,oy); else ctx.lineTo(ox,oy);
      ctx.lineTo(ix,iy);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle='#8a4a00';
    ctx.beginPath(); ctx.arc(-6,-2,1.8,0,7); ctx.fill();
    ctx.beginPath(); ctx.arc(6,-2,1.8,0,7); ctx.fill();
    ctx.strokeStyle='#8a4a00'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.arc(0,2,4,0.15*Math.PI,0.85*Math.PI); ctx.stroke();
    specDot(-9,-11,3,0.7);
    ctx.restore();
  }
}

function drawEnemy(en){
  var ex = en.x-camX, ey = en.y;
  if (ex<-40||ex>viewW+40) return;
  var d = ENEMY_DEF[en.type];
  var squish = en.dying ? Math.max(0, 1-en.dieT/0.3) : 1;
  ctx.save();
  ctx.translate(ex,ey);
  if (en.fleeing){
    ctx.rotate(-0.5);
    ctx.scale(-1, squish);
  } else {
    ctx.scale(en.vx<0?-1:1, squish);
  }

  var w = en.w, h = en.h;

  if (en.type===0){
    var wob = Math.sin(en.t*10)*2.4;
    shadedEllipse(-w*0.26+wob*0.15,-h*0.1, w*0.17,h*0.15,0, '#8a5a34','#6b4423','#3d2410');
    shadedEllipse(w*0.26-wob*0.15,-h*0.1, w*0.17,h*0.15,0, '#8a5a34','#6b4423','#3d2410');
    aoSmudge(0,-h*0.14,w*0.42,h*0.08,0,0.16);
    shadedEllipse(0,-h*0.54, w*0.52,h*0.48,0, '#c98f5e','#8d5a2b','#4a2e13','rgba(0,0,0,0.28)');
    shadedEllipse(0,-h*0.42, w*0.27,h*0.24,0, '#f5e2c0','#e3c69a','#c9a06a');
    shadedEllipse(-w*0.32,-h*0.92,w*0.15,w*0.15,0,'#c98f5e','#8d5a2b','#4a2e13');
    shadedEllipse(w*0.32,-h*0.92,w*0.15,w*0.15,0,'#c98f5e','#8d5a2b','#4a2e13');
    shadedEllipse(-w*0.32,-h*0.9,w*0.07,w*0.07,0,'#f0c8a0','#dba876','#b5804e');
    shadedEllipse(w*0.32,-h*0.9,w*0.07,w*0.07,0,'#f0c8a0','#dba876','#b5804e');
    shadedEllipse(w*0.24,-h*0.44,w*0.24,h*0.17,0,'#f5e2c0','#e3c69a','#c9a06a');
    ctx.fillStyle = '#2b1a10';
    ctx.beginPath(); ctx.ellipse(w*0.38,-h*0.46,w*0.08,h*0.055,0,0,7); ctx.fill();
    specDot(w*0.36,-h*0.475,w*0.02,0.7);
    shadedEllipse(-w*0.1,-h*0.72,w*0.09,h*0.11,0,'#fff','#fff','#ddd');
    shadedEllipse(w*0.16,-h*0.72,w*0.09,h*0.11,0,'#fff','#fff','#ddd');
    ctx.fillStyle='#231205';
    ctx.beginPath(); ctx.arc(-w*0.07,-h*0.7,w*0.05,0,7); ctx.fill();
    ctx.beginPath(); ctx.arc(w*0.19,-h*0.7,w*0.05,0,7); ctx.fill();
    specDot(-w*0.05,-h*0.73,w*0.018,0.9);
    specDot(w*0.21,-h*0.73,w*0.018,0.9);
    ctx.strokeStyle='#3e2313'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(-w*0.32,-h*0.98); ctx.lineTo(-w*0.02,-h*0.85); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w*0.34,-h*0.98); ctx.lineTo(w*0.1,-h*0.85); ctx.stroke();

  } else if (en.type===1){
    shadedEllipse(-w*0.34,-h*0.08,w*0.13,h*0.11,0,'#8bc34a','#558b2f','#2e5115');
    shadedEllipse(w*0.34,-h*0.08,w*0.13,h*0.11,0,'#8bc34a','#558b2f','#2e5115');
    shadedEllipse(-w*0.22,-h*0.05,w*0.1,h*0.08,0,'#8bc34a','#558b2f','#2e5115');
    shadedEllipse(w*0.22,-h*0.05,w*0.1,h*0.08,0,'#8bc34a','#558b2f','#2e5115');
    ctx.fillStyle = linearShade(-w*0.5,-h*0.16,-w*0.66,-h*0.02,'#8bc34a','#558b2f','#2e5115');
    ctx.beginPath(); ctx.moveTo(-w*0.46,-h*0.14); ctx.lineTo(-w*0.66,-h*0.04); ctx.lineTo(-w*0.44,-h*0.02); ctx.closePath(); ctx.fill();
    shadedEllipse(0,-h*0.56,w*0.52,h*0.52,0,'#2e7d32','#1b5e20','#0a2e0c');
    shadedEllipse(0,-h*0.6,w*0.44,h*0.44,0,'#8bd66a','#4caf50','#1b5e20','rgba(0,0,0,0.25)');
    ctx.strokeStyle='rgba(10,46,12,0.55)'; ctx.lineWidth=1.1;
    var hexCenters=[[0,-h*0.82],[-w*0.2,-h*0.66],[w*0.2,-h*0.66],[-w*0.18,-h*0.46],[w*0.18,-h*0.46],[0,-h*0.6]];
    for (var hc=0; hc<hexCenters.length; hc++){
      var hcx=hexCenters[hc][0], hcy=hexCenters[hc][1], hr=w*0.11;
      ctx.beginPath();
      for (var hp=0; hp<6; hp++){
        var hpa = hp/6*Math.PI*2 + Math.PI/6;
        var px2 = hcx+Math.cos(hpa)*hr, py2 = hcy+Math.sin(hpa)*hr*0.8;
        if (hp===0) ctx.moveTo(px2,py2); else ctx.lineTo(px2,py2);
      }
      ctx.closePath(); ctx.stroke();
    }
    specDot(-w*0.14,-h*0.78,w*0.06,0.28);
    shadedEllipse(w*0.4,-h*0.42,w*0.2,h*0.17,0,'#c5e1a5','#9ccc65','#558b2f');
    shadedEllipse(w*0.5,-h*0.7,w*0.08,w*0.08,0,'#c5e1a5','#9ccc65','#558b2f');
    shadedEllipse(-w*0.5,-h*0.7,w*0.08,w*0.08,0,'#c5e1a5','#9ccc65','#558b2f');
    shadedEllipse(w*0.48,-h*0.46,w*0.075,h*0.085,0,'#fff','#fff','#ddd');
    ctx.fillStyle='#1b3a0d';
    ctx.beginPath(); ctx.arc(w*0.5,-h*0.44,w*0.04,0,7); ctx.fill();
    specDot(w*0.52,-h*0.47,w*0.015,0.9);

  } else if (en.type===2){
    var flap = Math.sin(en.t*14)*13;
    ctx.fillStyle = linearShade(0,-h*0.5,-w*0.75,-h*0.5-flap,'#8a5cb0','#4a148c','#20073f');
    ctx.beginPath(); ctx.moveTo(0,-h*0.5); ctx.quadraticCurveTo(-w*0.75,-h*0.5-flap,-w*0.14,-h*0.32); ctx.closePath(); ctx.fill();
    ctx.fillStyle = linearShade(0,-h*0.5,w*0.75,-h*0.5-flap,'#8a5cb0','#4a148c','#20073f');
    ctx.beginPath(); ctx.moveTo(0,-h*0.5); ctx.quadraticCurveTo(w*0.75,-h*0.5-flap,w*0.14,-h*0.32); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(20,7,63,0.55)'; ctx.lineWidth=0.9;
    ctx.beginPath(); ctx.moveTo(0,-h*0.5); ctx.lineTo(-w*0.5,-h*0.5-flap*0.7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-h*0.5); ctx.lineTo(w*0.5,-h*0.5-flap*0.7); ctx.stroke();
    ctx.fillStyle = linearShade(-w*0.18,-h*0.98,-w*0.08,-h*0.7,'#7b4ea0','#4a148c','#20073f');
    ctx.beginPath(); ctx.moveTo(-w*0.22,-h*0.7); ctx.lineTo(-w*0.14,-h*1.02); ctx.lineTo(-w*0.04,-h*0.72); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w*0.22,-h*0.7); ctx.lineTo(w*0.14,-h*1.02); ctx.lineTo(w*0.04,-h*0.72); ctx.closePath(); ctx.fill();
    shadedEllipse(0,-h*0.48,w*0.27,h*0.32,0,'#a97fce','#5c3a87','#20073f','rgba(0,0,0,0.3)');
    ctx.save();
    ctx.shadowColor='#ff5252'; ctx.shadowBlur=6;
    shadedEllipse(-w*0.09,-h*0.58,w*0.06,w*0.06,0,'#ff8a80','#ff1744','#7f0000');
    shadedEllipse(w*0.09,-h*0.58,w*0.06,w*0.06,0,'#ff8a80','#ff1744','#7f0000');
    ctx.restore();
    ctx.fillStyle='#fdfdfd';
    ctx.beginPath(); ctx.moveTo(-w*0.08,-h*0.42); ctx.lineTo(-w*0.04,-h*0.34); ctx.lineTo(-w*0.01,-h*0.42); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w*0.08,-h*0.42); ctx.lineTo(w*0.04,-h*0.34); ctx.lineTo(w*0.01,-h*0.42); ctx.closePath(); ctx.fill();

  } else if (en.type===3){
    shadedEllipse(0,-h*0.42,w*0.48,h*0.4,0,'#c9a36a','#8d6e4a','#4a3620');
    shadedEllipse(w*0.14,-h*0.34,w*0.26,h*0.24,0,'#f5e6cc','#e6d0a8','#c9a36a');
    ctx.save();
    ctx.rotate(Math.sin(en.t*1.2)*0.05);
    for (var sI=0; sI<11; sI++){
      var sAng = -Math.PI*0.95 + sI/10*Math.PI*1.55;
      var baseX = Math.cos(sAng)*w*0.42, baseY = -h*0.5+Math.sin(sAng)*h*0.4;
      var tipX = Math.cos(sAng)*w*0.78, tipY = -h*0.5+Math.sin(sAng)*h*0.74;
      var perpX = -Math.sin(sAng)*w*0.06, perpY = Math.cos(sAng)*w*0.06;
      ctx.fillStyle = linearShade(baseX,baseY,tipX,tipY,'#8a6a3f','#5d4126','#2a1c0d');
      ctx.beginPath();
      ctx.moveTo(baseX+perpX,baseY+perpY);
      ctx.lineTo(tipX,tipY);
      ctx.lineTo(baseX-perpX,baseY-perpY);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    shadedEllipse(w*0.42,-h*0.36,w*0.12,h*0.09,0,'#f5e6cc','#e6d0a8','#c9a36a');
    ctx.fillStyle='#2b1a10';
    ctx.beginPath(); ctx.ellipse(w*0.5,-h*0.36,w*0.045,h*0.035,0,0,7); ctx.fill();
    shadedEllipse(w*0.24,-h*0.46,w*0.06,h*0.08,0,'#fff','#fff','#ddd');
    ctx.fillStyle='#231205';
    ctx.beginPath(); ctx.arc(w*0.26,-h*0.44,w*0.032,0,7); ctx.fill();
    specDot(w*0.27,-h*0.46,w*0.012,0.9);
    shadedEllipse(-w*0.16,-h*0.06,w*0.12,h*0.08,0,'#8a6a3f','#5d4126','#2a1c0d');
    shadedEllipse(w*0.16,-h*0.06,w*0.12,h*0.08,0,'#8a6a3f','#5d4126','#2a1c0d');

  } else if (en.type===4){
    ctx.strokeStyle = '#8a3315'; ctx.lineWidth=2.4;
    for (var lg=-1; lg<=1; lg+=2){
      for (var lgI=0; lgI<3; lgI++){
        ctx.beginPath();
        ctx.moveTo(lg*w*0.34, -h*0.22);
        ctx.lineTo(lg*(w*0.46+lgI*w*0.08), -h*0.06-lgI*1.5);
        ctx.stroke();
      }
    }
    aoSmudge(0,-h*0.1,w*0.4,h*0.07,0,0.16);
    shadedEllipse(0,-h*0.5,w*0.5,h*0.42,0,'#ff8a5c','#e05a2b','#8a3315','rgba(0,0,0,0.25)');
    shadedEllipse(0,-h*0.56,w*0.36,h*0.28,0,'#ffb08a','#f0713f','#c1481f');
    ctx.strokeStyle='#e05a2b'; ctx.lineWidth=2.6; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-w*0.16,-h*0.82); ctx.lineTo(-w*0.2,-h*1.06); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w*0.16,-h*0.82); ctx.lineTo(w*0.2,-h*1.06); ctx.stroke();
    shadedEllipse(-w*0.2,-h*1.1,w*0.09,w*0.09,0,'#fff','#fff','#ddd');
    shadedEllipse(w*0.2,-h*1.1,w*0.09,w*0.09,0,'#fff','#fff','#ddd');
    ctx.fillStyle='#231205';
    ctx.beginPath(); ctx.arc(-w*0.17,-h*1.1,w*0.045,0,7); ctx.fill();
    ctx.beginPath(); ctx.arc(w*0.23,-h*1.1,w*0.045,0,7); ctx.fill();
    ctx.fillStyle = linearShade(w*0.3,-h*0.9,w*0.66,-h*0.62,'#ffab7a','#e05a2b','#8a3315');
    ctx.beginPath();
    ctx.moveTo(w*0.28,-h*0.68); ctx.lineTo(w*0.66,-h*0.9); ctx.lineTo(w*0.72,-h*0.78);
    ctx.lineTo(w*0.5,-h*0.66); ctx.lineTo(w*0.66,-h*0.62); ctx.lineTo(w*0.58,-h*0.52); ctx.closePath(); ctx.fill();
    ctx.fillStyle = linearShade(-w*0.66,-h*0.5,-w*0.3,-h*0.24,'#ffab7a','#e05a2b','#8a3315');
    ctx.beginPath();
    ctx.moveTo(-w*0.28,-h*0.3); ctx.lineTo(-w*0.62,-h*0.4); ctx.lineTo(-w*0.66,-h*0.28);
    ctx.lineTo(-w*0.42,-h*0.2); ctx.lineTo(-w*0.6,-h*0.14); ctx.lineTo(-w*0.5,-h*0.06); ctx.closePath(); ctx.fill();

  } else {
    var flap2 = Math.sin(en.t*16)*9;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = linearShade(0,-h*0.5,-w*0.6,-h*0.5-flap2,'#e3f2fd','#bbdefb','#90caf9');
    ctx.beginPath(); ctx.ellipse(-w*0.32,-h*0.55-flap2*0.4,w*0.32,h*0.16,-0.4,0,7); ctx.fill();
    ctx.fillStyle = linearShade(0,-h*0.5,w*0.6,-h*0.5-flap2,'#e3f2fd','#bbdefb','#90caf9');
    ctx.beginPath(); ctx.ellipse(w*0.32,-h*0.55-flap2*0.4,w*0.32,h*0.16,0.4,0,7); ctx.fill();
    ctx.restore();
    shadedEllipse(-w*0.16,-h*0.36,w*0.3,h*0.26,0,'#ffe27a','#ffb300','#a35a00','rgba(0,0,0,0.22)');
    ctx.save();
    ctx.beginPath(); ctx.ellipse(-w*0.16,-h*0.36,w*0.3,h*0.26,0,0,7); ctx.clip();
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-w*0.34,-h*0.5,w*0.09,h*0.3);
    ctx.fillRect(-w*0.16,-h*0.5,w*0.09,h*0.3);
    ctx.fillRect(w*0.02,-h*0.5,w*0.09,h*0.3);
    ctx.restore();
    shadedEllipse(w*0.26,-h*0.46,w*0.22,h*0.2,0,'#4a3a1a','#2b2210','#0f0c05');
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.moveTo(-w*0.44,-h*0.4); ctx.lineTo(-w*0.6,-h*0.36); ctx.lineTo(-w*0.44,-h*0.3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#1a1a1a'; ctx.lineWidth=1.3; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(w*0.36,-h*0.62); ctx.quadraticCurveTo(w*0.5,-h*0.82,w*0.42,-h*0.94); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w*0.3,-h*0.6); ctx.quadraticCurveTo(w*0.28,-h*0.84,w*0.16,-h*0.92); ctx.stroke();
    shadedEllipse(w*0.34,-h*0.48,w*0.09,h*0.1,0,'#333','#111','#000');
    specDot(w*0.31,-h*0.51,w*0.02,0.85);
  }
  ctx.restore();
}

function drawPlayer(){
  var px = player.x-camX, py = player.y;
  var blink = player.invuln>0 && Math.floor(player.invuln*14)%2===0;
  if (blink) return;
  var isMoving = Math.abs(player.vx) > 5;
  var run = Math.sin(player.animT*10);
  var legSwing = (player.onGround && isMoving) ? run*8 : 0;

  // Shadow
  ctx.save();
  var shadowSquash = player.onGround ? 1 : clamp(1 - (py - (GROUND_Y-player.h))/90, 0.35, 1);
  ctx.globalAlpha = 0.32*shadowSquash;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(px+player.w/2, GROUND_Y+3, 13*shadowSquash, 4*shadowSquash, 0,0,7);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(px+player.w/2, py+player.h);
  var PS = 1.25;
  var faceDir = (player.facing<0?-1:1);
  ctx.scale(faceDir*PS, PS);
  ctx.transform(1, 0, -0.06, 1, 0, 0);

  function shadeFill(baseColor, lightColor, darkColor, drawPath){
    var gTmp = ctx.createLinearGradient(-12,-40,12,0);
    gTmp.addColorStop(0, lightColor);
    gTmp.addColorStop(0.55, baseColor);
    gTmp.addColorStop(1, darkColor);
    ctx.fillStyle = gTmp;
    drawPath();
  }

  if (player.onGround){
    shadeFill('#1565c0','#42a5f5','#0d3c78', function(){
      ctx.fillRect(-8+legSwing*0.2, -14, 6, 14);
    });
    shadeFill('#0d47a1','#1976d2','#082f66', function(){
      ctx.fillRect(2-legSwing*0.2, -14, 6, 14);
    });
    shadeFill('#4e342e','#6d4c41','#301b12', function(){
      ctx.fillRect(-9+legSwing*0.2,-2,8,3);
    });
    shadeFill('#3e2318','#5d4037','#241209', function(){
      ctx.fillRect(1-legSwing*0.2,-2,8,3);
    });
  } else {
    shadeFill('#1565c0','#42a5f5','#0d3c78', function(){
      ctx.save(); ctx.translate(-5,-14); ctx.rotate(-0.55); ctx.fillRect(-3,0,6,10); ctx.restore();
    });
    shadeFill('#0d47a1','#1976d2','#082f66', function(){
      ctx.save(); ctx.translate(6,-14); ctx.rotate(0.65); ctx.fillRect(-3,0,6,10); ctx.restore();
    });
    shadeFill('#4e342e','#6d4c41','#301b12', function(){
      ctx.save(); ctx.translate(-5,-14); ctx.rotate(-0.55); ctx.fillRect(-1,9,8,3); ctx.restore();
    });
    shadeFill('#3e2318','#5d4037','#241209', function(){
      ctx.save(); ctx.translate(6,-14); ctx.rotate(0.65); ctx.fillRect(-1,9,8,3); ctx.restore();
    });
  }

  // Body
  shadeFill('#1565c0','#5eb3ff','#0a3060', function(){
    roundRect(-10,-30,20,18,5); ctx.fill();
  });
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(0,-28,8,3,0,0,7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(8,-28); ctx.lineTo(8,-14); ctx.stroke();

  // Straps
  shadeFill('#0d47a1','#1e63c9','#082049', function(){ ctx.fillRect(-7,-30,3,9); });
  shadeFill('#0d47a1','#1e63c9','#082049', function(){ ctx.fillRect(4,-30,3,9); });
  ctx.fillStyle='#ffd54a';
  ctx.beginPath(); ctx.arc(-5.5,-22,1.2,0,7); ctx.fill();
  ctx.beginPath(); ctx.arc(5.5,-22,1.2,0,7); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(-6,-22.5,0.5,0,7); ctx.fill();
  ctx.beginPath(); ctx.arc(5,-22.5,0.5,0,7); ctx.fill();

  // Shirt sleeves/arms
  shadeFill('#d32f2f','#ff7961','#8e0000', function(){
    ctx.beginPath(); ctx.ellipse(-11,-26,5,8,0.3,0,7); ctx.fill();
  });
  shadeFill('#c62828','#e57373','#7f0000', function(){
    ctx.beginPath(); ctx.ellipse(11,-26,5,8,-0.3,0,7); ctx.fill();
  });
  shadeFill('#fff3e0','#ffffff','#d7ccc8', function(){
    ctx.beginPath(); ctx.arc(-14,-19,4,0,7); ctx.fill();
  });
  shadeFill('#f5ebe0','#ffffff','#cfc3b8', function(){
    ctx.beginPath(); ctx.arc(14,-19,4,0,7); ctx.fill();
  });

  // Baseball bat - gripped in the right hand, only visible when punching
  if (player.isPunching) {
    ctx.save();
    ctx.translate(14, -19);
    ctx.rotate(-0.95);
    var batLen = 28, gripLen = 7, gripW = 2.4, barrelW = 6;
    var batGrad = ctx.createLinearGradient(0, 0, 0, -batLen);
    batGrad.addColorStop(0, '#4e342e');
    batGrad.addColorStop(0.35, '#8d6e4a');
    batGrad.addColorStop(1, '#d7bd93');
    ctx.fillStyle = batGrad;
    ctx.beginPath();
    ctx.moveTo(-gripW/2, 2);
    ctx.lineTo(-gripW/2, -gripLen);
    ctx.quadraticCurveTo(-barrelW/2, -gripLen-6, -barrelW/2, -batLen+5);
    ctx.quadraticCurveTo(-barrelW/2, -batLen, 0, -batLen);
    ctx.quadraticCurveTo(barrelW/2, -batLen, barrelW/2, -batLen+5);
    ctx.quadraticCurveTo(barrelW/2, -gripLen-6, gripW/2, -gripLen);
    ctx.lineTo(gripW/2, 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Grip tape
    ctx.fillStyle = '#1565c0';
    ctx.fillRect(-gripW/2-0.4, -gripLen+0.5, gripW+0.8, 2.4);
    ctx.fillRect(-gripW/2-0.4, -gripLen+3.4, gripW+0.8, 2);
    // Barrel highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-barrelW/2+1, -gripLen-6);
    ctx.lineTo(-barrelW/2+1, -batLen+6);
    ctx.stroke();
    // Motion blur streaks
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#64b5f6';
    for (var s=0; s<4; s++) {
      ctx.beginPath();
      ctx.ellipse(-4 - s*3.2, -batLen*0.55 + s*2.2, 5.5, 1.4, 0.35, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Head
  var headG = ctx.createRadialGradient(-3,-40,2,0,-36,11);
  headG.addColorStop(0,'#ffe0b2');
  headG.addColorStop(0.55,'#ffcc80');
  headG.addColorStop(1,'#d9974f');
  ctx.fillStyle = headG;
  ctx.beginPath(); ctx.arc(0,-36,9,0,7); ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(120,70,20,0.22)';
  ctx.beginPath(); ctx.ellipse(5,-34,6,9,0.3,0,7); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(90,50,15,0.35)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(0,-36,9,0,7); ctx.stroke();
  ctx.fillStyle = '#e8a865';
  ctx.beginPath(); ctx.arc(-8,-34,2.2,0,7); ctx.fill();
  ctx.fillStyle = 'rgba(255,120,110,0.35)';
  ctx.beginPath(); ctx.ellipse(-3,-33,2,1.2,0,0,7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(7,-33,2,1.2,0,0,7); ctx.fill();
  ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.ellipse(4,-38,2.2,2.6,0,0,7); ctx.fill();
  ctx.fillStyle='#3e2313';
  ctx.beginPath(); ctx.arc(4.8,-38,1.2,0,7); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(5.2,-38.5,0.4,0,7); ctx.fill();
  var noseG = ctx.createRadialGradient(5,-34.5,0.4,6,-34,2.8);
  noseG.addColorStop(0,'#ffd699'); noseG.addColorStop(1,'#e29a4a');
  ctx.fillStyle = noseG;
  ctx.beginPath(); ctx.arc(6,-34,2.2,0,7); ctx.fill();
  ctx.strokeStyle = 'rgba(90,50,15,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-1,-31); ctx.quadraticCurveTo(1,-29.5,3.5,-30.5); ctx.stroke();
  ctx.fillStyle = '#4e342e';
  ctx.beginPath();
  ctx.moveTo(0.5,-32);
  ctx.quadraticCurveTo(3.5,-30.5,9,-32);
  ctx.quadraticCurveTo(4.5,-29.5,3,-31);
  ctx.quadraticCurveTo(2,-30,0.5,-32);
  ctx.closePath(); ctx.fill();
  shadeFill('#e53935','#ff7566','#8e0000', function(){
    ctx.beginPath(); ctx.arc(0,-39,9,Math.PI,0); ctx.fill();
    ctx.fillRect(-9,-39,18,3.5);
  });
  ctx.fillStyle = '#c62828';
  ctx.beginPath(); ctx.ellipse(6,-36,6,3.5,0,0,7); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.ellipse(2.5,-35.5,4.5,1.8,0,0,7); ctx.fill();
  ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.arc(0,-44,3,0,7); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.arc(-1,-45,1,0,7); ctx.fill();

  ctx.restore();

  if (player.onGround && Math.abs(player.vx)>10 && Math.random()<0.3){
    spawnBurst(player.x+player.w/2 - player.facing*8, player.y+player.h-2, '#e0e0e0', 1, 20);
  }
}

function drawProjectiles(){
  for (var i=0;i<projectiles.length;i++){
    var p = projectiles[i];
    var x = p.x-camX;
    if (x<-20||x>viewW+20) continue;
    ctx.save();
    ctx.translate(x,p.y);
    var bulletG = ctx.createRadialGradient(-4,0,1,0,0,6);
    bulletG.addColorStop(0,'#fff9c4');
    bulletG.addColorStop(0.4,'#ffb300');
    bulletG.addColorStop(1,'#e65100');
    ctx.fillStyle = bulletG;
    ctx.beginPath();
    ctx.ellipse(0,0,6,4,0,0,7);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,180,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(-12,0,10,3,0,0,7);
    ctx.fill();
    ctx.restore();
  }
}

function drawEnemyBullets(){
  for (var i=0;i<enemyBullets.length;i++){
    var b = enemyBullets[i];
    var x = b.x-camX;
    if (x<-20||x>viewW+20) continue;
    ctx.save();
    ctx.translate(x,b.y);
    var g = ctx.createRadialGradient(0,0,1,0,0,7);
    g.addColorStop(0,'#ffffff'); g.addColorStop(0.4,'#ff5252'); g.addColorStop(1,'#7f0000');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0,0,6,0,7); ctx.fill();
    ctx.restore();
  }
}

function drawParticles(){
  for (var i=0;i<particles.length;i++){
    var p = particles[i];
    var a = 1 - p.t/p.life;
    var x = p.x-camX;
    ctx.save();
    ctx.globalAlpha = Math.max(0,a);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(x,p.y,p.size,0,7); ctx.fill();
    ctx.restore();
  }
}

function render(){
  ctx.clearRect(0,0,viewW,viewH);
  drawBackground();
  drawGround();
  drawStones();
  drawCoins();
  drawHearts();
  drawPowerStars();
  for (var i=0;i<enemies.length;i++) drawEnemy(enemies[i]);
  drawEnemyBullets();
  drawProjectiles();
  drawPlayer();
  drawParticles();
  drawRain();
}

/* ============================ LOOP ============================ */
function loop(ts){
  var dt = (ts-lastTime)/1000 || 0;
  lastTime = ts;
  player.animT += dt;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

/* ============================ START / RESTART ============================ */
function startGame(){
  initAudio();
  if (actx && actx.state==='suspended') actx.resume();
  resetGame();
  gameState = 'playing';
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('gameOverScreen').classList.add('hidden');
  startMusic();
}

document.getElementById('startScreen').addEventListener('touchstart', function(e){ e.preventDefault(); startGame(); }, {passive:false});
document.getElementById('startScreen').addEventListener('mousedown', startGame);
document.getElementById('restartBtn').addEventListener('touchstart', function(e){ e.preventDefault(); startGame(); }, {passive:false});
document.getElementById('restartBtn').addEventListener('click', startGame);

(function(){
  var mBtn = document.getElementById('muteBtn');
  var toggle = function(e){
    e.preventDefault();
    initAudio();
    if (actx && actx.state==='suspended') actx.resume();
    var on = toggleMusic();
    mBtn.textContent = on ? '🔊' : '🔇';
  };
  mBtn.addEventListener('touchstart', toggle, {passive:false});
  mBtn.addEventListener('mousedown', toggle);
})();

resetGame();
requestAnimationFrame(loop);

})();
</script>
</body>
</html>