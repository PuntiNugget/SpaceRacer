const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

// DOM Elements
const uiLayer = document.getElementById('ui-layer');
const hud = document.getElementById('hud');
const interactionPrompt = document.getElementById('interaction-prompt');

// Game State
let currentState = 'MENU'; // MENU, PLAYING
let myId = null;
let roomCode = null;

// The Player
const me = {
    x: 0, y: 0, angle: 0, 
    speed: 0, 
    mode: 'SHIP', // SHIP or WALK
    location: 'SPACE', // SPACE, STATION_1, PLANET_RED
    fuel: 100,
    color: '#00ff00'
};

const otherPlayers = {};
const keys = {};

// --- WORLD DATA ---
// We define static locations in the universe
const UNIVERSE = {
    'SPACE': {
        width: 10000, height: 10000,
        objects: [
            { type: 'STATION', id: 'STATION_1', x: 0, y: 0, r: 150, color: '#888' },
            { type: 'PLANET', id: 'PLANET_RED', x: 2000, y: -1500, r: 300, color: '#cc4444' },
            { type: 'PLANET', id: 'PLANET_BLUE', x: -2000, y: 1500, r: 400, color: '#4444cc' }
        ]
    },
    'STATION_1': {
        type: 'INTERIOR', width: 800, height: 600, color: '#222',
        exits: [{ x: 400, y: 550, to: 'SPACE', spawnX: 0, spawnY: 200 }],
        shops: [{ x: 400, y: 100, action: 'REFUEL' }]
    },
    'PLANET_RED': {
        type: 'SURFACE', width: 2000, height: 2000, color: '#552222',
        exits: [{ x: 1000, y: 1000, to: 'SPACE', spawnX: 2000, spawnY: -1100 }]
    },
    'PLANET_BLUE': {
        type: 'SURFACE', width: 2000, height: 2000, color: '#222255',
        exits: [{ x: 1000, y: 1000, to: 'SPACE', spawnX: -2000, spawnY: 1900 }]
    }
};

// Visual Assets
const stars = [];
for(let i=0; i<500; i++) stars.push({x: Math.random()*4000-2000, y: Math.random()*4000-2000, s: Math.random()*2});

// --- INPUT HANDLING ---
window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'e') handleInteraction();
});
window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);
window.addEventListener('resize', resize);
function resize(){ canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();

// --- NETWORK ---
function createRoom() { socket.emit('createRoom'); }
function joinRoom() { 
    const code = document.getElementById('room-code').value;
    if(code) socket.emit('joinRoom', code.toUpperCase()); 
}

socket.on('roomCreated', (code) => startGame(code));
socket.on('joinedRoom', (code) => startGame(code));
socket.on('updatePlayerList', (list) => {
    for(let id in list) {
        if(id !== socket.id) otherPlayers[id] = list[id];
        else {
            // Sync server defaults if needed, but usually client authorities movement
            if(!myId) {
                myId = id;
                me.color = list[id].color;
            }
        }
    }
});
socket.on('playerMoved', (data) => {
    if(otherPlayers[data.id]) {
        Object.assign(otherPlayers[data.id], data);
    }
});

function startGame(code) {
    roomCode = code;
    currentState = 'PLAYING';
    uiLayer.classList.add('hidden');
    
    // Create HUD
    const hudDiv = document.createElement('div');
    hudDiv.id = 'hud';
    hudDiv.innerHTML = `
        <div class="hud-panel">LOCATION: <span id="hud-loc">DEEP SPACE</span></div>
        <div class="hud-panel">FUEL: <span id="hud-fuel">100%</span></div>
        <div class="hud-panel">MODE: <span id="hud-mode">SHIP</span></div>
        <div class="hud-panel">ROOM: ${code}</div>
    `;
    document.body.appendChild(hudDiv);
    
    requestAnimationFrame(gameLoop);
}

// --- LOGIC ---

function handleInteraction() {
    // Check if near any interactive object in current map
    const map = UNIVERSE[me.location];
    
    // 1. Exits (Leaving planet/station)
    if (map.exits) {
        map.exits.forEach(exit => {
            const dist = Math.hypot(me.x - exit.x, me.y - exit.y);
            if (dist < 50) {
                switchLocation(exit.to, exit.spawnX, exit.spawnY, 'SHIP');
            }
        });
    }

    // 2. Objects (Entering planet/station from Space)
    if (me.location === 'SPACE') {
        map.objects.forEach(obj => {
            const dist = Math.hypot(me.x - obj.x, me.y - obj.y);
            if (dist < obj.r + 50) {
                // Enter location
                // Default spawn is center of map (width/2)
                const targetMap = UNIVERSE[obj.id];
                switchLocation(obj.id, targetMap.width/2, targetMap.height/2, 'WALK');
            }
        });
    }
    
    // 3. Shops/Actions
    if (map.shops) {
        map.shops.forEach(shop => {
            const dist = Math.hypot(me.x - shop.x, me.y - shop.y);
            if (dist < 50) {
                if(shop.action === 'REFUEL') me.fuel = 100;
            }
        });
    }
}

function switchLocation(newLoc, x, y, newMode) {
    me.location = newLoc;
    me.x = x;
    me.y = y;
    me.mode = newMode;
    me.speed = 0;
    // Reset view
}

function updatePhysics() {
    if (me.mode === 'SHIP') {
        // Drifting physics
        if (keys['w'] && me.fuel > 0) {
            me.speed += 0.1;
            me.fuel -= 0.05;
        }
        if (keys['s']) me.speed -= 0.1;
        if (keys['a']) me.angle -= 0.05;
        if (keys['d']) me.angle += 0.05;
        
        me.x += Math.cos(me.angle) * me.speed;
        me.y += Math.sin(me.angle) * me.speed;
        me.speed *= 0.99; // Space friction
    } else {
        // Walking physics (Direct control)
        const moveSpeed = 3;
        if (keys['w']) me.y -= moveSpeed;
        if (keys['s']) me.y += moveSpeed;
        if (keys['a']) me.x -= moveSpeed;
        if (keys['d']) me.x += moveSpeed;
        
        // Face mouse logic could go here, for now simple walking
        if (keys['w'] || keys['s'] || keys['a'] || keys['d']) {
            me.angle = Math.atan2(keys['s'] - keys['w'], keys['d'] - keys['a']); // Rough approximation
        }
    }

    // Bounds check for Interior/Planets
    const map = UNIVERSE[me.location];
    if (me.location !== 'SPACE') {
        if(me.x < 0) me.x = 0;
        if(me.y < 0) me.y = 0;
        if(me.x > map.width) me.x = map.width;
        if(me.y > map.height) me.y = map.height;
    }

    // Send to server
    if(roomCode) {
        socket.emit('playerUpdate', {
            roomCode,
            x: me.x, y: me.y, angle: me.angle,
            mode: me.mode,
            location: me.location
        });
    }
}

// --- RENDER ---

function drawCamera() {
    // Center camera on player
    ctx.save();
    ctx.translate(canvas.width/2 - me.x, canvas.height/2 - me.y);
}

function drawHUD() {
    document.getElementById('hud-loc').innerText = me.location;
    document.getElementById('hud-fuel').innerText = Math.floor(me.fuel) + '%';
    document.getElementById('hud-mode').innerText = me.mode;
    
    // Check for interactions
    let canInteract = false;
    const map = UNIVERSE[me.location];
    
    // Logic to show "Press E"
    if (me.location === 'SPACE') {
        map.objects.forEach(obj => {
            if (Math.hypot(me.x - obj.x, me.y - obj.y) < obj.r + 50) {
                interactionPrompt.innerText = `PRESS 'E' TO ENTER ${obj.id}`;
                canInteract = true;
            }
        });
    } else if (map.exits) {
        map.exits.forEach(exit => {
            if (Math.hypot(me.x - exit.x, me.y - exit.y) < 50) {
                interactionPrompt.innerText = "PRESS 'E' TO TAKEOFF";
                canInteract = true;
            }
        });
    }
    
    if (map.shops) {
         map.shops.forEach(shop => {
            if (Math.hypot(me.x - shop.x, me.y - shop.y) < 50) {
                interactionPrompt.innerText = `PRESS 'E' TO ${shop.action}`;
                canInteract = true;
            }
        });
    }

    interactionPrompt.style.display = canInteract ? 'block' : 'none';
}

function drawSpaceMap() {
    // Stars (parallax possible, but static for now)
    stars.forEach(s => {
        ctx.fillStyle = 'white';
        ctx.fillRect(s.x + me.x*0.1, s.y + me.y*0.1, s.s, s.s); // Simple Parallax
    });

    const map = UNIVERSE['SPACE'];
    map.objects.forEach(obj => {
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI*2);
        ctx.fillStyle = obj.color;
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = '20px monospace';
        ctx.fillText(obj.id, obj.x - 30, obj.y);
    });
}

function drawSurfaceMap(mapName) {
    const map = UNIVERSE[mapName];
    // Draw Ground
    ctx.fillStyle = map.color;
    ctx.fillRect(0, 0, map.width, map.height);
    
    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    for(let i=0; i<map.width; i+=100) { ctx.moveTo(i,0); ctx.lineTo(i, map.height); }
    for(let i=0; i<map.height; i+=100) { ctx.moveTo(0,i); ctx.lineTo(map.width, i); }
    ctx.stroke();

    // Draw Exits (Ship)
    if(map.exits) {
        map.exits.forEach(e => {
            ctx.fillStyle = 'rgba(0,255,0,0.3)';
            ctx.beginPath();
            ctx.arc(e.x, e.y, 40, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = 'white';
            ctx.fillText("SHIP", e.x-15, e.y);
        });
    }
    
    // Draw Shops
    if(map.shops) {
        map.shops.forEach(s => {
            ctx.fillStyle = 'gold';
            ctx.fillRect(s.x-20, s.y-20, 40, 40);
            ctx.fillStyle = 'black';
            ctx.fillText("FUEL", s.x-15, s.y+5);
        });
    }
}

function drawPlayer(p, isMe) {
    // Don't draw if not in same location
    if (p.location !== me.location) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    
    if (p.mode === 'SHIP') {
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(20, 0);
        ctx.lineTo(-15, 15);
        ctx.lineTo(-5, 0);
        ctx.lineTo(-15, -15);
        ctx.fill();
    } else {
        // Walking Person
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI*2);
        ctx.fill();
        // Name tag
        ctx.fillStyle = 'white';
        ctx.font = '10px monospace';
        ctx.fillText(isMe ? "YOU" : "P2", -10, -15);
    }
    ctx.restore();
}

function gameLoop() {
    if (currentState !== 'PLAYING') return;

    updatePhysics();
    drawHUD();

    // Clear Screen
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawCamera();

    // Draw World
    if (me.location === 'SPACE') drawSpaceMap();
    else drawSurfaceMap(me.location);

    // Draw Players
    drawPlayer(me, true);
    for (let id in otherPlayers) {
        drawPlayer(otherPlayers[id], false);
    }

    ctx.restore(); // Pop camera

    requestAnimationFrame(gameLoop);
}
