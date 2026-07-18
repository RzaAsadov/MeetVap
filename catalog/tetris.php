<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>MeetRis · Tetris</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,600;14..32,800;14..32,900&display=swap" rel="stylesheet">
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
            overflow: hidden;
            background: #0b0e1a;
            font-family: 'Inter', sans-serif;
            touch-action: none;
        }
        .game-wrapper {
            width: 100vw;
            height: 100vh;
            height: 100dvh;
            background: #0f1422;
            display: flex;
            flex-direction: column;
            padding: 6px 8px 8px 8px;
            overflow: hidden;
            position: relative;
        }
        /* ----- START MENU (overlay) ----- */
        .start-menu {
            position: absolute;
            inset: 0;
            background: rgba(11, 14, 26, 0.88);
            backdrop-filter: blur(12px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 20;
            padding: 20px;
            transition: opacity 0.5s ease, visibility 0.5s ease;
            visibility: visible;
            opacity: 1;
        }
        .start-menu.hidden {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
        }
        .start-menu .logo-big {
            font-weight: 900;
            font-size: 4.2rem;
            background: linear-gradient(135deg, #f7d875, #f5b042, #f28b3a);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            letter-spacing: -1px;
            text-shadow: 0 8px 32px rgba(245, 176, 66, 0.3);
            margin-bottom: 8px;
            line-height: 1;
        }
        .start-menu .sub {
            color: #8e9ac9;
            font-weight: 600;
            font-size: 1rem;
            letter-spacing: 4px;
            text-transform: uppercase;
            margin-bottom: 32px;
            opacity: 0.7;
        }
        .start-menu .start-btn {
            background: linear-gradient(135deg, #f5b042, #f28b3a);
            border: none;
            padding: 16px 48px;
            border-radius: 60px;
            font-weight: 800;
            font-size: 1.4rem;
            color: #0b0e1a;
            box-shadow: 0 8px 0 #8f4d1a, 0 12px 40px rgba(245, 176, 66, 0.3);
            transition: all 0.08s ease;
            cursor: pointer;
            touch-action: manipulation;
            font-family: 'Inter', sans-serif;
            letter-spacing: 1px;
            border: 1px solid rgba(255,255,255,0.15);
        }
        .start-menu .start-btn:active {
            transform: translateY(6px);
            box-shadow: 0 2px 0 #8f4d1a, 0 12px 40px rgba(245, 176, 66, 0.2);
        }
        .start-menu .start-btn:hover {
            transform: scale(1.02);
        }
        .start-menu .preview-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            margin-bottom: 28px;
            background: rgba(255,255,255,0.03);
            padding: 12px 20px;
            border-radius: 60px;
            border: 1px solid rgba(255,255,255,0.04);
        }
        .start-menu .preview-grid span {
            display: block;
            width: 28px;
            height: 28px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .start-menu .credit {
            position: absolute;
            bottom: 28px;
            color: #3f486b;
            font-size: 0.7rem;
            letter-spacing: 2px;
            font-weight: 600;
        }
        /* ----- HEADER ----- */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 4px 4px 4px;
            flex-shrink: 0;
        }
        .logo {
            font-weight: 900;
            font-size: 1.6rem;
            background: linear-gradient(135deg, #f7d875, #f5b042);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            letter-spacing: -0.5px;
            text-shadow: 0 2px 12px rgba(245, 176, 66, 0.25);
        }
        .game-main {
            flex: 1 1 auto;
            display: flex;
            flex-direction: row;
            gap: 10px;
            min-height: 0;
            padding-bottom: 4px;
        }
        .board-container {
            flex: 1 1 auto;
            background: #111624;
            padding: 6px;
            box-shadow: inset 0 -4px 0 #070a12, 0 8px 20px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 0;
        }
        #tetrisCanvas {
            display: block;
            width: 100%;
            height: 100%;
            aspect-ratio: 10 / 20;
            background: #0e121f;
            image-rendering: crisp-edges;
            touch-action: none;
            cursor: pointer;
            max-width: 100%;
            max-height: 100%;
        }
        .bottom-panel {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(16, 21, 36, 0.6);
            backdrop-filter: blur(4px);
            padding: 8px 12px;
            border-top: 1px solid rgba(255,255,255,0.04);
            gap: 10px;
            flex-wrap: nowrap;
            margin-top: 2px;
        }
        .stats {
            display: flex;
            align-items: center;
            gap: 20px;
            flex: 1 1 auto;
            min-width: 0;
        }
        .stat-item {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            white-space: nowrap;
        }
        .stat-label {
            font-size: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #6e7aa3;
            font-weight: 600;
            line-height: 1;
        }
        .stat-value {
            font-size: 1.2rem;
            font-weight: 800;
            color: #eef3ff;
            line-height: 1.2;
        }
        .stat-value.score-val {
            background: linear-gradient(135deg, #f5d78c, #f5b042);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }
        .next-mini {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
        }
        .next-mini .stat-label {
            font-size: 0.5rem;
        }
        #nextCanvas {
            width: 48px;
            height: 48px;
            background: #0b0f1a;
            image-rendering: crisp-edges;
            flex-shrink: 0;
        }
        .drop-btn-area {
            flex-shrink: 0;
            margin-left: 4px;
        }
        .ctrl-btn {
            background: rgba(239, 68, 68, 0.25);
            border: none;
            border-radius: 40px;
            padding: 10px 20px;
            font-size: 1.2rem;
            font-weight: 800;
            color: #fca5a5;
            backdrop-filter: blur(4px);
            box-shadow: 0 4px 0 #5f1a1a, 0 6px 16px rgba(0,0,0,0.4);
            transition: all 0.06s ease;
            touch-action: manipulation;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            border: 1px solid rgba(255,255,255,0.06);
            font-family: 'Inter', sans-serif;
            letter-spacing: 1px;
            min-width: 70px;
        }
        .ctrl-btn:active {
            transform: translateY(4px);
            box-shadow: 0 0px 0 #5f1a1a, 0 4px 12px rgba(0,0,0,0.5);
        }
        @media (max-width: 600px) {
            .game-wrapper { padding: 4px 4px 4px 4px; }
            .logo { font-size: 1.3rem; }
            .stat-value { font-size: 1rem; }
            #nextCanvas { width: 38px; height: 38px; }
            .ctrl-btn { padding: 8px 14px; font-size: 1rem; min-width: 56px; }
            .stats { gap: 12px; }
            .start-menu .logo-big { font-size: 3rem; }
            .start-menu .preview-grid span { width: 22px; height: 22px; }
        }
        @media (max-width: 420px) {
            .logo { font-size: 1.1rem; }
            .stat-value { font-size: 0.85rem; }
            .stat-label { font-size: 0.4rem; }
            #nextCanvas { width: 32px; height: 32px; }
            .ctrl-btn { padding: 6px 10px; font-size: 0.85rem; min-width: 44px; }
            .stats { gap: 8px; }
            .bottom-panel { padding: 4px 8px; }
            .start-menu .logo-big { font-size: 2.4rem; }
            .start-menu .preview-grid span { width: 18px; height: 18px; }
        }
        @media (max-width: 360px) {
            .logo { font-size: 0.95rem; }
            .stat-value { font-size: 0.7rem; }
            #nextCanvas { width: 28px; height: 28px; }
            .ctrl-btn { padding: 4px 8px; font-size: 0.7rem; min-width: 34px; }
            .stats { gap: 4px; }
            .start-menu .logo-big { font-size: 2rem; }
        }
        /* no rounded corners except start btn */
        .game-wrapper, .board-container, #tetrisCanvas, .bottom-panel, .next-mini, #nextCanvas, .ctrl-btn {
            border-radius: 0 !important;
        }
        .start-menu .start-btn {
            border-radius: 60px !important;
        }
    </style>
</head>
<body>
<div class="game-wrapper" id="app">
    <!-- START MENU -->
    <div class="start-menu" id="startMenu">
        <div class="logo-big">◈ MeetRis</div>
        <div class="sub">Classic · Tetris</div>
        <div class="preview-grid">
            <span style="background:#3cc7f2;"></span>
            <span style="background:#f7d44a;"></span>
            <span style="background:#b484e0;"></span>
            <span style="background:#6fcf97;"></span>
            <span style="background:#e66767;"></span>
            <span style="background:#f5a97f;"></span>
            <span style="background:#6a9cf5;"></span>
            <span style="background:#f5b042;"></span>
        </div>
        <button class="start-btn" id="startBtn">▶  START</button>
        <div class="credit">tap to rotate · swipe down to push</div>
    </div>

    <div class="header">
        <div class="logo">◈ MeetRis</div>
    </div>

    <div class="game-main">
        <div class="board-container">
            <canvas id="tetrisCanvas" width="300" height="600"></canvas>
        </div>
    </div>

    <div class="bottom-panel">
        <div class="stats">
            <div class="stat-item">
                <span class="stat-label" id="scoreLabel">Score</span>
                <span class="stat-value score-val" id="scoreDisplay">0</span>
            </div>
            <div class="stat-item">
                <span class="stat-label" id="linesLabel">Lines</span>
                <span class="stat-value" id="linesDisplay">0</span>
            </div>
            <div class="next-mini">
                <span class="stat-label" id="nextLabel">Next</span>
                <canvas id="nextCanvas" width="80" height="80"></canvas>
            </div>
        </div>
        <div class="drop-btn-area">
            <button class="ctrl-btn" id="hardDropBtn">⬇⬇</button>
        </div>
    </div>
</div>
<script>
    (function(){
        // ---- i18n ----
        const LANG = {
            en: { score: 'Score', lines: 'Lines', next: 'Next', gameOver: 'GAME OVER' }
        };
        const dict = LANG.en;

        // ---- DOM refs ----
        const canvas = document.getElementById('tetrisCanvas');
        const ctx = canvas.getContext('2d');
        const nextCanvas = document.getElementById('nextCanvas');
        const nextCtx = nextCanvas.getContext('2d');
        const scoreDisplay = document.getElementById('scoreDisplay');
        const linesDisplay = document.getElementById('linesDisplay');
        const scoreLabel = document.getElementById('scoreLabel');
        const linesLabel = document.getElementById('linesLabel');
        const nextLabel = document.getElementById('nextLabel');
        const startMenu = document.getElementById('startMenu');
        const startBtn = document.getElementById('startBtn');

        // ---- constants ----
        const COLS = 10, ROWS = 20;
        const BLOCK_SIZE = canvas.width / COLS;
        const NEXT_SIZE = nextCanvas.width / 4;

        // ---- BEAUTIFUL COLORS per block ----
        const COLORS = [
            '#3cc7f2', // I
            '#f7d44a', // O
            '#b484e0', // T
            '#6fcf97', // S
            '#e66767', // Z
            '#f5a97f', // L
            '#6a9cf5'  // J
        ];

        const SHAPES = [
            { name: 'I', matrix: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], colorIdx: 0 },
            { name: 'O', matrix: [[1,1],[1,1]], colorIdx: 1 },
            { name: 'T', matrix: [[0,1,0],[1,1,1],[0,0,0]], colorIdx: 2 },
            { name: 'S', matrix: [[0,1,1],[1,1,0],[0,0,0]], colorIdx: 3 },
            { name: 'Z', matrix: [[1,1,0],[0,1,1],[0,0,0]], colorIdx: 4 },
            { name: 'L', matrix: [[1,0,0],[1,1,1],[0,0,0]], colorIdx: 5 },
            { name: 'J', matrix: [[0,0,1],[1,1,1],[0,0,0]], colorIdx: 6 }
        ];

        function randomPiece() {
            const idx = Math.floor(Math.random() * SHAPES.length);
            const shape = SHAPES[idx];
            return {
                matrix: shape.matrix.map(row => [...row]),
                color: COLORS[shape.colorIdx],
                colorIdx: shape.colorIdx,
                name: shape.name
            };
        }

        // ---- game state ----
        let board = Array(ROWS).fill().map(() => Array(COLS).fill(null));
        let currentPiece = null;
        let nextPiece = null;
        let score = 0;
        let lines = 0;
        let gameOver = false;
        let dropInterval = 380;
        let dropTimer = null;
        let gameRunning = false;

        // ---- core functions ----
        function spawnPiece() {
            if (!nextPiece) nextPiece = randomPiece();
            currentPiece = {
                matrix: nextPiece.matrix.map(row => [...row]),
                color: nextPiece.color,
                colorIdx: nextPiece.colorIdx,
                name: nextPiece.name,
                x: Math.floor((COLS - nextPiece.matrix[0].length) / 2),
                y: 0
            };
            nextPiece = randomPiece();
            if (collision(currentPiece.matrix, currentPiece.x, currentPiece.y)) {
                gameOver = true;
                if (dropTimer) { clearInterval(dropTimer); dropTimer = null; }
                currentPiece = null;
            }
            renderAll();
        }

        function collision(matrix, offX, offY) {
            for (let r = 0; r < matrix.length; r++) {
                for (let c = 0; c < matrix[0].length; c++) {
                    if (matrix[r][c] !== 0) {
                        const boardX = offX + c;
                        const boardY = offY + r;
                        if (boardX < 0 || boardX >= COLS || boardY >= ROWS || boardY < 0) return true;
                        if (boardY >= 0 && board[boardY][boardX] !== null) return true;
                    }
                }
            }
            return false;
        }

        function mergePiece() {
            if (!currentPiece) return;
            for (let r = 0; r < currentPiece.matrix.length; r++) {
                for (let c = 0; c < currentPiece.matrix[0].length; c++) {
                    if (currentPiece.matrix[r][c] !== 0) {
                        const boardX = currentPiece.x + c;
                        const boardY = currentPiece.y + r;
                        if (boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
                            board[boardY][boardX] = currentPiece.color;
                        }
                    }
                }
            }
            clearLines();
            spawnPiece();
            renderAll();
        }

        function clearLines() {
            let cleared = 0;
            for (let row = ROWS - 1; row >= 0; ) {
                let full = true;
                for (let col = 0; col < COLS; col++) {
                    if (board[row][col] === null) { full = false; break; }
                }
                if (full) {
                    board.splice(row, 1);
                    board.unshift(Array(COLS).fill(null));
                    cleared++;
                } else {
                    row--;
                }
            }
            if (cleared > 0) {
                lines += cleared;
                const points = [0, 40, 100, 300, 1200];
                score += points[Math.min(cleared,4)] || 0;
                updateInfo();
            }
        }

        function moveDown() {
            if (!currentPiece || gameOver || !gameRunning) return;
            if (!collision(currentPiece.matrix, currentPiece.x, currentPiece.y + 1)) {
                currentPiece.y++;
                renderAll();
            } else {
                mergePiece();
                renderAll();
            }
        }

        function moveHorizontal(dir) {
            if (!currentPiece || gameOver || !gameRunning) return;
            if (!collision(currentPiece.matrix, currentPiece.x + dir, currentPiece.y)) {
                currentPiece.x += dir;
                renderAll();
            }
        }

        function rotatePiece() {
            if (!currentPiece || gameOver || !gameRunning) return;
            const matrix = currentPiece.matrix;
            const rotated = matrix[0].map((_, idx) => matrix.map(row => row[idx]).reverse());
            if (!collision(rotated, currentPiece.x, currentPiece.y)) {
                currentPiece.matrix = rotated;
                renderAll();
            } else {
                for (let offset of [-1, 1, -2, 2]) {
                    if (!collision(rotated, currentPiece.x + offset, currentPiece.y)) {
                        currentPiece.matrix = rotated;
                        currentPiece.x += offset;
                        renderAll();
                        return;
                    }
                }
            }
        }

        function hardDrop() {
            if (!currentPiece || gameOver || !gameRunning) return;
            while (!collision(currentPiece.matrix, currentPiece.x, currentPiece.y + 1)) {
                currentPiece.y++;
            }
            mergePiece();
            renderAll();
        }

        function resetGame() {
            board = Array(ROWS).fill().map(() => Array(COLS).fill(null));
            score = 0; lines = 0;
            gameOver = false;
            if (dropTimer) { clearInterval(dropTimer); dropTimer = null; }
            nextPiece = randomPiece();
            spawnPiece();
            updateInfo();
            renderAll();
            startDropTimer();
        }

        function startDropTimer() {
            if (dropTimer) clearInterval(dropTimer);
            dropTimer = setInterval(() => {
                if (!gameOver && currentPiece && gameRunning) moveDown();
                else if (gameOver) { clearInterval(dropTimer); dropTimer = null; }
            }, dropInterval);
        }

        // ---- render ----
        function renderBoard() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    const color = board[r][c];
                    ctx.fillStyle = color || '#191f2d';
                    ctx.fillRect(c * BLOCK_SIZE, r * BLOCK_SIZE, BLOCK_SIZE-1, BLOCK_SIZE-1);
                    if (color) {
                        ctx.shadowColor = 'rgba(255,255,255,0.2)';
                        ctx.shadowBlur = 6;
                        ctx.fillRect(c * BLOCK_SIZE, r * BLOCK_SIZE, BLOCK_SIZE-1, BLOCK_SIZE-1);
                        ctx.shadowBlur = 0;
                    } else {
                        ctx.strokeStyle = '#252d42';
                        ctx.lineWidth = 0.6;
                        ctx.strokeRect(c * BLOCK_SIZE, r * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
                    }
                }
            }
            if (currentPiece && !gameOver && gameRunning) {
                const m = currentPiece.matrix;
                for (let r = 0; r < m.length; r++) {
                    for (let c = 0; c < m[0].length; c++) {
                        if (m[r][c] !== 0) {
                            const x = (currentPiece.x + c) * BLOCK_SIZE;
                            const y = (currentPiece.y + r) * BLOCK_SIZE;
                            ctx.fillStyle = currentPiece.color;
                            ctx.shadowColor = 'rgba(255,255,255,0.3)';
                            ctx.shadowBlur = 10;
                            ctx.fillRect(x, y, BLOCK_SIZE-1, BLOCK_SIZE-1);
                            ctx.shadowBlur = 0;
                        }
                    }
                }
            }
            if (gameOver) {
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#f5d78c';
                ctx.font = 'bold 26px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = '#00000060';
                ctx.shadowBlur = 20;
                ctx.fillText(dict.gameOver, canvas.width/2, canvas.height/2-10);
                ctx.shadowBlur = 0;
            }
        }

        function renderNext() {
            nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
            if (nextPiece) {
                const m = nextPiece.matrix;
                const color = nextPiece.color;
                const block = NEXT_SIZE;
                const offsetX = (nextCanvas.width - (m[0].length * block)) / 2;
                const offsetY = (nextCanvas.height - (m.length * block)) / 2;
                for (let r = 0; r < m.length; r++) {
                    for (let c = 0; c < m[0].length; c++) {
                        if (m[r][c] !== 0) {
                            nextCtx.fillStyle = color;
                            nextCtx.shadowColor = 'rgba(255,255,255,0.2)';
                            nextCtx.shadowBlur = 8;
                            nextCtx.fillRect(offsetX + c * block, offsetY + r * block, block-1, block-1);
                            nextCtx.shadowBlur = 0;
                        }
                    }
                }
            }
        }

        function renderAll() {
            renderBoard();
            renderNext();
        }

        function updateInfo() {
            scoreDisplay.textContent = score;
            linesDisplay.textContent = lines;
        }

        // ---- start game from menu ----
        function startGame() {
            startMenu.classList.add('hidden');
            gameRunning = true;
            resetGame();
        }

        // ---- init ----
        function init() {
            scoreLabel.textContent = dict.score;
            linesLabel.textContent = dict.lines;
            nextLabel.textContent = dict.next;

            gameRunning = false;
            board = Array(ROWS).fill().map(() => Array(COLS).fill(null));
            nextPiece = randomPiece();
            renderAll();

            startBtn.addEventListener('click', (e) => {
                e.preventDefault();
                startGame();
            });

            document.getElementById('hardDropBtn').addEventListener('click', (e) => {
                e.preventDefault();
                hardDrop();
            });

            // ---- TOUCH CONTROLS ----
            let touchStartX = 0, touchStartY = 0;
            let touchStartTime = 0;
            let touchMoved = false;

            canvas.addEventListener('touchstart', (e) => {
                const t = e.touches[0];
                touchStartX = t.clientX;
                touchStartY = t.clientY;
                touchStartTime = Date.now();
                touchMoved = false;
            }, { passive: true });

            canvas.addEventListener('touchmove', (e) => {
                e.preventDefault();
                if (!currentPiece || gameOver || !gameRunning) return;
                const t = e.touches[0];
                const dx = t.clientX - touchStartX;
                const dy = t.clientY - touchStartY;
                
                // Horizontal swipe: move left/right
                if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 0.8) {
                    moveHorizontal(dx > 0 ? 1 : -1);
                    touchStartX = t.clientX;
                    touchStartY = t.clientY;
                    touchMoved = true;
                } 
                // Vertical swipe down: push block down
                else if (dy > 30 && Math.abs(dy) > Math.abs(dx) * 0.8) {
                    moveDown();
                    touchStartX = t.clientX;
                    touchStartY = t.clientY;
                    touchMoved = true;
                }
            }, { passive: false });

            canvas.addEventListener('touchend', (e) => {
                const dt = Date.now() - touchStartTime;
                // Single tap (no movement, short duration) = rotate
                if (!touchMoved && dt < 300 && gameRunning) {
                    e.preventDefault();
                    rotatePiece();
                }
            }, { passive: false });

            // ---- MOUSE/CLICK for desktop ----
            canvas.addEventListener('click', (e) => {
                if (!gameRunning) return;
                // Only rotate on click (no movement detection needed for mouse)
                rotatePiece();
            });

            // ---- KEYBOARD ----
            document.addEventListener('keydown', (e) => {
                if (!gameRunning) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        startGame();
                    }
                    return;
                }
                if (e.key === 'ArrowLeft') { e.preventDefault(); moveHorizontal(-1); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); moveHorizontal(1); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); moveDown(); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); rotatePiece(); }
                else if (e.key === ' ') { e.preventDefault(); hardDrop(); }
                else if (e.key === 'r' || e.key === 'R') { resetGame(); }
            });

            window.addEventListener('resize', () => { renderAll(); });
        }

        init();
    })();
</script>
</body>
</html>