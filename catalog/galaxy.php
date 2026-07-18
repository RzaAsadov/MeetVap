<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Galaxy Blaster · Retro Endless</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    html, body {
      width: 100%;
      height: 100%;
      background: #0b0e1a;
      overflow: hidden;
      touch-action: none;
      position: fixed;
      top: 0;
      left: 0;
    }
    #game-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: radial-gradient(circle at 20% 30%, #1a1f35, #070a14);
      overflow: hidden;
      touch-action: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    canvas {
      display: block;
      width: 100% !important;
      height: 100% !important;
      background: transparent;
      touch-action: none;
      cursor: none;
      image-rendering: crisp-edges;
    }
    #ui-overlay {
      position: absolute;
      top: 12px;
      left: 16px;
      right: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      pointer-events: none;
      color: #eef5ff;
      text-shadow: 0 0 12px #3f7eff, 0 0 30px #1f3faa;
      font-weight: 700;
      font-size: clamp(14px, 3.5vw, 28px);
      letter-spacing: 1px;
      z-index: 10;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    #score-label, #gameover-label {
      background: rgba(8, 12, 30, 0.5);
      backdrop-filter: blur(2px);
      padding: 4px 14px 6px 14px;
      border-radius: 40px;
      border: 1px solid rgba(100, 180, 255, 0.25);
      box-shadow: 0 0 20px rgba(0, 40, 120, 0.5);
    }
    #gameover-label {
      display: none;
      background: rgba(180, 20, 20, 0.5);
      border-color: #ff7a7a;
      color: #ffd0d0;
      font-size: clamp(16px, 4vw, 32px);
      padding: 8px 24px;
      pointer-events: auto;
    }
    #round-label {
      display: block;
      font-size: clamp(10px, 2vw, 16px);
      opacity: 0.75;
      font-weight: 500;
      margin-top: 4px;
      letter-spacing: 0.5px;
    }
    /* Round transition overlay */
    #round-screen {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 18;
      pointer-events: none;
      overflow: hidden;
    }
    #round-screen .round-glow {
      position: absolute;
      width: 60vmax;
      height: 60vmax;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(63,126,255,0.35), rgba(63,126,255,0) 70%);
      opacity: 0;
    }
    #round-text {
      position: relative;
      font-size: clamp(26px, 7vw, 64px);
      color: #eef5ff;
      text-shadow: 0 0 30px #3f7eff, 0 0 60px #1f3faa;
      font-weight: 900;
      letter-spacing: 3px;
      opacity: 0;
      transform: scale(0.6);
      text-align: center;
      padding: 0 20px;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    @keyframes roundPop {
      0%   { opacity: 0; transform: scale(0.6); }
      15%  { opacity: 1; transform: scale(1.08); }
      25%  { opacity: 1; transform: scale(1); }
      78%  { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(1.15); }
    }
    @keyframes roundGlow {
      0%   { opacity: 0; transform: scale(0.4); }
      25%  { opacity: 1; transform: scale(1); }
      78%  { opacity: 0.8; transform: scale(1.15); }
      100% { opacity: 0; transform: scale(1.3); }
    }
    .round-text-anim { animation: roundPop 1.8s ease forwards; }
    .round-glow-anim { animation: roundGlow 1.8s ease forwards; }

    /* Countdown overlay */
    #countdown-screen {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 19;
      pointer-events: none;
      overflow: hidden;
    }
    #countdown-screen .countdown-glow {
      position: absolute;
      width: 50vmax;
      height: 50vmax;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,187,46,0.28), rgba(255,187,46,0) 70%);
      opacity: 0;
    }
    #countdown-text {
      position: relative;
      font-size: clamp(48px, 16vw, 140px);
      color: #ffe9b0;
      text-shadow: 0 0 40px #ffbb2e, 0 0 80px #ff8a1f;
      font-weight: 900;
      letter-spacing: 2px;
      opacity: 0;
      transform: scale(0.4);
      text-align: center;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    #countdown-text.go-text {
      color: #b6ffcf;
      text-shadow: 0 0 40px #3fffa0, 0 0 90px #1fbb70;
      letter-spacing: 6px;
    }
    @keyframes countdownPop {
      0%   { opacity: 0; transform: scale(0.3); }
      20%  { opacity: 1; transform: scale(1.15); }
      35%  { opacity: 1; transform: scale(1); }
      80%  { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(0.85); }
    }
    @keyframes countdownGlow {
      0%   { opacity: 0; transform: scale(0.3); }
      30%  { opacity: 1; transform: scale(1); }
      80%  { opacity: 0.7; transform: scale(1.1); }
      100% { opacity: 0; transform: scale(1.2); }
    }
    .countdown-text-anim { animation: countdownPop 0.7s ease forwards; }
    .countdown-glow-anim { animation: countdownGlow 0.7s ease forwards; }

    #restart-btn {
      pointer-events: auto;
      background: #ffbb2e;
      border: none;
      color: #0b0e1a;
      font-weight: 800;
      padding: 4px 18px;
      border-radius: 40px;
      font-size: clamp(14px, 3vw, 24px);
      box-shadow: 0 0 20px #ffbb2eaa;
      cursor: pointer;
      transition: 0.1s ease;
      margin-left: 10px;
    }
    #restart-btn:active {
      transform: scale(0.92);
      background: #ffdd77;
    }

    /* ===== Start screen — modern redesign ===== */
    #start-screen {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background:
        radial-gradient(circle at 50% 15%, rgba(80, 130, 255, 0.18), transparent 55%),
        linear-gradient(180deg, rgba(6, 9, 20, 0.86), rgba(4, 6, 14, 0.94));
      backdrop-filter: blur(8px);
      z-index: 20;
      pointer-events: auto;
      padding: 20px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      overflow: hidden;
    }
    #start-screen::before {
      content: "";
      position: absolute;
      top: -20%;
      left: 50%;
      width: 140vmax;
      height: 140vmax;
      transform: translateX(-50%);
      background: radial-gradient(circle, rgba(63,126,255,0.10), transparent 60%);
      animation: driftGlow 12s ease-in-out infinite alternate;
      pointer-events: none;
    }
    @keyframes driftGlow {
      0%   { opacity: 0.5; transform: translateX(-52%) scale(1); }
      100% { opacity: 0.9; transform: translateX(-48%) scale(1.08); }
    }
    .title-wrap {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-bottom: clamp(24px, 5vh, 46px);
    }
    #start-screen h1 {
      position: relative;
      font-size: clamp(34px, 9vw, 78px);
      background: linear-gradient(180deg, #ffffff 0%, #bcdcff 45%, #6fa8ff 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      filter: drop-shadow(0 0 18px rgba(80, 150, 255, 0.75)) drop-shadow(0 0 42px rgba(60, 120, 255, 0.4));
      margin-bottom: 6px;
      letter-spacing: 6px;
      font-weight: 900;
      animation: titlePulse 3.2s ease-in-out infinite;
    }
    @keyframes titlePulse {
      0%, 100% { filter: drop-shadow(0 0 18px rgba(80, 150, 255, 0.75)) drop-shadow(0 0 42px rgba(60, 120, 255, 0.4)); }
      50%      { filter: drop-shadow(0 0 28px rgba(120, 180, 255, 0.95)) drop-shadow(0 0 60px rgba(90, 150, 255, 0.6)); }
    }
    #start-screen .subtitle {
      font-size: clamp(12px, 2.2vw, 22px);
      color: #93b8ff;
      text-shadow: 0 0 16px rgba(63, 126, 255, 0.7);
      letter-spacing: 3px;
      font-weight: 600;
      opacity: 0.9;
    }
    .title-underline {
      width: clamp(90px, 22vw, 180px);
      height: 3px;
      margin-top: 14px;
      border-radius: 4px;
      background: linear-gradient(90deg, transparent, #6fa8ff, transparent);
      box-shadow: 0 0 12px #6fa8ff;
    }
    .pick-label {
      color: #7fa4e0;
      font-size: clamp(11px, 1.8vw, 16px);
      letter-spacing: 3px;
      font-weight: 700;
      margin-bottom: clamp(12px, 2.2vh, 20px);
      text-transform: uppercase;
      opacity: 0.85;
    }
    .difficulty-buttons {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .diff-btn {
      position: relative;
      padding: 18px 34px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 22px;
      background: linear-gradient(160deg, rgba(30, 42, 70, 0.75), rgba(14, 20, 38, 0.75));
      backdrop-filter: blur(6px);
      color: #eef5ff;
      font-size: clamp(16px, 2.6vw, 26px);
      font-weight: 800;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.03);
      min-width: 140px;
      letter-spacing: 1px;
      font-family: inherit;
      overflow: hidden;
    }
    .diff-btn::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 22px;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    }
    .diff-btn:hover::before,
    .diff-btn:active::before {
      opacity: 1;
    }
    .diff-btn:active {
      transform: scale(0.94) translateY(1px);
    }
    .diff-btn.easy { border-color: rgba(76, 175, 80, 0.45); }
    .diff-btn.easy::before { box-shadow: 0 0 30px rgba(76,175,80,0.55), inset 0 0 20px rgba(76,175,80,0.15); }
    .diff-btn.easy .icon { color: #7fe0a0; }

    .diff-btn.medium { border-color: rgba(255, 152, 0, 0.45); }
    .diff-btn.medium::before { box-shadow: 0 0 30px rgba(255,152,0,0.55), inset 0 0 20px rgba(255,152,0,0.15); }
    .diff-btn.medium .icon { color: #ffb84d; }

    .diff-btn.hard { border-color: rgba(244, 67, 54, 0.45); }
    .diff-btn.hard::before { box-shadow: 0 0 30px rgba(244,67,54,0.55), inset 0 0 20px rgba(244,67,54,0.15); }
    .diff-btn.hard .icon { color: #ff7a70; }

    .diff-btn .icon {
      display: block;
      font-size: clamp(22px, 3.4vw, 38px);
      margin-bottom: 6px;
      filter: drop-shadow(0 0 10px currentColor);
    }
    .diff-btn .label {
      display: block;
      letter-spacing: 2px;
    }
    .diff-btn .speed-indicator {
      display: block;
      font-size: clamp(10px, 1.2vw, 14px);
      opacity: 0.55;
      margin-top: 6px;
      font-weight: 500;
      letter-spacing: 0.5px;
    }
    @media (max-width: 500px) {
      .diff-btn {
        padding: 14px 22px;
        min-width: 96px;
        font-size: clamp(14px, 4vw, 20px);
      }
      .difficulty-buttons {
        gap: 10px;
      }
    }
  </style>
</head>
<body>
<div id="game-container">
  <canvas id="gameCanvas"></canvas>
  <div id="ui-overlay">
    <span id="score-label">✦ 0<span id="round-label">Round 1</span></span>
    <span id="gameover-label">💥 GAME OVER <button id="restart-btn">↻</button></span>
  </div>
  <div id="round-screen">
    <div class="round-glow"></div>
    <div id="round-text"></div>
  </div>
  <div id="countdown-screen">
    <div class="countdown-glow"></div>
    <div id="countdown-text"></div>
  </div>
  <div id="start-screen">
    <div class="title-wrap">
      <h1>GALAXY</h1>
      <div class="subtitle">⚡ COSMIC BLASTER ⚡</div>
      <div class="title-underline"></div>
    </div>
    <div class="pick-label" id="pick-label">SELECT DIFFICULTY</div>
    <div class="difficulty-buttons">
      <button class="diff-btn easy" data-diff="easy">
        <span class="icon">🟢</span>
        <span class="label">EASY</span>
        <span class="speed-indicator">3× speed</span>
      </button>
      <button class="diff-btn medium" data-diff="medium">
        <span class="icon">🟠</span>
        <span class="label">MEDIUM</span>
        <span class="speed-indicator">6× speed</span>
      </button>
      <button class="diff-btn hard" data-diff="hard">
        <span class="icon">🔴</span>
        <span class="label">HARD</span>
        <span class="speed-indicator">9× speed</span>
      </button>
    </div>
  </div>
</div>
<script>
  (function() {
    // ----- LOCALIZATION (GET param 'lang') -----
    const urlParams = new URLSearchParams(window.location.search);
    let lang = urlParams.get('lang') || 'en';
    if (!['tr', 'en', 'ru'].includes(lang)) lang = 'en';

    const L10N = {
      tr: { gameover: 'OYUN BİTTİ', restart: '↻', easy: 'KOLAY', medium: 'ORTA', hard: 'ZOR',
        round: 'Tur', roundFinished: (n) => `TUR ${n} TAMAMLANDI`,
        pick: 'ZORLUK SEÇ', go: 'BAŞLA!' },
      en: { gameover: 'GAME OVER', restart: '↻', easy: 'EASY', medium: 'MEDIUM', hard: 'HARD',
        round: 'Round', roundFinished: (n) => `ROUND ${n} FINISHED`,
        pick: 'SELECT DIFFICULTY', go: 'GO!' },
      ru: { gameover: 'ИГРА ОКОНЧЕНА', restart: '↻', easy: 'ЛЕГКИЙ', medium: 'СРЕДНИЙ', hard: 'СЛОЖНЫЙ',
        round: 'Раунд', roundFinished: (n) => `РАУНД ${n} ЗАВЕРШЁН`,
        pick: 'ВЫБЕРИТЕ СЛОЖНОСТЬ', go: 'СТАРТ!' }
    };
    const text = L10N[lang] || L10N.en;

    // Update button labels + pick label
    document.querySelectorAll('.diff-btn').forEach(btn => {
      const key = btn.dataset.diff;
      if (text[key]) {
        btn.querySelector('.label').textContent = text[key];
      }
    });
    document.getElementById('pick-label').textContent = text.pick;

    // ----- CANVAS SETUP -----
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('game-container');

    let W, H;
    function resizeCanvas() {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      W = canvas.width;
      H = canvas.height;
    }
    resizeCanvas();

    // ----- GAME STATE -----
    const STATE = {
      MENU: 0,
      PLAYING: 1,
      GAMEOVER: 2,
      ROUND_TRANSITION: 3,
      COUNTDOWN: 4
    };

    let state = STATE.MENU;
    let score = 0;
    let frame = 0;
    let spawnCounter = 0;
    let difficulty = 'hard';
    let spawnRate = 22;
    let speedMultiplier = 9; // Default hard (50% faster than original 6)

    // Round progression
    let roundNumber = 1;
    let enemySizeMult = 1;
    let enemyHpMult = 1;
    let enemySpeedMult = 1;
    const ROUND_POINTS = 1000;
    const roundScreenEl = document.getElementById('round-screen');
    const roundTextEl = document.getElementById('round-text');
    const roundGlowEl = document.querySelector('#round-screen .round-glow');

    // Countdown overlay elements
    const countdownScreenEl = document.getElementById('countdown-screen');
    const countdownTextEl = document.getElementById('countdown-text');
    const countdownGlowEl = document.querySelector('#countdown-screen .countdown-glow');
    let countdownTimers = [];

    // Hero — starfighter, nose pointing UP, 100% bigger than the original jet
    const hero = {
      x: 0, y: 0,
      w: 88, h: 100,
      speed: 8,
      fireCooldown: 0,
      fireDelay: 4,
    };

    // Place the hero a little below the center of the screen (used at boot and on reset)
    function positionHeroDefault() {
      hero.x = W * 0.5 - hero.w * 0.5;
      hero.y = H * 0.58 - hero.h * 0.5;
    }
    positionHeroDefault();

    // Bullets
    let bullets = [];
    const BULLET_SPEED = 13;
    const BULLET_SIZE = 18;

    // Enemies
    let enemies = [];
    // 10 enemy types with different designs (cosmic jets)
    const ENEMY_TYPES = [
      { hp: 1, w: 32, h: 28, color: '#f2b84b', speed: 1.2, design: 'scout' },
      { hp: 2, w: 36, h: 32, color: '#e86a6a', speed: 0.9, design: 'fighter' },
      { hp: 3, w: 42, h: 38, color: '#6fc3df', speed: 0.8, design: 'interceptor' },
      { hp: 4, w: 48, h: 40, color: '#b47bdb', speed: 0.7, design: 'bomber' },
      { hp: 5, w: 52, h: 44, color: '#f5a3d0', speed: 0.6, design: 'ace' },
      { hp: 6, w: 56, h: 48, color: '#7fe0a6', speed: 0.5, design: 'titan' },
      { hp: 7, w: 60, h: 52, color: '#ffb07c', speed: 0.4, design: 'goliath' },
      { hp: 8, w: 60, h: 56, color: '#e0c97a', speed: 0.3, design: 'phantom' },
      { hp: 9, w: 66, h: 60, color: '#b0a0ff', speed: 0.25, design: 'cosmic' },
      { hp: 10, w: 72, h: 66, color: '#ff7f7f', speed: 0.2, design: 'dreadnought' },
    ];

    // Touch / drag
    let touchActive = false;
    let touchX = 0, touchY = 0;

    // ----- HELPERS -----
    function rand(min, max) { return Math.random() * (max - min) + min; }
    function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

    // ----- INIT / RESET -----
    function resetGame() {
      score = 0;
      frame = 0;
      spawnCounter = 0;
      bullets = [];
      enemies = [];
      positionHeroDefault();
      hero.fireCooldown = 0;
      roundNumber = 1;
      enemySizeMult = 1;
      enemyHpMult = 1;
      enemySpeedMult = 1;
      document.getElementById('gameover-label').style.display = 'none';
      document.getElementById('score-label').innerHTML = '✦ 0<span id="round-label">' + text.round + ' 1</span>';
      document.getElementById('start-screen').style.display = 'none';
      roundScreenEl.style.display = 'none';

      if (difficulty === 'easy') {
        spawnRate = 44;
        speedMultiplier = 3;
      } else if (difficulty === 'medium') {
        spawnRate = 30;
        speedMultiplier = 6;
      } else {
        spawnRate = 22;
        speedMultiplier = 9;
      }

      startCountdown();
    }

    function setDifficulty(diff) {
      difficulty = diff;
      resetGame();
    }

    // ----- COUNTDOWN (3, 2, 1, GO) -----
    function clearCountdownTimers() {
      countdownTimers.forEach(id => clearTimeout(id));
      countdownTimers = [];
    }

    function showCountdownStep(value, isGo) {
      countdownTextEl.textContent = value;
      countdownTextEl.classList.toggle('go-text', !!isGo);
      countdownTextEl.classList.remove('countdown-text-anim');
      countdownGlowEl.classList.remove('countdown-glow-anim');
      void countdownTextEl.offsetWidth;
      countdownTextEl.classList.add('countdown-text-anim');
      countdownGlowEl.classList.add('countdown-glow-anim');
    }

    function startCountdown() {
      clearCountdownTimers();
      state = STATE.COUNTDOWN;
      countdownScreenEl.style.display = 'flex';

      const STEP_MS = 700;
      showCountdownStep('3', false);
      countdownTimers.push(setTimeout(() => showCountdownStep('2', false), STEP_MS));
      countdownTimers.push(setTimeout(() => showCountdownStep('1', false), STEP_MS * 2));
      countdownTimers.push(setTimeout(() => showCountdownStep(text.go, true), STEP_MS * 3));
      countdownTimers.push(setTimeout(() => {
        countdownScreenEl.style.display = 'none';
        state = STATE.PLAYING;
      }, STEP_MS * 4));
    }

    // ----- ROUND PROGRESSION -----
    function checkRoundProgress() {
      if (state !== STATE.PLAYING) return;
      if (score >= roundNumber * ROUND_POINTS) {
        triggerRoundTransition();
      }
    }

    function triggerRoundTransition() {
      state = STATE.ROUND_TRANSITION;
      const finishedRound = roundNumber;

      roundTextEl.textContent = text.roundFinished(finishedRound);
      roundScreenEl.style.display = 'flex';

      // restart CSS animations
      roundTextEl.classList.remove('round-text-anim');
      roundGlowEl.classList.remove('round-glow-anim');
      void roundTextEl.offsetWidth;
      roundTextEl.classList.add('round-text-anim');
      roundGlowEl.classList.add('round-glow-anim');

      setTimeout(() => {
        roundNumber++;
        enemySizeMult *= 1.2;
        enemyHpMult *= 1.2;
        enemySpeedMult *= 1.05;

        // everything resets for the fresh round
        bullets = [];
        enemies = [];
        spawnCounter = 0;
        positionHeroDefault();
        hero.fireCooldown = 0;

        document.getElementById('score-label').innerHTML = '✦ ' + score + '<span id="round-label">' + text.round + ' ' + roundNumber + '</span>';
        roundScreenEl.style.display = 'none';
        state = STATE.PLAYING;
      }, 1800);
    }

    // ----- SPAWN ENEMY (from top) -----
    function spawnEnemy() {
      const typeIdx = randInt(0, ENEMY_TYPES.length - 1);
      const type = ENEMY_TYPES[typeIdx];
      const sizeScale = (0.8 + Math.random() * 0.4) * enemySizeMult;
      const w = type.w * sizeScale;
      const h = type.h * sizeScale;
      const x = rand(w * 0.5, W - w * 0.5);
      const y = -h - 20 - rand(0, 60);
      const hp = Math.round((type.hp + (Math.random() > 0.7 ? 1 : 0)) * enemyHpMult);
      // 30% of enemies are fast (1.3x speed)
      const isFast = Math.random() < 0.3;
      const fastMult = isFast ? 1.3 : 1.0;
      // Apply difficulty speed multiplier + round speed multiplier
      const baseSpeed = type.speed * (0.8 + Math.random() * 0.5);
      const finalSpeed = baseSpeed * fastMult * speedMultiplier * enemySpeedMult;
      enemies.push({
        x, y, w, h,
        hp: Math.max(1, hp),
        maxHp: Math.max(1, hp),
        color: type.color,
        speed: finalSpeed,
        typeIdx,
        design: type.design,
        wobble: rand(0, Math.PI * 2),
        wobbleSpeed: rand(0.02, 0.06),
        wobbleAmp: rand(0.4, 1.8),
        isFast,
      });
    }

    // ----- UPDATE -----
    function update() {
      if (state !== STATE.PLAYING) return;

      frame++;

      // Hero movement
      if (touchActive) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (touchX - rect.left) * scaleX;
        const canvasY = (touchY - rect.top) * scaleY;
        const targetX = Math.min(W - hero.w * 0.5, Math.max(hero.w * 0.5, canvasX));
        const targetY = Math.min(H - hero.h * 0.5, Math.max(hero.h * 0.5, canvasY));
        hero.x += (targetX - hero.x) * 0.25;
        hero.y += (targetY - hero.y) * 0.25;
      }

      // Continuous fire
      hero.fireCooldown--;
      if (hero.fireCooldown <= 0) {
        bullets.push({
          x: hero.x + hero.w * 0.16,
          y: hero.y + hero.h * 0.18,
          w: BULLET_SIZE * 0.55,
          h: BULLET_SIZE * 1.2,
          speed: BULLET_SPEED,
        });
        bullets.push({
          x: hero.x + hero.w * 0.84,
          y: hero.y + hero.h * 0.18,
          w: BULLET_SIZE * 0.55,
          h: BULLET_SIZE * 1.2,
          speed: BULLET_SPEED,
        });
        hero.fireCooldown = hero.fireDelay;
      }

      // Spawn enemies - difficulty affects count
      spawnCounter++;
      let spawnCount = 0;
      if (spawnCounter >= spawnRate) {
        spawnCounter = 0;
        if (difficulty === 'hard') {
          spawnCount = Math.random() > 0.6 ? 2 : 1;
        } else if (difficulty === 'medium') {
          spawnCount = Math.random() > 0.7 ? 2 : 1;
        } else { // easy
          spawnCount = 1;
        }
        for (let i = 0; i < spawnCount; i++) {
          spawnEnemy();
        }
      }

      // Move bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.y -= b.speed;
        if (b.y < -20) {
          bullets.splice(i, 1);
          continue;
        }
        let bulletUsed = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (b.x < e.x + e.w && b.x + b.w > e.x &&
              b.y < e.y + e.h && b.y + b.h > e.y) {
            e.hp--;
            bulletUsed = true;
            if (e.hp <= 0) {
              enemies.splice(j, 1);
              score += 10 + (e.maxHp * 2);
              document.getElementById('score-label').innerHTML = '✦ ' + score + '<span id="round-label">' + text.round + ' ' + roundNumber + '</span>';
              checkRoundProgress();
            }
            break;
          }
        }
        if (bulletUsed) {
          bullets.splice(i, 1);
        }
      }

      // Move enemies
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.y += e.speed * 0.9;
        e.wobble += e.wobbleSpeed;
        e.x += Math.sin(e.wobble) * e.wobbleAmp;
        e.x = Math.min(W - e.w * 0.5, Math.max(e.w * 0.5, e.x));

        if (hero.x < e.x + e.w && hero.x + hero.w > e.x &&
            hero.y < e.y + e.h && hero.y + hero.h > e.y) {
          state = STATE.GAMEOVER;
          document.getElementById('gameover-label').style.display = 'flex';
          document.getElementById('gameover-label').innerHTML = '💥 ' + text.gameover + ' <button id="restart-btn">↻</button>';
          document.getElementById('restart-btn').addEventListener('click', resetGame);
          return;
        }

        if (e.y - e.h > H + 20) {
          enemies.splice(i, 1);
        }
      }
    }

    // ----- DRAW -----
    // Helper: darken/lighten a hex color by a percent (-1..1)
    function shade(hex, pct) {
      const n = parseInt(hex.slice(1), 16);
      let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      r = Math.max(0, Math.min(255, Math.round(r + (pct < 0 ? r : 255 - r) * pct)));
      g = Math.max(0, Math.min(255, Math.round(g + (pct < 0 ? g : 255 - g) * pct)));
      b = Math.max(0, Math.min(255, Math.round(b + (pct < 0 ? b : 255 - b) * pct)));
      return `rgb(${r},${g},${b})`;
    }

    // Enemy war-jets — flying nose-down (toward the player below), each design distinct
    function drawEnemy(e) {
      const hpRatio = e.hp / e.maxHp;
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      const w = e.w, h = e.h;
      const dark = shade(e.color, -0.55);
      const mid = shade(e.color, -0.2);
      const light = shade(e.color, 0.35);

      ctx.save();

      // ---- afterburner exhaust trail (points up, away from travel dir) ----
      ctx.shadowColor = e.isFast ? '#ffaa44' : '#ff7733';
      ctx.shadowBlur = e.isFast ? 34 : 18;
      const flameLen = h * (e.isFast ? 0.55 : 0.4);
      const flameGrad = ctx.createLinearGradient(cx, e.y + h * 0.25, cx, e.y + h * 0.25 - flameLen);
      flameGrad.addColorStop(0, e.isFast ? '#ffe9a8' : '#ffcf8a');
      flameGrad.addColorStop(0.5, '#ff9a3d');
      flameGrad.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.1, e.y + h * 0.28);
      ctx.lineTo(cx, e.y + h * 0.28 - flameLen);
      ctx.lineTo(cx + w * 0.1, e.y + h * 0.28);
      ctx.closePath();
      ctx.fill();

      // ---- rear stabilizer / tail fin(s), near top ----
      ctx.shadowColor = dark;
      ctx.shadowBlur = 10;
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.moveTo(cx, e.y + h * 0.38);
      ctx.lineTo(cx - w * 0.42, e.y + h * 0.18);
      ctx.lineTo(cx - w * 0.06, e.y + h * 0.32);
      ctx.closePath();
      ctx.fill();
      if (e.design === 'fighter' || e.design === 'bomber' || e.design === 'goliath' || e.design === 'dreadnought') {
        ctx.beginPath();
        ctx.moveTo(cx, e.y + h * 0.38);
        ctx.lineTo(cx + w * 0.42, e.y + h * 0.18);
        ctx.lineTo(cx + w * 0.06, e.y + h * 0.32);
        ctx.closePath();
        ctx.fill();
      }

      // ---- swept main wings (shape varies slightly by design) ----
      const wingSweep = { scout: 0.18, fighter: 0.26, interceptor: 0.34, bomber: 0.14,
        ace: 0.3, titan: 0.2, goliath: 0.16, phantom: 0.36, cosmic: 0.28, dreadnought: 0.12 };
      const sweep = wingSweep[e.design] || 0.25;
      ctx.shadowColor = dark;
      ctx.shadowBlur = 14;
      ctx.fillStyle = mid;
      // left wing
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.08, e.y + h * 0.42);
      ctx.lineTo(cx - w * 0.5, e.y - h * sweep);
      ctx.lineTo(cx - w * 0.44, e.y + h * 0.02);
      ctx.lineTo(cx - w * 0.14, e.y + h * 0.44);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(1, w * 0.012);
      ctx.stroke();
      // right wing
      ctx.beginPath();
      ctx.moveTo(cx + w * 0.08, e.y + h * 0.42);
      ctx.lineTo(cx + w * 0.5, e.y - h * sweep);
      ctx.lineTo(cx + w * 0.44, e.y + h * 0.02);
      ctx.lineTo(cx + w * 0.14, e.y + h * 0.44);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // wingtip weapon pods / missiles
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#2a2f3f';
      ctx.beginPath();
      ctx.ellipse(cx - w * 0.46, e.y - h * sweep * 0.85, w * 0.02, w * 0.06, 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + w * 0.46, e.y - h * sweep * 0.85, w * 0.02, w * 0.06, -1.25, 0, Math.PI * 2);
      ctx.fill();

      // ---- fuselage (nose points down toward the hero) ----
      ctx.shadowColor = e.color + 'cc';
      ctx.shadowBlur = 22;
      const bodyGrad = ctx.createLinearGradient(cx - w * 0.22, cy, cx + w * 0.22, cy);
      bodyGrad.addColorStop(0, light);
      bodyGrad.addColorStop(0.5, e.color);
      bodyGrad.addColorStop(1, dark);
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.moveTo(cx, e.y + h);                                    // nose tip (bottom)
      ctx.quadraticCurveTo(cx - w * 0.2, e.y + h * 0.92, cx - w * 0.22, e.y + h * 0.68);
      ctx.lineTo(cx - w * 0.12, e.y + h * 0.22);
      ctx.quadraticCurveTo(cx - w * 0.05, e.y + h * 0.08, cx, e.y + h * 0.06);
      ctx.quadraticCurveTo(cx + w * 0.05, e.y + h * 0.08, cx + w * 0.12, e.y + h * 0.22);
      ctx.lineTo(cx + w * 0.22, e.y + h * 0.68);
      ctx.quadraticCurveTo(cx + w * 0.2, e.y + h * 0.92, cx, e.y + h);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = Math.max(1, w * 0.01);
      ctx.strokeStyle = dark;
      ctx.stroke();

      // panel line detail down the spine
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = Math.max(1, w * 0.006);
      ctx.beginPath();
      ctx.moveTo(cx, e.y + h * 0.15);
      ctx.lineTo(cx, e.y + h * 0.85);
      ctx.stroke();

      // nose cannon
      ctx.shadowColor = '#ffb347';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#4a4f5f';
      ctx.fillRect(cx - w * 0.025, e.y + h - h * 0.06, w * 0.05, h * 0.1);

      // ---- canopy / cockpit glass ----
      ctx.shadowColor = '#bfe9ff';
      ctx.shadowBlur = 16;
      const canopyGrad = ctx.createRadialGradient(
        cx, e.y + h * 0.5, 1, cx, e.y + h * 0.5, w * 0.14
      );
      canopyGrad.addColorStop(0, '#f4fdff');
      canopyGrad.addColorStop(0.5, '#8fd6ff');
      canopyGrad.addColorStop(1, '#2a6f99');
      ctx.fillStyle = canopyGrad;
      ctx.beginPath();
      ctx.ellipse(cx, e.y + h * 0.5, w * 0.11, h * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(1, w * 0.008);
      ctx.stroke();

      // engine intake glow near the tail (top of sprite)
      ctx.shadowColor = e.isFast ? '#ffcc66' : '#ff9955';
      ctx.shadowBlur = e.isFast ? 26 : 14;
      ctx.fillStyle = e.isFast ? '#ffdd88' : '#ffaa66';
      ctx.beginPath();
      ctx.ellipse(cx, e.y + h * 0.14, w * 0.08, h * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;

      // ---- HP bar (above the ship) ----
      if (e.maxHp > 1) {
        ctx.fillStyle = '#151a28';
        ctx.fillRect(e.x, e.y - 12, e.w, 6);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(e.x, e.y - 12, e.w, 6);
        ctx.fillStyle = hpRatio > 0.5 ? '#7fff7f' : hpRatio > 0.25 ? '#ffd25f' : '#ff5f5f';
        ctx.fillRect(e.x + 1, e.y - 11, (e.w - 2) * hpRatio, 4);
      }

      // ---- fast indicator ring ----
      if (e.isFast) {
        ctx.shadowColor = '#ffaa44';
        ctx.shadowBlur = 16;
        ctx.strokeStyle = '#ffaa44';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(w, h) * 0.56, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
      ctx.shadowBlur = 0;
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // background stars
      ctx.shadowBlur = 0;
      for (let i = 0; i < 80; i++) {
        const sx = (i * 137.5 + frame * 0.02) % W;
        const sy = (i * 97.3 + frame * 0.01) % H;
        const r = (i % 3) + 1;
        const bright = 0.3 + (i % 5) * 0.15;
        ctx.fillStyle = `rgba(255,240,200,${bright})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.7, 0, Math.PI*2);
        ctx.fill();
      }

      // ---- enemies ----
      for (const e of enemies) {
        drawEnemy(e);
      }

      // ---- bullets ----
      ctx.shadowColor = '#7fcbff';
      ctx.shadowBlur = 28;
      for (const b of bullets) {
        const grad = ctx.createRadialGradient(b.x, b.y, 2, b.x+4, b.y+2, b.w);
        grad.addColorStop(0, '#ffffaa');
        grad.addColorStop(0.6, '#ffbb44');
        grad.addColorStop(1, '#ff7700');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(b.x + b.w/2, b.y + b.h/2, b.w/2, b.h/2, 0, 0, Math.PI*2);
        ctx.fill();
      }

      // ---- HERO — sci-fi starfighter, nose pointed UP, S-foil style wings ----
      drawHero();

      ctx.shadowBlur = 0;
    }

    function drawHero() {
      const hx = hero.x, hy = hero.y;
      const w = hero.w, h = hero.h;
      const cx = hx + w * 0.5;
      const cy = hy + h * 0.5;

      ctx.save();

      // ===== engine ion trail (behind, pointing down) =====
      ctx.shadowColor = '#5fd0ff';
      ctx.shadowBlur = 55;
      const trailLen = h * 0.55;
      const trailGrad = ctx.createLinearGradient(cx, hy + h * 0.94, cx, hy + h * 0.94 + trailLen);
      trailGrad.addColorStop(0, '#eaffff');
      trailGrad.addColorStop(0.45, '#7fd8ff');
      trailGrad.addColorStop(1, 'rgba(140,220,255,0)');
      ctx.fillStyle = trailGrad;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.1, hy + h * 0.94);
      ctx.lineTo(cx - w * 0.05, hy + h * 0.94 + trailLen);
      ctx.lineTo(cx + w * 0.05, hy + h * 0.94 + trailLen);
      ctx.lineTo(cx + w * 0.1, hy + h * 0.94);
      ctx.closePath();
      ctx.fill();

      // twin engine glow orbs
      ctx.shadowColor = '#ffaa33';
      ctx.shadowBlur = 40;
      ctx.fillStyle = '#ffe3a0';
      ctx.beginPath();
      ctx.ellipse(cx - w * 0.3, hy + h * 0.9, h * 0.06, w * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + w * 0.3, hy + h * 0.9, h * 0.06, w * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();

      // ===== S-foil wings (open X configuration) =====
      ctx.shadowColor = '#3f6f99';
      ctx.shadowBlur = 20;
      const wingGrad = ctx.createLinearGradient(cx - w * 0.5, cy, cx + w * 0.5, cy);
      wingGrad.addColorStop(0, '#d8f0ff');
      wingGrad.addColorStop(0.5, '#7fb8e0');
      wingGrad.addColorStop(1, '#3a6a90');

      function wing(xDir) {
        ctx.fillStyle = wingGrad;
        ctx.beginPath();
        ctx.moveTo(cx + xDir * w * 0.12, hy + h * 0.9);
        ctx.lineTo(cx + xDir * w * 0.58, hy + h * 0.72);
        ctx.lineTo(cx + xDir * w * 0.62, hy + h * 0.9);
        ctx.lineTo(cx + xDir * w * 0.16, hy + h * 0.68);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#1f4a66';
        ctx.lineWidth = Math.max(1, w * 0.012);
        ctx.stroke();
        // wingtip cannon
        ctx.shadowColor = '#ffcf7a';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#33394a';
        ctx.beginPath();
        ctx.ellipse(cx + xDir * w * 0.58, hy + h * 0.78, w * 0.025, w * 0.09, xDir * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffcf7a';
        ctx.beginPath();
        ctx.ellipse(cx + xDir * w * 0.6, hy + h * 0.85, w * 0.012, w * 0.02, xDir * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      wing(-1);
      wing(1);

      // strut connecting wings to fuselage
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#4a7fa8';
      ctx.lineWidth = Math.max(2, w * 0.02);
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.08, hy + h * 0.75);
      ctx.lineTo(cx + w * 0.08, hy + h * 0.75);
      ctx.stroke();

      // ===== main fuselage (nose up) =====
      ctx.shadowColor = '#8fd6ff';
      ctx.shadowBlur = 45;
      const bodyGrad = ctx.createLinearGradient(cx - w * 0.16, cy, cx + w * 0.16, cy);
      bodyGrad.addColorStop(0, '#eef8ff');
      bodyGrad.addColorStop(0.5, '#a9d8ff');
      bodyGrad.addColorStop(1, '#5c93c4');
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.moveTo(cx, hy);                                          // nose tip (top)
      ctx.quadraticCurveTo(cx - w * 0.16, hy + h * 0.12, cx - w * 0.16, hy + h * 0.38);
      ctx.lineTo(cx - w * 0.12, hy + h * 0.72);
      ctx.quadraticCurveTo(cx - w * 0.06, hy + h * 0.86, cx, hy + h * 0.88);
      ctx.quadraticCurveTo(cx + w * 0.06, hy + h * 0.86, cx + w * 0.12, hy + h * 0.72);
      ctx.lineTo(cx + w * 0.16, hy + h * 0.38);
      ctx.quadraticCurveTo(cx + w * 0.16, hy + h * 0.12, cx, hy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3a6a90';
      ctx.lineWidth = Math.max(1, w * 0.01);
      ctx.stroke();

      // nose cone highlight
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.02, hy + h * 0.02);
      ctx.lineTo(cx - w * 0.11, hy + h * 0.3);
      ctx.lineTo(cx - w * 0.06, hy + h * 0.3);
      ctx.closePath();
      ctx.fill();

      // panel lines along the spine
      ctx.strokeStyle = 'rgba(20,50,80,0.3)';
      ctx.lineWidth = Math.max(1, w * 0.006);
      ctx.beginPath();
      ctx.moveTo(cx, hy + h * 0.05);
      ctx.lineTo(cx, hy + h * 0.55);
      ctx.stroke();

      // forward nose cannons (twin blaster tips, matching bullet spawn points)
      ctx.shadowColor = '#ffdd99';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#2c3140';
      ctx.fillRect(hx + w * 0.16 - 3, hy + h * 0.18 - w * 0.14, 6, w * 0.14);
      ctx.fillRect(hx + w * 0.84 - 3, hy + h * 0.18 - w * 0.14, 6, w * 0.14);
      ctx.fillStyle = '#ffe3a0';
      ctx.beginPath();
      ctx.arc(hx + w * 0.16, hy + h * 0.18 - w * 0.18, 3, 0, Math.PI * 2);
      ctx.arc(hx + w * 0.84, hy + h * 0.18 - w * 0.18, 3, 0, Math.PI * 2);
      ctx.fill();

      // barrel struts connecting cannons to the body
      ctx.strokeStyle = '#5c93c4';
      ctx.lineWidth = Math.max(1, w * 0.015);
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.1, hy + h * 0.35);
      ctx.lineTo(hx + w * 0.16, hy + h * 0.18);
      ctx.moveTo(cx + w * 0.1, hy + h * 0.35);
      ctx.lineTo(hx + w * 0.84, hy + h * 0.18);
      ctx.stroke();

      // ===== cockpit canopy =====
      ctx.shadowColor = '#bfe9ff';
      ctx.shadowBlur = 25;
      const canopyGrad = ctx.createRadialGradient(
        cx, hy + h * 0.22, 1, cx, hy + h * 0.2, w * 0.16
      );
      canopyGrad.addColorStop(0, '#ffffff');
      canopyGrad.addColorStop(0.45, '#bfe9ff');
      canopyGrad.addColorStop(1, '#3f7ea8');
      ctx.fillStyle = canopyGrad;
      ctx.beginPath();
      ctx.ellipse(cx, hy + h * 0.22, w * 0.13, h * 0.09, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#22506e';
      ctx.lineWidth = Math.max(1, w * 0.008);
      ctx.stroke();
      // canopy frame line
      ctx.beginPath();
      ctx.moveTo(cx, hy + h * 0.1);
      ctx.lineTo(cx, hy + h * 0.34);
      ctx.stroke();

      // hull identification stripe
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff5f5f';
      ctx.fillRect(cx - w * 0.16, hy + h * 0.06, w * 0.32, h * 0.06);

      // rear main engine glow (big, since ship is bigger now)
      ctx.shadowColor = '#66e0ff';
      ctx.shadowBlur = 60;
      ctx.fillStyle = '#e0fbff';
      ctx.beginPath();
      ctx.ellipse(cx, hy + h * 0.9, w * 0.06, h * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // ---- roundRect polyfill ----
    if (!CanvasRenderingContext2D.prototype.roundRect) {
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radii) {
        const r = typeof radii === 'number' ? radii : (radii || 0);
        this.moveTo(x + r, y);
        this.lineTo(x + w - r, y);
        this.quadraticCurveTo(x + w, y, x + w, y + r);
        this.lineTo(x + w, y + h - r);
        this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.lineTo(x + r, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r);
        this.lineTo(x, y + r);
        this.quadraticCurveTo(x, y, x + r, y);
        this.closePath();
        return this;
      };
    }

    // ----- TOUCH / MOUSE -----
    function handlePointerStart(e) {
      e.preventDefault();
      const t = e.touches ? e.touches[0] : e;
      touchActive = true;
      touchX = t.clientX;
      touchY = t.clientY;
    }
    function handlePointerMove(e) {
      e.preventDefault();
      if (!touchActive) return;
      const t = e.touches ? e.touches[0] : e;
      touchX = t.clientX;
      touchY = t.clientY;
    }
    function handlePointerEnd(e) {
      e.preventDefault();
      touchActive = false;
    }

    canvas.addEventListener('touchstart', handlePointerStart, { passive: false });
    canvas.addEventListener('touchmove', handlePointerMove, { passive: false });
    canvas.addEventListener('touchend', handlePointerEnd, { passive: false });
    canvas.addEventListener('touchcancel', handlePointerEnd, { passive: false });
    canvas.addEventListener('mousedown', handlePointerStart);
    canvas.addEventListener('mousemove', (e) => { if (e.buttons === 1) handlePointerMove(e); });
    canvas.addEventListener('mouseup', handlePointerEnd);
    canvas.addEventListener('mouseleave', handlePointerEnd);

    // ---- DIFFICULTY BUTTONS ----
    document.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const diff = btn.dataset.diff;
        setDifficulty(diff);
      });
    });

    // ---- RESTART ----
    document.getElementById('restart-btn')?.addEventListener('click', resetGame);

    // ---- GAME LOOP ----
    function loop() {
      update();
      draw();
      requestAnimationFrame(loop);
    }

    // Start with menu
    state = STATE.MENU;
    document.getElementById('start-screen').style.display = 'flex';
    loop();

    window.addEventListener('resize', () => {
      resizeCanvas();
      if (state === STATE.MENU || state === STATE.COUNTDOWN) {
        positionHeroDefault();
      }
    });

  })();
</script>
</body>
</html>