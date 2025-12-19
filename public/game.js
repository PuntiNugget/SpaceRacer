const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

// UI Elements
const uiLayer = document.getElementById('ui-layer');
const mainMenu = document.getElementById('main-menu');
const mpMenu = document.getElementById('multiplayer-menu');
const lobbyScreen = document.getElementById('lobby-screen');
const roomCodeDisplay = document.getElementById('display-room-code');
const playerListDiv = document.getElementById('player-list');
const startBtn = document.getElementById('start-btn');
const waitingMsg = document.getElementById('waiting-msg');

// Game State
let gameState = 'MENU'; 
let mode = 'SINGLE'; 
let currentRoomCode = null;

// Physics Constants
const ACCELERATION = 0.15; // Slightly floatier for space
const MAX_SPEED = 9;
const FRICTION = 0.98; // Less friction in space
const TURN_SPEED = 0.06;

// --- Space Assets (Visuals) ---
const stars = [];
const planets = [];
const particles = []; // Engine exhaust

function initSpaceBackground() {
    // Generate Stars
    for(let i=0; i<150; i++) {
        stars.push({
            x: Math.random() * window.innerWidth,
            y: Math.random() * window.innerHeight,
            size: Math.random() * 2,
            blinkSpeed: Math.random() * 0.1
        });
    }
    // Generate Planets (Static background objects)
    planets.push({ x: 100, y: 100, r: 40, color: '#ff4444' }); // Mars-like
    planets.push({ x: window.innerWidth - 100, y: window.innerHeight - 150, r: 80, color: '#4444ff', rings: true }); // Neptune-like
}

// Tracks (Neon Space Lanes)
const tracks = [
    // 0: Orbital Ring (Oval)
    { color: '#00ffff', draw: (ctx) => { 
        ctx.shadowBlur = 20; ctx.shadowColor = '#00ffff';
        ctx.beginPath(); ctx.ellipse(400, 300, 300, 200, 0, 0, Math.PI*2); 
        ctx.lineWidth = 60; ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)'; ctx.stroke();
        ctx.lineWidth = 5; ctx.strokeStyle = '#00ffff'; ctx.stroke(); // Neon Border
        ctx.shadowBlur = 0;
    }},
    // 1: Infinity Nebula (Figure 8)
    { color: '#ff00ff', draw: (ctx) => { 
        ctx.shadowBlur = 20; ctx.shadowColor = '#ff00ff';
        ctx.beginPath(); ctx.arc(250, 300, 150, 0, Math.PI*2); 
        ctx.moveTo(700, 300); ctx.arc(550, 300, 150, 0, Math.PI*2); 
        ctx.lineWidth = 60; ctx.strokeStyle = 'rgba(255, 0, 255, 0.2)'; ctx.stroke(); 
        ctx.lineWidth = 5; ctx.strokeStyle = '#ff00ff'; ctx.stroke();
        ctx.shadowBlur = 0;
    }},
    // 2: Sector 7 (Square)
    { color: '#ffff00', draw: (ctx) => { 
        ctx.shadowBlur = 20; ctx.shadowColor = '#ffff00';
        ctx.lineWidth = 60; ctx.strokeStyle = 'rgba(255, 255, 0, 0.2)'; ctx.strokeRect(100, 100, 600, 400); 
        ctx.lineWidth = 5; ctx.strokeStyle = '#ffff00'; ctx.strokeRect(100, 100, 600, 400);
        ctx.shadowBlur = 0;
    }},
    // 3: Black Hole Perimeter (Circle)
    { color: '#ff8800', draw: (ctx) => { 
        ctx.shadowBlur = 20; ctx.shadowColor = '#ff8800';
        ctx.beginPath(); ctx.arc(400, 300, 250, 0, Math.PI*2); 
        ctx.lineWidth = 60; ctx.strokeStyle = 'rgba(255, 136, 0, 0.2)'; ctx.stroke(); 
        ctx.lineWidth = 5; ctx.strokeStyle = '#ff8800'; ctx.stroke();
        
        // Draw Black Hole in center
        ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(400,300, 50, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
        ctx.shadowBlur = 0;
    }},
    // 4: Asteroid Slalom (Technical)
    { color: '#00ff00', draw: (ctx) => { 
        ctx.shadowBlur = 20; ctx.shadowColor = '#00ff00';
        ctx.beginPath(); 
        ctx.moveTo(100,100); ctx.lineTo(700,100); ctx.lineTo(700,500); ctx.lineTo(400,300); ctx.lineTo(100,500); 
        ctx.closePath();
        ctx.lineWidth = 60; ctx.strokeStyle = 'rgba(0, 255, 0, 0.2)'; ctx.stroke(); 
        ctx.lineWidth = 5; ctx.strokeStyle = '#00ff00'; ctx.stroke();
        ctx.shadowBlur = 0;
    }}
];

let currentTrack = 0;
const players = {};
const bots = [];
const keys = { w: false, a: false, s: false, d: false };

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    initSpaceBackground();
});
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
initSpaceBackground();

window.addEventListener('keydown', (e) => keys[e.key] = true);
window.addEventListener('keyup', (e) => keys[e.key] = false);

// --- UI Functions ---

function startSinglePlayer() {
    mode = 'SINGLE';
    gameState = 'RACING';
    uiLayer.classList.add('hidden');
    players['me'] = createShip(100, 100, '#00FF00'); // Green Player
    // Add Bots
    bots.push(createBot(100, 150, '#00ffff', 0.03)); 
    bots.push(createBot(100, 200, '#ff00ff', 0.05)); 
    bots.push(createBot(100, 250, '#ffff00', 0.07)); 
    currentTrack = Math.floor(Math.random() * 5);
    gameLoop();
}

function showMultiplayerMenu() {
    mainMenu.classList.add('hidden');
    mpMenu.classList.remove('hidden');
}

function backToMain() {
    mpMenu.classList.add('hidden');
    mainMenu.classList.remove('hidden');
}

function createRoom() { socket.emit('createRoom'); }

function joinRoom() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if(code) socket.emit('joinRoom', code);
}

function hostStartGame() { socket.emit('startGame', currentRoomCode); }

// --- Socket Events ---

socket.on('roomCreated', (code) => enterLobby(code, true));
socket.on('joinedRoom', (code) => enterLobby(code, false));

socket.on('updatePlayerList', (serverPlayers) => {
    playerListDiv.innerHTML = '';
    for (let id in serverPlayers) {
        if (!players[id]) players[id] = serverPlayers[id]; // Sync
        const p = serverPlayers[id];
        const div = document.createElement('div');
        div.innerText = `Pilot ${id.substr(0,4)} ${p.isHost ? '[CMPT]' : ''}`;
        div.style.color = p.color;
        div.style.fontFamily = 'monospace';
        playerListDiv.appendChild(div);
    }
});

socket.on('gameStart', (data) => {
    gameState = 'RACING';
    currentTrack = data.trackIndex;
    uiLayer.classList.add('hidden');
    gameLoop();
});

socket.on('playerMoved', (data) => {
    if (players[data.id]) {
        players[data.id].x = data.x;
        players[data.id].y = data.y;
        players[data.id].angle = data.angle;
        // Add Engine trail for remote players if they are moving
        if(Math.random() > 0.5) addParticle(data.x, data.y, data.angle, players[data.id].color);
    }
});

function enterLobby(code, isHost) {
    currentRoomCode = code;
    mode = 'MULTI';
    mpMenu.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    roomCodeDisplay.innerText = code;
    if (isHost) {
        startBtn.classList.remove('hidden');
        waitingMsg.classList.add('hidden');
    } else {
        startBtn.classList.add('hidden');
        waitingMsg.classList.remove('hidden');
    }
}

// --- Game Logic ---

function createShip(x, y, color) {
    return { x, y, angle: 0, speed: 0, color, width: 20, height: 20 };
}

function createBot(x, y, color, skill) {
    return { 
        x, y, angle: 0, speed: 0, color, width: 20, height: 20, 
        skill, 
        targetX: Math.random() * canvas.width, 
        targetY: Math.random() * canvas.height 
    };
}

function addParticle(x, y, angle, color) {
    // Spawn particle behind the ship
    const bx = x - Math.cos(angle) * 15;
    const by = y - Math.sin(angle) * 15;
    particles.push({
        x: bx + (Math.random() - 0.5) * 5,
        y: by + (Math.random() - 0.5) * 5,
        life: 1.0,
        color: color
    });
}

function updatePhysics(ship, isLocal) {
    ship.x += Math.cos(ship.angle) * ship.speed;
    ship.y += Math.sin(ship.angle) * ship.speed;
    ship.speed *= FRICTION;

    // Add engine particles if moving fast
    if (isLocal && Math.abs(ship.speed) > 1) {
        addParticle(ship.x, ship.y, ship.angle, ship.color);
    }
}

function updatePlayer() {
    const p = (mode === 'SINGLE') ? players['me'] : players[socket.id];
    if (!p) return; 

    if (keys['w']) p.speed += ACCELERATION;
    if (keys['s']) p.speed -= ACCELERATION;
    if (keys['a']) p.angle -= TURN_SPEED;
    if (keys['d']) p.angle += TURN_SPEED;

    if (p.speed > MAX_SPEED) p.speed = MAX_SPEED;
    if (p.speed < -MAX_SPEED/2) p.speed = -MAX_SPEED/2;

    updatePhysics(p, true);

    if (mode === 'MULTI') {
        socket.emit('playerUpdate', {
            roomCode: currentRoomCode,
            x: p.x, y: p.y, angle: p.angle
        });
    }
}

function updateBots() {
    bots.forEach(bot => {
        const dx = bot.targetX - bot.x;
        const dy = bot.targetY - bot.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist < 50) {
            bot.targetX = Math.random() * canvas.width;
            bot.targetY = Math.random() * canvas.height;
        }

        const targetAngle = Math.atan2(dy, dx);
        let diff = targetAngle - bot.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        if (diff > bot.skill) bot.angle += bot.skill;
        else if (diff < -bot.skill) bot.angle -= bot.skill;
        else bot.angle = targetAngle;

        bot.speed += ACCELERATION * 0.5; 
        if (bot.speed > MAX_SPEED * 0.8) bot.speed = MAX_SPEED * 0.8;

        updatePhysics(bot, true);
    });
}

function drawBackground() {
    // Clear with semi-transparent black for trails? No, strict clear for performance.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw Stars
    ctx.fillStyle = 'white';
    stars.forEach(star => {
        ctx.globalAlpha = 0.5 + Math.sin(Date.now() * star.blinkSpeed) * 0.5;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI*2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Draw Planets
    planets.forEach(p => {
        const gradient = ctx.createRadialGradient(p.x-10, p.y-10, p.r/4, p.x, p.y, p.r);
        gradient.addColorStop(0, p.color);
        gradient.addColorStop(1, '#000');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        ctx.fill();
        
        if(p.rings) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, p.r + 20, p.r / 3, -0.4, 0, Math.PI*2);
            ctx.stroke();
        }
    });

    // Draw Meteors (Static decoration for now)
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(200, 200, 15, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(800, 150, 25, 0, Math.PI*2);
    ctx.fill();
}

function drawShip(ship) {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    
    // Draw Ship Body (Triangle)
    ctx.beginPath();
    ctx.moveTo(15, 0);   // Nose
    ctx.lineTo(-10, 10); // Rear Left
    ctx.lineTo(-5, 0);   // Engine Center
    ctx.lineTo(-10, -10);// Rear Right
    ctx.closePath();
    
    ctx.fillStyle = ship.color;
    ctx.fill();
    
    // Cockpit
    ctx.fillStyle = 'rgba(200, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 3, 0, 0, Math.PI*2);
    ctx.fill();

    // Glow
    ctx.shadowBlur = 10;
    ctx.shadowColor = ship.color;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.restore();
}

function drawParticles() {
    for(let i=particles.length-1; i>=0; i--) {
        const p = particles[i];
        p.life -= 0.05;
        p.x += (Math.random() - 0.5); 
        p.y += (Math.random() - 0.5);
        
        if(p.life <= 0) {
            particles.splice(i, 1);
        } else {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3 * p.life, 0, Math.PI*2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }
    }
}

function gameLoop() {
    if (gameState !== 'RACING') return;

    drawBackground();

    // Draw Track
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    tracks[currentTrack].draw(ctx);

    updatePlayer();
    
    // Draw Players & Bots
    drawParticles(); // Draw exhaust under ships

    for (let id in players) drawShip(players[id]);

    if (mode === 'SINGLE') {
        updateBots();
        bots.forEach(bot => drawShip(bot));
    }

    requestAnimationFrame(gameLoop);
}
