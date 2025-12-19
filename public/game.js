const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

// UI Elements
const uiLayer = document.getElementById('ui-layer');
const interactionPrompt = document.getElementById('interaction-prompt');
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modal-content');
const stationMenu = document.getElementById('station-menu');

// Game State
let currentState = 'MENU'; 
let roomCode = null;

// Local Player State
let me = {
    x: 0, y: 0, angle: 0, speed: 0,
    mode: 'SHIP', location: 'SPACE',
    fuel: 100, maxFuel: 100, money: 0,
    inventory: { rocks: 0 },
    activeQuest: null,
    stats: { maxSpeed: 0 }
};

// Universe Data
let GALAXY = null;
const otherPlayers = {};
const keys = {};

// --- GLOBAL EXPORTS ---
window.socket = socket;
window.closeModal = () => { modal.style.display = 'none'; };
window.acceptQuest = () => { socket.emit('acceptQuest', {roomCode}); window.closeModal(); };
window.completeQuest = () => { socket.emit('completeQuest', {roomCode}); window.closeModal(); };
window.buyFuelUpgrade = () => { socket.emit('buyUpgrade', {roomCode, item: 'fuelMax'}); window.closeModal(); };
window.leaveStation = () => {
    const map = GALAXY.maps[me.location];
    if(map && map.exits) {
        const exit = map.exits[0];
        me.location = exit.to; me.mode = 'SHIP';
        me.x = exit.spawnX; me.y = exit.spawnY; me.speed = 0;
        stationMenu.style.display = 'none';
    }
};
window.quickRefuel = () => {
    me.fuel = me.maxFuel;
    socket.emit('refuel', {roomCode});
};

// --- INPUT ---
window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyE') handleInteraction();
    if (e.code === 'Escape') window.closeModal();
});
window.addEventListener('keyup', (e) => keys[e.code] = false);
window.addEventListener('resize', resize);
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();

// --- NETWORK ---
window.createRoom = () => socket.emit('createRoom');
window.joinRoom = () => { 
    const code = document.getElementById('room-code').value;
    if(code) socket.emit('joinRoom', code.toUpperCase()); 
}

const startGame = (data) => {
    roomCode = data.code;
    GALAXY = data.galaxy;
    currentState = 'PLAYING';
    uiLayer.classList.add('hidden');
    initHUD();
    document.getElementById('hud-code').innerText = roomCode; 
    requestAnimationFrame(gameLoop);
};

socket.on('roomCreated', startGame);
socket.on('joinedRoom', startGame);

socket.on('updatePlayerList', (list) => {
    for(let id in list) {
        if(id !== socket.id) otherPlayers[id] = list[id];
        else {
            const s = list[id];
            me.money = s.money; me.inventory = s.inventory;
            me.activeQuest = s.activeQuest; me.maxFuel = s.maxFuel;
            me.color = s.color;
            if(s.fuel === s.maxFuel) me.fuel = s.fuel; 
        }
    }
});
socket.on('updateSelf', (p) => Object.assign(me, p));
socket.on('playerMoved', (data) => { if(otherPlayers[data.id]) Object.assign(otherPlayers[data.id], data); });
socket.on('mapUpdate', (data) => { if(GALAXY.maps[data.location]) GALAXY.maps[data.location].resources = data.resources; });
socket.on('questSuccess', (msg) => alert(msg));

// --- LOGIC ---

function handleInteraction() {
    if(currentState !== 'PLAYING') return;
    if(modal.style.display === 'block') { window.closeModal(); return; }

    if (me.location === 'SPACE') {
        const stations = GALAXY.space.objects;
        for(let obj of stations) {
            if (Math.hypot(me.x - obj.x, me.y - obj.y) < obj.r + 50) {
                const map = GALAXY.maps[obj.id];
                if(map) {
                    me.location = obj.id; me.mode = 'WALK';
                    me.x = map.width/2; me.y = map.height/2; me.speed = 0;
                    if(obj.type === 'STATION') {
                        document.getElementById('station-name').innerText = obj.name;
                        stationMenu.style.display = 'block';
                    }
                }
                return;
            }
        }
    } else {
        const map = GALAXY.maps[me.location];
        if (!map) return;
        if (map.exits) {
            for(let exit of map.exits) {
                if (Math.hypot(me.x - exit.x, me.y - exit.y) < 60) {
                    me.location = exit.to; me.mode = 'SHIP';
                    me.x = exit.spawnX; me.y = exit.spawnY; me.speed = 0;
                    stationMenu.style.display = 'none';
                    return;
                }
            }
        }
        if (map.npcs) {
            for(let npc of map.npcs) {
                if (Math.hypot(me.x - npc.x, me.y - npc.y) < 50) { openNPCModal(npc); return; }
            }
        }
        if (map.resources) {
            for(let rock of map.resources) {
                if (Math.hypot(me.x - rock.x, me.y - rock.y) < 50) {
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
        if (me.activeQuest) {
            modalContent.innerHTML = `
                <h2>${npc.name}</h2>
                <p>${me.activeQuest.desc}</p>
                <button onclick="window.completeQuest()">Complete ($${me.activeQuest.reward})</button>
                <button onclick="window.closeModal()">Back</button>
            `;
        } else {
            modalContent.innerHTML = `
                <h2>${npc.name}</h2>
                <p>Available Mission</p>
                <button onclick="window.acceptQuest()">Accept Mission</button>
                <button onclick="window.closeModal()">No thanks</button>
            `;
        }
    } else if (npc.role === 'SHOP') {
        modalContent.innerHTML = `
            <h2>${npc.name}</h2>
            <p>Wallet: $${me.money}</p>
            <button onclick="window.buyFuelUpgrade()">Upgrade Tank ($300)</button>
            <button onclick="window.quickRefuel()">Refuel (Free)</button>
            <button onclick="window.closeModal()">Leave</button>
        `;
    }
}

function updatePhysics() {
    if (me.location !== 'SPACE' && (!GALAXY || !GALAXY.maps[me.location])) return;

    if (me.mode === 'SHIP') {
        if (keys['KeyA']) me.angle -= 0.05;
        if (keys['KeyD']) me.angle += 0.05;
        if (keys['KeyW'] && me.fuel > 0) { me.speed += 0.1; me.fuel -= 0.02; }
        if (keys['KeyS']) me.speed -= 0.05;
        
        me.x += Math.cos(me.angle) * me.speed;
        me.y += Math.sin(me.angle) * me.speed;
        me.speed *= 0.99; // Inertia
    } else {
        const moveSpeed = 5;
        let dx = 0; let dy = 0;
        if (keys['KeyW']) dy -= moveSpeed;
        if (keys['KeyS']) dy += moveSpeed;
        if (keys['KeyA']) dx -= moveSpeed;
        if (keys['KeyD']) dx += moveSpeed;
        me.x += dx; me.y += dy;
        
        const map = GALAXY.maps[me.location];
        if (map) {
            const maxX = map.width || 1000;
            const maxY = map.height || 1000;
            if (me.x < 0) me.x = 0;
            if (me.y < 0) me.y = 0;
            if (me.x > maxX) me.x = maxX;
            if (me.y > maxY) me.y = maxY;
        }
    }

    if(roomCode) {
        socket.emit('playerUpdate', {
            roomCode, 
            x: me.x, y: me.y, angle: me.angle, 
            mode: me.mode, location: me.location, 
            fuel: me.fuel,
            currentSpeed: Math.abs(me.speed) // SENDING SPEED TO SERVER HERE
        });
    }
}

function drawHUD() {
    document.getElementById('hud-loc').innerText = me.location;
    // NEW: DISPLAY POS AND SPEED
    document.getElementById('hud-pos').innerText = `${Math.round(me.x)}, ${Math.round(me.y)}`;
    document.getElementById('hud-spd').innerText = Math.abs(me.speed).toFixed(1);
    
    document.getElementById('hud-fuel').innerText = Math.floor(me.fuel) + '/' + me.maxFuel;
    document.getElementById('hud-money').innerText = '$' + me.money;
    document.getElementById('hud-rocks').innerText = me.inventory.rocks;
    document.getElementById('hud-quest').innerText = me.activeQuest ? me.activeQuest.desc : "None";

    let prompt = "";
    if(me.location === 'SPACE') {
        GALAXY.space.objects.forEach(o => {
            if(Math.hypot(me.x - o.x, me.y - o.y) < o.r + 50) prompt = `ENTER ${o.name}`;
        });
    } else {
        const map = GALAXY.maps[me.location];
        if(map) {
            if(map.exits) map.exits.forEach(e => { if(Math.hypot(me.x-e.x, me.y-e.y) < 60) prompt = "TAKEOFF"; });
            if(map.npcs) map.npcs.forEach(n => { if(Math.hypot(me.x-n.x, me.y-n.y) < 50) prompt = "TALK"; });
            if(map.resources) map.resources.forEach(r => { if(Math.hypot(me.x-r.x, me.y-r.y) < 50) prompt = "MINE"; });
        }
    }

    if(prompt) {
        interactionPrompt.style.display = 'block';
        interactionPrompt.innerText = `PRESS 'E' TO ${prompt}`;
    } else {
        interactionPrompt.style.display = 'none';
    }
}

function drawGame() {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width/2 - me.x, canvas.height/2 - me.y);

    if (me.location === 'SPACE') {
        ctx.fillStyle = 'white';
        for(let i=0; i<150; i++) ctx.fillRect((i*137)%5000-2500, (i*243)%5000-2500, 2, 2);
        GALAXY.space.objects.forEach(obj => {
            ctx.shadowBlur = 20; ctx.shadowColor = obj.color;
            ctx.fillStyle = obj.color;
            ctx.beginPath(); ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'white'; ctx.font = '24px Consolas'; ctx.textAlign = 'center';
            ctx.fillText(obj.name, obj.x, obj.y);
        });
    } else {
        const map = GALAXY.maps[me.location];
        if(map) {
            ctx.fillStyle = map.color;
            ctx.fillRect(0, 0, map.width, map.height);
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath();
            for(let i=0; i<map.width; i+=100) { ctx.moveTo(i,0); ctx.lineTo(i, map.height); }
            for(let i=0; i<map.height; i+=100) { ctx.moveTo(0,i); ctx.lineTo(map.width, i); }
            ctx.stroke();
            if(map.exits) map.exits.forEach(e => {
                ctx.fillStyle = 'rgba(0,255,0,0.3)';
                ctx.beginPath(); ctx.arc(e.x, e.y, 40, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.fillText("SHIP", e.x, e.y);
            });
            if(map.npcs) map.npcs.forEach(n => {
                ctx.fillStyle = 'cyan';
                ctx.beginPath(); ctx.arc(n.x, n.y, 15, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = 'white'; ctx.fillText(n.name, n.x, n.y-25);
                ctx.fillStyle = 'yellow'; ctx.fillText(n.role === 'SHOP' ? '$' : '!', n.x-3, n.y+4);
            });
            if(map.resources) map.resources.forEach(r => {
                ctx.fillStyle = '#885555';
                ctx.beginPath(); ctx.moveTo(r.x, r.y-10); ctx.lineTo(r.x+10, r.y+5); ctx.lineTo(r.x-10, r.y+5); ctx.fill();
            });
        }
    }
    drawPlayer(me);
    for(let id in otherPlayers) drawPlayer(otherPlayers[id]);
    ctx.restore();
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
        ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.font = '12px Consolas';
        ctx.fillText("PLAYER", 0, -15);
    }
    ctx.restore();
}

function gameLoop() {
    if (currentState !== 'PLAYING') return;
    updatePhysics();
    drawHUD();
    drawGame();
    requestAnimationFrame(gameLoop);
}

function initHUD() {
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
        <div class="hud-panel" style="border-left: 4px solid #ff0055; color: #ff0055">
            CODE: <span id="hud-code" style="color:white; font-weight:bold;"></span>
        </div>
        <div class="hud-panel">LOC: <span id="hud-loc"></span></div>
        <div class="hud-panel">POS: <span id="hud-pos"></span></div>
        <div class="hud-panel">SPD: <span id="hud-spd"></span></div>
        <div class="hud-panel">FUEL: <span id="hud-fuel"></span></div>
        <div class="hud-panel">CASH: <span id="hud-money"></span></div>
        <div class="hud-panel">ROCKS: <span id="hud-rocks"></span></div>
        <div class="hud-panel" style="height:auto">QUEST:<br><span id="hud-quest" style="font-size:0.8em"></span></div>
    `;
    document.body.appendChild(hud);
}
