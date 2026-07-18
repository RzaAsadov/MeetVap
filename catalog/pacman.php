<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>Pac-Man 3D Style</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            user-select: none;
            -webkit-tap-highlight-color: transparent;
        }
        body {
            background: #0a0f1a;
            overflow: hidden;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            touch-action: none;
            position: fixed;
            width: 100%;
            height: 100%;
            height: 100dvh;
        }
        #gameContainer {
            width: 100vw;
            height: 100vh;
            height: 100dvh;
            position: relative;
            background: #0a0f1a;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        #gameCanvas {
            display: block;
            touch-action: none;
            image-rendering: pixelated;
            max-width: 100vw;
            max-height: 100vh;
            width: auto;
            height: auto;
            aspect-ratio: 1/1;
            background: #0f132b;
            border: 2px solid #2a3070;
            position: relative;
            z-index: 1;
        }
        .ui-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 12px 16px 16px 16px;
            z-index: 10;
        }
        .header {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            pointer-events: auto;
            gap: 12px;
        }
        .score-box {
            background: rgba(11, 15, 40, 0.85);
            padding: 4px 18px;
            border: 2px solid #f5d742;
            color: #fae96f;
            font-weight: 800;
            font-size: 1.4rem;
            letter-spacing: 1px;
            box-shadow: inset 0 0 20px rgba(245, 215, 66, 0.2);
            backdrop-filter: blur(4px);
            font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .status-bar {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            pointer-events: auto;
            color: #d0d9ff;
            font-weight: 600;
            font-size: 1.1rem;
            text-shadow: 0 2px 10px rgba(0,0,0,0.8);
            padding: 0 4px;
        }
        .status-text {
            background: rgba(0,0,0,0.5);
            padding: 3px 14px;
            backdrop-filter: blur(4px);
            border: 1px solid rgba(255,255,255,0.1);
            margin-right: auto;
        }

        /* Start Menu Overlay */
        #startMenu {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 20;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            background: rgba(10, 15, 26, 0.92);
            backdrop-filter: blur(8px);
            pointer-events: auto;
        }
        #startMenu.hidden {
            display: none;
        }
        #startMenu .title {
            font-size: 4rem;
            font-weight: 900;
            color: #f5d742;
            text-shadow: 0 0 40px rgba(245, 215, 66, 0.5), 0 4px 0 #7a6a28;
            margin-bottom: 10px;
            letter-spacing: 4px;
            font-family: 'Segoe UI', system-ui, sans-serif;
        }
        #startMenu .subtitle {
            color: #8a92c0;
            font-size: 1rem;
            margin-bottom: 30px;
            letter-spacing: 2px;
        }
        #startMenu .start-btn {
            background: #f5d742;
            border: none;
            padding: 16px 60px;
            font-size: 1.8rem;
            font-weight: 800;
            color: #0b0e2a;
            cursor: pointer;
            box-shadow: 0 6px 0 #7a6a28;
            transition: 0.08s linear;
            pointer-events: auto;
            border: 2px solid #ffef8f;
            font-family: 'Segoe UI', system-ui, sans-serif;
            letter-spacing: 2px;
            margin-top: 20px;
        }
        #startMenu .start-btn:active {
            transform: translateY(4px);
            box-shadow: 0 2px 0 #7a6a28;
        }
        #startMenu .characters-preview {
            display: flex;
            gap: 30px;
            margin: 20px 0 10px 0;
            font-size: 3.5rem;
            filter: drop-shadow(0 0 20px rgba(245, 215, 66, 0.3));
        }

        /* Game Over Overlay */
        #gameOverMenu {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 15;
            display: none;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            background: rgba(10, 15, 26, 0.85);
            backdrop-filter: blur(6px);
            pointer-events: auto;
        }
        #gameOverMenu.show {
            display: flex;
        }
        #gameOverMenu .result-text {
            font-size: 4rem;
            font-weight: 900;
            color: #f5d742;
            text-shadow: 0 0 40px rgba(245, 215, 66, 0.5), 0 4px 0 #7a6a28;
            margin-bottom: 10px;
        }
        #gameOverMenu .result-text.lose {
            color: #ff4444;
            text-shadow: 0 0 40px rgba(255, 68, 68, 0.5), 0 4px 0 #882222;
        }
        #gameOverMenu .final-score {
            color: #d0d9ff;
            font-size: 1.6rem;
            margin-bottom: 25px;
        }
        #gameOverMenu .restart-btn-big {
            background: #f5d742;
            border: none;
            padding: 20px 70px;
            font-size: 2rem;
            font-weight: 800;
            color: #0b0e2a;
            cursor: pointer;
            box-shadow: 0 6px 0 #7a6a28;
            transition: 0.08s linear;
            pointer-events: auto;
            border: 2px solid #ffef8f;
            font-family: 'Segoe UI', system-ui, sans-serif;
        }
        #gameOverMenu .restart-btn-big:active {
            transform: translateY(4px);
            box-shadow: 0 2px 0 #7a6a28;
        }

        @media (max-width: 480px) {
            .score-box { font-size: 1.1rem; padding: 3px 12px; }
            .status-bar { font-size: 0.85rem; }
            .ui-overlay { padding: 8px 10px 10px 10px; }
            #startMenu .title { font-size: 2.8rem; }
            #startMenu .start-btn { padding: 14px 40px; font-size: 1.4rem; }
            #startMenu .characters-preview { font-size: 2.5rem; gap: 20px; }
            #gameOverMenu .result-text { font-size: 2.8rem; }
            #gameOverMenu .restart-btn-big { padding: 16px 50px; font-size: 1.6rem; }
        }
        @media (orientation: landscape) and (max-height: 500px) {
            .ui-overlay { padding: 6px 12px 8px 12px; }
            .score-box { font-size: 1rem; padding: 2px 10px; }
            .status-bar { font-size: 0.8rem; }
            #startMenu .title { font-size: 2.2rem; }
            #startMenu .start-btn { padding: 10px 30px; font-size: 1.2rem; }
            #startMenu .characters-preview { font-size: 2rem; gap: 15px; }
            #gameOverMenu .result-text { font-size: 2.2rem; }
            #gameOverMenu .restart-btn-big { padding: 12px 40px; font-size: 1.3rem; }
        }
    </style>
</head>
<body>
<div id="gameContainer">
    <canvas id="gameCanvas"></canvas>
    
    <!-- Start Menu -->
    <div id="startMenu">
        <div class="title">PAC-MAN</div>
        <div class="subtitle">▼ SWIPE OR ARROW KEYS ▼</div>
        <div class="characters-preview">
            <span>🟡</span>
            <span style="color:#ff3b3b;">👻</span>
            <span style="color:#ffb8ff;">👻</span>
            <span style="color:#3bc7ff;">👻</span>
            <span style="color:#f5a342;">👻</span>
        </div>
        <button class="start-btn" id="startBtn">▶ START</button>
    </div>

    <!-- Game Over Menu -->
    <div id="gameOverMenu">
        <div class="result-text" id="resultText">💀 GAME OVER</div>
        <div class="final-score" id="finalScore">Score: 0</div>
        <button class="restart-btn-big" id="restartBtnBig">↻ PLAY AGAIN</button>
    </div>

    <div class="ui-overlay">
        <div class="header">
            <div class="score-box" id="scoreDisplay">0</div>
        </div>
        <div class="status-bar">
            <span class="status-text" id="gameStatusText">▶ PLAY</span>
        </div>
    </div>
</div>

<script>
(function() {
    // ----- Audio Engine -----
    let audioCtx = null;
    let soundEnabled = true;

    function initAudio() {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch(e) {
                soundEnabled = false;
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playTone(freq, duration, type, volume) {
        if (!soundEnabled || !audioCtx) return;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type || 'square';
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            gain.gain.setValueAtTime(volume || 0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch(e) { /* silently fail */ }
    }

    function soundChomp() {
        playTone(600, 0.08, 'square', 0.12);
        setTimeout(() => playTone(400, 0.08, 'square', 0.10), 60);
    }

    function soundPowerPellet() {
        playTone(300, 0.15, 'sawtooth', 0.15);
        setTimeout(() => playTone(500, 0.15, 'sawtooth', 0.12), 120);
        setTimeout(() => playTone(700, 0.2, 'sawtooth', 0.10), 240);
    }

    function soundDeath() {
        playTone(500, 0.15, 'sawtooth', 0.20);
        setTimeout(() => playTone(400, 0.15, 'sawtooth', 0.18), 150);
        setTimeout(() => playTone(300, 0.15, 'sawtooth', 0.16), 300);
        setTimeout(() => playTone(200, 0.3, 'sawtooth', 0.14), 450);
    }

    function soundWin() {
        playTone(523, 0.15, 'square', 0.12);
        setTimeout(() => playTone(659, 0.15, 'square', 0.12), 150);
        setTimeout(() => playTone(784, 0.2, 'square', 0.14), 300);
    }

    function soundEatFruit() {
        playTone(880, 0.1, 'sine', 0.15);
        setTimeout(() => playTone(1100, 0.1, 'sine', 0.12), 100);
        setTimeout(() => playTone(1320, 0.15, 'sine', 0.10), 200);
    }

    // ----- i18n -----
    const LANG = {
        en: { status_play: '▶ PLAY', status_win: '🏆 YOU WIN!', status_lose: '💀 GAME OVER' },
        tr: { status_play: '▶ OYNA', status_win: '🏆 KAZANDIN!', status_lose: '💀 OYUN BİTTİ' },
        ru: { status_play: '▶ ИГРА', status_win: '🏆 ПОБЕДА!', status_lose: '💀 ИГРА ОКОНЧЕНА' }
    };
    let currentLang = 'en';

    // ----- DOM refs -----
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const scoreDisplay = document.getElementById('scoreDisplay');
    const statusText = document.getElementById('gameStatusText');
    const container = document.getElementById('gameContainer');
    const startMenu = document.getElementById('startMenu');
    const startBtn = document.getElementById('startBtn');
    const gameOverMenu = document.getElementById('gameOverMenu');
    const resultText = document.getElementById('resultText');
    const finalScore = document.getElementById('finalScore');
    const restartBtnBig = document.getElementById('restartBtnBig');

    // ----- Canvas sizing -----
    function resizeCanvas() {
        const containerRect = container.getBoundingClientRect();
        const size = Math.min(containerRect.width, containerRect.height);
        canvas.width = size;
        canvas.height = size;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ----- Game constants -----
    const COLS = 15;
    const ROWS = 15;
    let CELL_SIZE = 0;

    const MAZE_TEMPLATE = [
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
        [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
        [1,0,1,1,0,1,1,1,1,1,0,1,1,0,1],
        [1,0,1,1,0,1,0,0,0,1,0,1,1,0,1],
        [1,0,1,1,0,1,0,1,0,1,0,1,1,0,1],
        [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1],
        [1,0,1,1,0,1,0,1,0,1,0,1,1,0,1],
        [1,0,1,1,0,1,0,0,0,1,0,1,1,0,1],
        [1,0,1,1,0,1,1,1,1,1,0,1,1,0,1],
        [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
        [1,0,1,1,0,1,0,0,0,1,0,1,1,0,1],
        [1,0,1,1,0,1,0,1,0,1,0,1,1,0,1],
        [1,0,1,1,0,1,0,1,0,1,0,1,1,0,1],
        [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
        [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
    ];

    // ----- Game state -----
    let maze = [];
    let pacman = { x: 7, y: 7, dir: 0, nextDir: 0 };
    let ghosts = [];
    let score = 0;
    let totalDots = 0;
    let gameActive = false;
    let gameWin = false;
    let gameOver = false;
    let animationId = null;
    let frameCounter = 0;
    let pendingDirection = -1;
    let gameStartDelay = 0;
    const START_DELAY = 60;

    // Fruit system
    let fruits = [];
    const FRUIT_TYPES = ['apple', 'pineapple'];
    const MAX_FRUITS = 2;
    let fruitSpawnTimer = 0;
    const FRUIT_SPAWN_INTERVAL = 300;

    // Blink state
    let blinkActive = false;
    let blinkTimer = 0;
    const BLINK_DURATION = 600;
    const RESPAWN_DELAY = 900;

    const PACMAN_SPEED = 20;
    const GHOST_SPEED = 32;

    // touch
    let touchStartX = 0, touchStartY = 0;

    // ----- Helper functions -----
    function countDots(mazeData) {
        let cnt = 0;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (mazeData[r][c] === 0 || mazeData[r][c] === 3) cnt++;
            }
        }
        return cnt;
    }

    function canMove(x, y) {
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
        return maze[y][x] !== 1;
    }

    function getCellSize() {
        return canvas.width / COLS;
    }

    // ----- Drawing functions -----
    function drawWall(x, y, size) {
        const padding = 2;
        const xPos = x * size + padding;
        const yPos = y * size + padding;
        const w = size - padding * 2;
        const h = size - padding * 2;
        
        const grad = ctx.createLinearGradient(xPos, yPos, xPos + w, yPos + h);
        grad.addColorStop(0, '#3a4080');
        grad.addColorStop(0.5, '#2a3070');
        grad.addColorStop(1, '#1a2060');
        ctx.fillStyle = grad;
        ctx.shadowColor = '#5a62a0';
        ctx.shadowBlur = 8;
        ctx.fillRect(xPos, yPos, w, h);
        ctx.shadowBlur = 0;
        
        ctx.strokeStyle = '#4a5290';
        ctx.lineWidth = 1;
        ctx.strokeRect(xPos + 1, yPos + 1, w - 2, h - 2);
        
        ctx.fillStyle = 'rgba(100,120,200,0.1)';
        ctx.fillRect(xPos + 4, yPos + 4, w - 8, h - 8);
    }

    function drawDot(x, y, size) {
        const cx = x * size + size/2;
        const cy = y * size + size/2;
        const radius = size * 0.08;
        
        const grad = ctx.createRadialGradient(cx - radius*0.3, cy - radius*0.3, 0, cx, cy, radius);
        grad.addColorStop(0, '#fff5a0');
        grad.addColorStop(0.5, '#f5e56b');
        grad.addColorStop(1, '#d4b830');
        ctx.fillStyle = grad;
        ctx.shadowColor = '#f5e56b';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    function drawPowerPellet(x, y, size) {
        const cx = x * size + size/2;
        const cy = y * size + size/2;
        const radius = size * 0.18;
        
        const grad = ctx.createRadialGradient(cx - radius*0.3, cy - radius*0.3, 0, cx, cy, radius);
        grad.addColorStop(0, '#ffdd88');
        grad.addColorStop(0.3, '#f5b342');
        grad.addColorStop(1, '#d4902a');
        ctx.fillStyle = grad;
        ctx.shadowColor = '#f5b342';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        const pulse = 0.5 + 0.5 * Math.sin(frameCounter * 0.05);
        ctx.fillStyle = `rgba(255,220,100,${pulse * 0.3})`;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 1.4, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawPacman(x, y, dir, size, mouthOpen) {
        const cx = x * size + size/2;
        const cy = y * size + size/2;
        const radius = size * 0.35;
        
        let angle = 0;
        if (dir === 0) angle = 0;
        else if (dir === 1) angle = Math.PI/2;
        else if (dir === 2) angle = Math.PI;
        else if (dir === 3) angle = -Math.PI/2;
        
        const mouth = 0.25 + 0.25 * mouthOpen;
        
        ctx.shadowColor = '#f5d742';
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, angle + mouth, angle + 2*Math.PI - mouth);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        
        const grad = ctx.createRadialGradient(cx - radius*0.3, cy - radius*0.3, 0, cx, cy, radius);
        grad.addColorStop(0, '#ffee88');
        grad.addColorStop(0.5, '#f5d742');
        grad.addColorStop(1, '#d4b830');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.shadowBlur = 0;
        
        const eyeX = cx + Math.cos(angle - 0.5) * radius * 0.35;
        const eyeY = cy + Math.sin(angle - 0.5) * radius * 0.35;
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(eyeX, eyeY, radius * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a2060';
        ctx.beginPath();
        ctx.arc(eyeX + radius * 0.05, eyeY - radius * 0.02, radius * 0.06, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawGhost(x, y, color, size, scared, visible) {
        if (!visible) return;
        
        const cx = x * size + size/2;
        const cy = y * size + size/2;
        const radius = size * 0.3;
        
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
        
        const grad = ctx.createRadialGradient(cx - radius*0.3, cy - radius*0.3, 0, cx, cy, radius);
        if (scared) {
            grad.addColorStop(0, '#88bbff');
            grad.addColorStop(0.7, '#4488dd');
            grad.addColorStop(1, '#2266bb');
        } else {
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.3, color);
            grad.addColorStop(1, color);
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy - radius * 0.1, radius, Math.PI, 0);
        ctx.lineTo(cx + radius, cy + radius * 0.6);
        const waveCount = 4;
        for (let i = 0; i < waveCount; i++) {
            const wx = cx + radius - i * (radius * 2 / waveCount);
            const wy = cy + radius * 0.6 + ((i % 2 === 0) ? radius * 0.15 : -radius * 0.15);
            ctx.quadraticCurveTo(wx - radius / waveCount, wy, wx - radius * 2 / waveCount, cy + radius * 0.6);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        
        if (!scared) {
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(cx - radius * 0.25, cy - radius * 0.1, radius * 0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx + radius * 0.25, cy - radius * 0.1, radius * 0.2, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#1a2060';
            ctx.beginPath();
            ctx.arc(cx - radius * 0.3, cy - radius * 0.05, radius * 0.1, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx + radius * 0.2, cy - radius * 0.05, radius * 0.1, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            const ex = radius * 0.15;
            const ey = radius * 0.08;
            [-1, 1].forEach(m => {
                ctx.beginPath();
                ctx.moveTo(cx + m * ex - ey, cy - ey);
                ctx.lineTo(cx + m * ex + ey, cy + ey);
                ctx.moveTo(cx + m * ex + ey, cy - ey);
                ctx.lineTo(cx + m * ex - ey, cy + ey);
                ctx.stroke();
            });
        }
    }

    function drawFruit(x, y, type, size, visible) {
        if (!visible) return;
        
        const cx = x * size + size/2;
        const cy = y * size + size/2;
        const radius = size * 0.22;
        
        let color1, color2;
        if (type === 'apple') {
            color1 = '#ff4444';
            color2 = '#cc2222';
        } else {
            color1 = '#f5a342';
            color2 = '#d4882a';
        }
        
        ctx.shadowColor = color1;
        ctx.shadowBlur = 25;
        
        const grad = ctx.createRadialGradient(cx - radius*0.3, cy - radius*0.3, 0, cx, cy, radius);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, color1);
        grad.addColorStop(1, color2);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        ctx.fillStyle = '#44dd44';
        ctx.beginPath();
        ctx.ellipse(cx + radius * 0.1, cy - radius * 0.8, radius * 0.3, radius * 0.15, 0.5, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = '#228822';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + radius * 0.05, cy - radius * 0.7);
        ctx.lineTo(cx + radius * 0.2, cy - radius * 1.0);
        ctx.stroke();
    }

    // ----- Game logic -----
    function initGhosts() {
        const ghostData = [
            { x: 1, y: 1, color: '#ff3b3b' },
            { x: 13, y: 1, color: '#ffb8ff' },
            { x: 1, y: 13, color: '#3bc7ff' },
            { x: 13, y: 13, color: '#f5a342' }
        ];
        return ghostData.map((data, i) => ({
            x: data.x,
            y: data.y,
            color: data.color,
            scatter: false,
            eaten: false,
            respawnTimer: 0,
            targetX: data.x,
            targetY: data.y,
            index: i
        }));
    }

    function resetGame() {
        initAudio();
        maze = MAZE_TEMPLATE.map(row => [...row]);
        totalDots = countDots(maze);
        pacman = { x: 7, y: 7, dir: 0, nextDir: 0 };
        ghosts = initGhosts();
        score = 0;
        gameWin = false;
        gameOver = false;
        gameActive = true;
        frameCounter = 0;
        pendingDirection = -1;
        blinkActive = false;
        blinkTimer = 0;
        fruits = [];
        fruitSpawnTimer = 0;
        gameStartDelay = START_DELAY;
        updateScoreDisplay();
        updateStatusText();
        gameOverMenu.classList.remove('show');
    }

    function spawnFruit() {
        if (!gameActive || gameOver || gameWin) return;
        
        const activeFruits = fruits.filter(f => f.active);
        if (activeFruits.length >= MAX_FRUITS) return;

        let attempts = 0;
        while (attempts < 50) {
            const x = Math.floor(Math.random() * (COLS - 2)) + 1;
            const y = Math.floor(Math.random() * (ROWS - 2)) + 1;
            if (maze[y][x] === 0 || maze[y][x] === 2) {
                if (x === pacman.x && y === pacman.y) continue;
                let onGhost = false;
                for (let g of ghosts) {
                    if (g.x === x && g.y === y && !g.eaten) { onGhost = true; break; }
                }
                if (onGhost) continue;
                if (fruits.some(f => f.x === x && f.y === y && f.active)) continue;

                const type = FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
                fruits.push({ x, y, type, active: true });
                break;
            }
            attempts++;
        }
    }

    function eatFruit(fruit) {
        fruit.active = false;
        score += 100;
        updateScoreDisplay();
        soundEatFruit();
        
        blinkActive = true;
        blinkTimer = BLINK_DURATION;
        
        ghosts.forEach(g => {
            if (!g.eaten) {
                g.scatter = true;
            }
        });
    }

    function eatDotAt(x, y) {
        // Check fruits first (fixes fruit eating bug)
        for (let f of fruits) {
            if (f.x === x && f.y === y && f.active) {
                eatFruit(f);
                return true;
            }
        }
        
        if (maze[y][x] === 0) {
            maze[y][x] = 2;
            score += 10;
            totalDots--;
            updateScoreDisplay();
            soundChomp();
            return true;
        } else if (maze[y][x] === 3) {
            maze[y][x] = 2;
            score += 50;
            totalDots--;
            updateScoreDisplay();
            soundPowerPellet();
            ghosts.forEach(g => {
                if (!g.eaten) g.scatter = true;
            });
            return true;
        }
        return false;
    }

    function checkGhostCollision() {
        for (let g of ghosts) {
            if (g.eaten) continue;
            if (g.x === pacman.x && g.y === pacman.y) {
                if (g.scatter && blinkActive) {
                    g.eaten = true;
                    g.respawnTimer = RESPAWN_DELAY;
                    score += 200;
                    updateScoreDisplay();
                    soundChomp();
                } else if (!g.scatter || !blinkActive) {
                    gameActive = false;
                    gameOver = true;
                    updateStatusText();
                    soundDeath();
                    showGameOver(false);
                }
            }
        }
    }

    function movePacman() {
        if (!gameActive || gameOver || gameWin) return;

        // Try pending direction first (always allow if possible)
        if (pendingDirection !== -1) {
            let dx = 0, dy = 0;
            if (pendingDirection === 0) dx = 1;
            else if (pendingDirection === 1) dy = 1;
            else if (pendingDirection === 2) dx = -1;
            else if (pendingDirection === 3) dy = -1;
            
            let newX = pacman.x + dx;
            let newY = pacman.y + dy;
            
            if (canMove(newX, newY)) {
                pacman.dir = pendingDirection;
                pacman.x = newX;
                pacman.y = newY;
                pendingDirection = -1;
                eatDotAt(newX, newY);
                checkGhostCollision();
                return;
            }
        }

        // Move in current direction
        let dx = 0, dy = 0;
        if (pacman.dir === 0) dx = 1;
        else if (pacman.dir === 1) dy = 1;
        else if (pacman.dir === 2) dx = -1;
        else if (pacman.dir === 3) dy = -1;
        let newX = pacman.x + dx;
        let newY = pacman.y + dy;
        if (canMove(newX, newY)) {
            pacman.x = newX;
            pacman.y = newY;
            eatDotAt(newX, newY);
            checkGhostCollision();
        } else if (pendingDirection !== -1) {
            // Try pending direction again if current is blocked
            let pdx = 0, pdy = 0;
            if (pendingDirection === 0) pdx = 1;
            else if (pendingDirection === 1) pdy = 1;
            else if (pendingDirection === 2) pdx = -1;
            else if (pendingDirection === 3) pdy = -1;
            let pnewX = pacman.x + pdx;
            let pnewY = pacman.y + pdy;
            if (canMove(pnewX, pnewY)) {
                pacman.dir = pendingDirection;
                pacman.x = pnewX;
                pacman.y = pnewY;
                pendingDirection = -1;
                eatDotAt(pnewX, pnewY);
                checkGhostCollision();
            }
        }

        if (totalDots === 0 && gameActive) {
            gameActive = false;
            gameWin = true;
            updateStatusText();
            soundWin();
            showGameOver(true);
        }
    }

    function moveGhosts() {
        if (!gameActive || gameOver || gameWin) return;
        
        if (gameStartDelay > 0) {
            gameStartDelay--;
            return;
        }
        
        for (let i = 0; i < ghosts.length; i++) {
            const g = ghosts[i];
            if (g.eaten) {
                g.respawnTimer--;
                if (g.respawnTimer <= 0) {
                    g.eaten = false;
                    g.x = g.targetX || 1;
                    g.y = g.targetY || 1;
                    g.scatter = false;
                }
                continue;
            }

            if (frameCounter % GHOST_SPEED === 0) {
                let dirs = [0, 1, 2, 3];
                if (g.scatter && blinkActive) {
                    let tries = 0;
                    while (tries < 10) {
                        let d = dirs[Math.floor(Math.random() * dirs.length)];
                        let dx = 0, dy = 0;
                        if (d === 0) dx = 1;
                        else if (d === 1) dy = 1;
                        else if (d === 2) dx = -1;
                        else if (d === 3) dy = -1;
                        let nx = g.x + dx, ny = g.y + dy;
                        if (canMove(nx, ny)) {
                            g.x = nx;
                            g.y = ny;
                            break;
                        }
                        tries++;
                    }
                } else {
                    let bestDir = 0;
                    let bestDist = Infinity;
                    for (let d of dirs) {
                        let dx = 0, dy = 0;
                        if (d === 0) dx = 1;
                        else if (d === 1) dy = 1;
                        else if (d === 2) dx = -1;
                        else if (d === 3) dy = -1;
                        let nx = g.x + dx, ny = g.y + dy;
                        if (canMove(nx, ny)) {
                            let dist = (nx - pacman.x)**2 + (ny - pacman.y)**2;
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestDir = d;
                            }
                        }
                    }
                    let dx = 0, dy = 0;
                    if (bestDir === 0) dx = 1;
                    else if (bestDir === 1) dy = 1;
                    else if (bestDir === 2) dx = -1;
                    else if (bestDir === 3) dy = -1;
                    let nx = g.x + dx, ny = g.y + dy;
                    if (canMove(nx, ny)) {
                        g.x = nx;
                        g.y = ny;
                    }
                }
            }
        }
        
        for (let g of ghosts) {
            if (g.eaten) continue;
            if (g.x === pacman.x && g.y === pacman.y) {
                if (g.scatter && blinkActive) {
                    g.eaten = true;
                    g.respawnTimer = RESPAWN_DELAY;
                    score += 200;
                    updateScoreDisplay();
                    soundChomp();
                } else if (!g.scatter || !blinkActive) {
                    gameActive = false;
                    gameOver = true;
                    updateStatusText();
                    soundDeath();
                    showGameOver(false);
                }
            }
        }
    }

    function updateBlink() {
        if (blinkActive) {
            blinkTimer--;
            if (blinkTimer <= 0) {
                blinkActive = false;
                ghosts.forEach(g => {
                    if (!g.eaten) g.scatter = false;
                });
            }
        }
    }

    function showGameOver(win) {
        gameOverMenu.classList.add('show');
        if (win) {
            resultText.textContent = '🏆 YOU WIN!';
            resultText.className = 'result-text';
        } else {
            resultText.textContent = '💀 GAME OVER';
            resultText.className = 'result-text lose';
        }
        finalScore.textContent = 'Score: ' + score;
    }

    // ----- Render -----
    function render() {
        const size = getCellSize();
        CELL_SIZE = size;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const bgGrad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, canvas.width/2);
        bgGrad.addColorStop(0, '#1a2050');
        bgGrad.addColorStop(1, '#0a0f1a');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const val = maze[r][c];
                if (val === 1) {
                    drawWall(c, r, size);
                } else if (val === 0) {
                    drawDot(c, r, size);
                } else if (val === 3) {
                    drawPowerPellet(c, r, size);
                }
            }
        }
        
        for (let f of fruits) {
            if (f.active) {
                drawFruit(f.x, f.y, f.type, size, true);
            }
        }
        
        for (let g of ghosts) {
            if (g.eaten) continue;
            const scared = g.scatter && blinkActive;
            const visible = !g.eaten;
            if (scared && blinkActive) {
                const blinkOn = Math.floor(blinkTimer / 15) % 2 === 0;
                if (blinkOn) {
                    drawGhost(g.x, g.y, g.color, size, true, visible);
                }
            } else {
                drawGhost(g.x, g.y, g.color, size, false, visible);
            }
        }
        
        const mouthOpen = 0.5 + 0.5 * Math.sin(frameCounter * 0.15);
        drawPacman(pacman.x, pacman.y, pacman.dir, size, mouthOpen);
    }

    // ----- UI -----
    function updateScoreDisplay() {
        scoreDisplay.textContent = score;
    }

    function updateStatusText() {
        const t = LANG[currentLang];
        if (gameWin) statusText.textContent = t.status_win;
        else if (gameOver) statusText.textContent = t.status_lose;
        else statusText.textContent = t.status_play;
    }

    // ----- Game loop -----
    function gameLoop() {
        if (gameActive) {
            frameCounter++;
            
            fruitSpawnTimer++;
            if (fruitSpawnTimer >= FRUIT_SPAWN_INTERVAL) {
                fruitSpawnTimer = 0;
                spawnFruit();
            }

            if (frameCounter % PACMAN_SPEED === 0) {
                movePacman();
            }

            moveGhosts();
            updateBlink();

            if (totalDots === 0 && gameActive) {
                gameActive = false;
                gameWin = true;
                updateStatusText();
                soundWin();
                showGameOver(true);
            }
        }

        render();
        animationId = requestAnimationFrame(gameLoop);
    }

    // ----- Touch controls -----
    function handleTouchStart(e) {
        e.preventDefault();
        initAudio();
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }

    function handleTouchMove(e) {
        e.preventDefault();
        if (!gameActive || gameOver || gameWin) return;
        
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        if (Math.abs(dx) < 15 && Math.abs(dy) < 15) return;
        
        let newDir = pacman.dir;
        if (Math.abs(dx) > Math.abs(dy)) {
            newDir = dx > 0 ? 0 : 2;
        } else {
            newDir = dy > 0 ? 1 : 3;
        }
        
        // Always allow direction change if it's not the same
        if (newDir !== pacman.dir) {
            pendingDirection = newDir;
        }
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }

    function handleTouchEnd(e) {
        e.preventDefault();
    }

    // ----- Keyboard controls -----
    function handleKeydown(e) {
        if (!gameActive || gameOver || gameWin) return;
        const key = e.key;
        let newDir = -1;
        if (key === 'ArrowRight') newDir = 0;
        else if (key === 'ArrowDown') newDir = 1;
        else if (key === 'ArrowLeft') newDir = 2;
        else if (key === 'ArrowUp') newDir = 3;
        if (newDir === -1) return;
        e.preventDefault();
        
        if (newDir !== pacman.dir) {
            pendingDirection = newDir;
        }
    }

    // ----- Language (URL) -----
    function setLanguage(lang) {
        if (LANG[lang]) {
            currentLang = lang;
            updateStatusText();
        }
    }

    function initLangFromURL() {
        const params = new URLSearchParams(window.location.search);
        const lang = params.get('lang') || 'en';
        setLanguage(lang);
    }

    // ----- Start game -----
    function startGame() {
        startMenu.classList.add('hidden');
        initAudio();
        resetGame();
    }

    // ----- Init -----
    function init() {
        initLangFromURL();
        initAudio();
        
        // Show start menu, don't start game yet
        startMenu.classList.remove('hidden');
        gameOverMenu.classList.remove('show');
        
        // Event listeners
        startBtn.addEventListener('click', startGame);
        restartBtnBig.addEventListener('click', startGame);
        
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
        document.addEventListener('keydown', handleKeydown);
        window.addEventListener('resize', resizeCanvas);
        document.addEventListener('click', initAudio);
        document.addEventListener('touchstart', initAudio, { once: true });

        // Initial render with maze but no game
        maze = MAZE_TEMPLATE.map(row => [...row]);
        totalDots = countDots(maze);
        pacman = { x: 7, y: 7, dir: 0, nextDir: 0 };
        ghosts = initGhosts();
        score = 0;
        gameActive = false;
        frameCounter = 0;
        updateScoreDisplay();
        updateStatusText();
        
        gameLoop();
    }

    init();
})();
</script>
</body>
</html>