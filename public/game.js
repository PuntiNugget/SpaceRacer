const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

// UI Elements
const uiLayer = document.getElementById('ui-layer');
const interactionPrompt = document.getElementById('interaction-prompt');
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modal-content');

// Game State
let currentState = 'MENU'; 
let roomCode = null;
let myId = null;

// Local Player State
let me = {
    x: 0, y: 0, angle: 0, speed: 0,
    mode: 'SHIP', location: 'SPACE',
    fuel: 100, maxFuel: 100, money: 0,
    inventory: { rocks: 0 },
    activeQuest: null
};

// Universe Data (Received from Server)
let GALAXY = null;
const otherPlayers = {};
const keys = {};

// --- INPUT & SETUP ---
window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'e') handleInteraction();
    if (e.key === 'Escape') closeModal();
});
window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);
window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });
canvas.width = window.innerWidth; canvas.height = window.innerHeight;

// --- NETWORK ---
function createRoom() { socket.emit('createRoom'); }
function joinRoom() { 
    const code = document.getElementById('room-code').value;
    if(code) socket.emit('joinRoom', code.toUpperCase()); 
}

// Initial Connection Handlers
const startGame = (data) => {
    roomCode = data.code;
    GALAXY = data.galaxy;
    currentState = 'PLAYING';
    uiLayer.classList.add('hidden');
    initHUD();
    requestAnimationFrame(gameLoop);
};

socket.on('roomCreated', startGame);
socket.on('joinedRoom', startGame);

// State Updates
socket.on('updatePlayerList', (list) => {
    for(let id in list) {
        if(id !== socket.id) otherPlayers[id] = list[id];
        else {
            // Sync server-authoritative stats (money, quest, fuel-max)
            const s = list[id];
            me.money = s.money;
            me.inventory = s.inventory;
            me.activeQuest = s.activeQuest;
            me.maxFuel = s.maxFuel;
            me.color = s.color;
        }
    }
});

socket.on('updateSelf', (p) => {
    me.money = p.money;
    me.inventory = p.inventory;
    me.activeQuest = p.activeQuest;
    me.maxFuel = p.maxFuel;
});

socket.on('playerMoved', (data) => {
    if(otherPlayers[data.id]) Object.assign(otherPlayers[data.id], data);
});

socket.on('mapUpdate', (data) => {
    if(GALAXY.maps[data.location]) {
        GALAXY.maps[data.location].resources = data.resources;
    }
});

socket.on('questSuccess', (msg) => {
    alert(msg); // Simple alert for success
});

// --- LOGIC ---

function handleInteraction() {
    if(currentState !== 'PLAYING') return;
    if(modal.style.display === 'block') { closeModal(); return; }

    // 1. Interactions in SPACE (Entering Planets/Stations)
    if (me.location === 'SPACE') {
        const stations = GALAXY.space.objects;
        for(let obj of stations) {
            if (Math.hypot(me.x - obj.x, me.y - obj.y) < obj.r + 50) {
                const map = GALAXY.maps[obj.id];
                me.location = obj.id;
                me.mode = obj.type === 'INTERIOR' ? 'WALK' : 'WALK';
                me.x = map.width/2; me.y = map.height/2; me.speed = 0;
                return;
            }
        }
    } 
    // 2. Interactions inside MAPS
    else {
        const map = GALAXY.maps[me.location];

        // Exits
        if (map.exits) {
            for(let exit of map.exits) {
                if (Math.hypot(me.x - exit.x, me.y - exit.y) < 50) {
                    me.location = exit.to;
                    me.mode = 'SHIP';
                    me.x = exit.spawnX; me.y = exit.spawnY; me.speed = 0;
                    return;
                }
            }
        }

        // NPCs
        if (map.npcs) {
            for(let npc of map.npcs) {
                if (Math.hypot(me.x - npc.x, me.y - npc.y) < 40) {
                    openNPCModal(npc);
                    return;
                }
            }
        }

        // Mining Rocks
        if (map.resources) {
            for(let rock of map.resources) {
                if (Math.hypot(me.x - rock.x, me.y - rock.y) < 40) {
                    socket.emit('mineRock', { roomCode, rockId: rock.id });
                    return;
                }
            }
        }
    }
}

function openNPCModal(npc) {
    modal.style.display = 'block';
    
    if (npc.role === 'QUEST_GIVER') {
        // Quest Logic
        if (me.activeQuest) {
            // Check if completing
            modalContent.innerHTML = `
                <h2>${npc.name}</h2>
                <p>Did you complete the task?</p>
                <p class="small">${me.activeQuest.desc}</p>
                <button onclick="socket.emit('completeQuest', {roomCode}); closeModal()">Complete Quest</button>
                <button onclick="closeModal()">Back</button>
            `;
        } else {
            // Offer Quest
            modalContent.innerHTML = `
                <h2>${npc.name}</h2>
                <p>I have a job for you, pilot.</p>
                <button onclick="socket.emit('acceptQuest', {roomCode}); closeModal()">Accept Mission</button>
                <button onclick="closeModal()">No thanks</button>
            `;
        }
    } else if (npc.role === 'SHOP') {
        modalContent.innerHTML = `
            <h2>${npc.name}</h2>
            <p>Welcome to the Supply Depot.</p>
            <p>Current Money: $${me.money}</p>
            <button onclick="socket.emit('buyUpgrade', {roomCode, item: 'fuelMax'}); closeModal()">Upgrade Fuel Tank ($300)</button>
            <button onclick="me.fuel = me.maxFuel; closeModal()">Refuel (Free)</button>
            <button onclick="closeModal()">Leave</button>
        `;
    }
}

function closeModal() { modal.style.display = 'none'; }

function updatePhysics() {
    if (me.mode === 'SHIP') {
        if (keys['w'] && me.fuel > 0) { me.speed += 0.1; me.fuel -= 0.02; }
        if (keys['s']) me.speed -= 0.1;
        if (keys['a']) me.angle -= 0.05;
        if (keys['d']) me.angle += 0.05;
        me.x += Math.cos(me.angle) * me.speed;
        me.y += Math.sin(me.angle) * me.speed;
        me.speed *= 0.99;
    } else {
        const moveSpeed = 4;
        if (keys['w']) me.y -= moveSpeed;
        if (keys['s']) me.y += moveSpeed;
        if (keys['a']) me.x -= moveSpeed;
        if (keys['d']) me.x += moveSpeed;
        
        // Bounds
        const map = GALAXY.maps[me.location];
        if(map) {
            me.x = Math.max(0, Math.min(map.width, me.x));
            me.y = Math.max(0, Math.min(map.height, me.y));
        }
    }

    // Network Sync
    if(roomCode) {
        socket.emit('playerUpdate', {
            roomCode,
            x: me.x, y: me.y, angle: me.angle,
            mode: me.mode, location: me.location
        });
    }
}

// --- RENDERING ---

function drawHUD() {
    document.getElementById('hud-loc').innerText = me.location;
    document.getElementById('hud-fuel').innerText = Math.floor(me.fuel) + '/' + me.maxFuel;
    document.getElementById('hud-money').innerText = '$' + me.money;
    
    let questText = "NONE";
    if(me.activeQuest) questText = `${me.activeQuest.type}: ${me.activeQuest.desc}`;
    document.getElementById('hud-quest').innerText = questText;
    document.getElementById('hud-rocks').innerText = me.inventory.rocks;

    // Interaction Prompt Logic
    let prompt = "";
    if(me.location === 'SPACE') {
        GALAXY.space.objects.forEach(o => {
            if(Math.hypot(me.x - o.x, me.y - o.y) < o.r + 50) prompt = `ENTER ${o.name}`;
        });
    } else {
        const map = GALAXY.maps[me.location];
        if(map.exits) map.exits.forEach(e => { if(Math.hypot(me.x-e.x, me.y-e.y) < 50) prompt = "TAKEOFF"; });
        if(map.npcs) map.npcs.forEach(n => { if(Math.hypot(me.x-n.x, me.y-n.y) < 40) prompt = "TALK"; });
        if(map.resources) map.resources.forEach(r => { if(Math.hypot(me.x-r.x, me.y-r.y) < 40) prompt = "MINE ROCK"; });
    }

    if(prompt) {
        interactionPrompt.style.display = 'block';
        interactionPrompt.innerText = `PRESS 'E' TO ${prompt}`;
    } else {
        interactionPrompt.style.display = 'none';
    }
}

function drawSpace() {
    // Background Stars
    ctx.fillStyle = 'white';
    for(let i=0; i<100; i++) ctx.fillRect((i*137)%canvas.width, (i*243)%canvas.height, 1, 1);

    GALAXY.space.objects.forEach(obj => {
        ctx.beginPath();
        ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI*2);
        ctx.fillStyle = obj.color;
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = '20px Consolas';
        ctx.fillText(obj.name, obj.x - 30, obj.y);
    });
}

function drawMap() {
    const map = GALAXY.maps[me.location];
    ctx.fillStyle = map.color;
    ctx.fillRect(0, 0, map.width, map.height);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    for(let i=0; i<map.width; i+=100) { ctx.moveTo(i,0); ctx.lineTo(i, map.height); }
    ctx.stroke();

    if(map.exits) {
        map.exits.forEach(e => {
            ctx.fillStyle = 'rgba(0,255,0,0.3)';
            ctx.beginPath(); ctx.arc(e.x, e.y, 40, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = 'white'; ctx.fillText("SHIP", e.x-10, e.y);
        });
    }

    if(map.npcs) {
        map.npcs.forEach(n => {
            ctx.fillStyle = 'cyan';
            ctx.beginPath(); ctx.arc(n.x, n.y, 15, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = 'white'; ctx.font = '12px Consolas';
            ctx.fillText(n.name, n.x-20, n.y-20);
            if(n.role === 'QUEST_GIVER') {
                ctx.fillStyle = 'yellow'; ctx.fillText("!", n.x-2, n.y-5);
            } else {
                ctx.fillStyle = 'gold'; ctx.fillText("$", n.x-3, n.y-5);
            }
        });
    }

    if(map.resources) {
        map.resources.forEach(r => {
            ctx.fillStyle = '#885555';
            ctx.beginPath();
            ctx.moveTo(r.x, r.y-10); ctx.lineTo(r.x+10, r.y+5); ctx.lineTo(r.x-10, r.y+5);
            ctx.fill();
        });
    }
}

function drawPlayer(p) {
    if (p.location !== me.location) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.mode === 'SHIP') {
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(20, 0); ctx.lineTo(-15, 15); ctx.lineTo(-5, 0); ctx.lineTo(-15, -15);
        ctx.fill();
    } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'white'; ctx.fillText(p.id.substr(0,4), -10, -15);
    }
    ctx.restore();
}

function gameLoop() {
    if (currentState !== 'PLAYING') return;

    updatePhysics();
    drawHUD();

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width/2 - me.x, canvas.height/2 - me.y);

    if (me.location === 'SPACE') drawSpace();
    else drawMap();

    drawPlayer(me);
    for (let id in otherPlayers) drawPlayer(otherPlayers[id]);

    ctx.restore();
    requestAnimationFrame(gameLoop);
}

function initHUD() {
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
        <div class="hud-panel">LOC: <span id="hud-loc"></span></div>
        <div class="hud-panel">FUEL: <span id="hud-fuel"></span></div>
        <div class="hud-panel">CASH: <span id="hud-money"></span></div>
        <div class="hud-panel">ROCKS: <span id="hud-rocks"></span></div>
        <div class="hud-panel" style="height:auto">QUEST:<br><span id="hud-quest" style="font-size:0.8em"></span></div>
    `;
    document.body.appendChild(hud);
}
