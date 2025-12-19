const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// --- CUSTOM QUEST CONFIG (EDIT THIS!) ---
// ==========================================

const QUEST_TEMPLATES = [
    { type: 'DELIVERY', reward: 300, text: (t) => `Deliver package to ${t}` },
    { type: 'SCOUT',    reward: 400, text: (t) => `Scout the surface of ${t}` },
    { type: 'MINING',   reward: 500, text: (t) => `Mine 5 Rocks` },
    // YOUR NEW QUEST HERE:
    { type: 'SPEED_RUN', reward: 1000, text: (t) => `Reach Speed of 15 (Current Max: ${t})` }
];

// This function decides if a quest is finished
function checkQuestCondition(p, quest) {
    
    // 1. DELIVERY QUEST
    if (quest.type === 'DELIVERY') {
        if (p.location === quest.targetId) return true;
    }

    // 2. SCOUT QUEST
    else if (quest.type === 'SCOUT') {
        if (p.location === quest.targetId) return true;
    }

    // 3. MINING QUEST
    else if (quest.type === 'MINING') {
        if (p.inventory.rocks >= 5) {
            p.inventory.rocks -= 5; // Remove items on completion
            return true;
        }
    }

    // 4. YOUR NEW SPEED QUEST
    // Logic: If their highest recorded speed is > 15
    else if (quest.type === 'SPEED_RUN') {
        if (p.stats.maxSpeed >= 15) return true;
    }

    return false;
}

// ==========================================
// --- END CUSTOM CONFIG ---
// ==========================================

const rooms = {};
const rng = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function generateGalaxy() {
    const galaxy = { space: { width: 10000, height: 10000, objects: [] }, maps: {} };

    // Stations
    ['Alpha', 'Beta', 'Gamma'].forEach((name) => {
        const id = `STATION_${name.toUpperCase()}`;
        const x = rng(-3000, 3000); y = rng(-3000, 3000);
        galaxy.space.objects.push({ type: 'STATION', id, x, y, r: 150, color: '#888', name: `Station ${name}` });
        galaxy.maps[id] = {
            type: 'INTERIOR', width: 800, height: 600, color: '#222',
            exits: [{ x: 400, y: 550, to: 'SPACE', spawnX: x, spawnY: y + 200 }],
            npcs: [
                { id: `NPC_${name}_Q`, x: 200, y: 200, name: `Commander ${name}`, role: 'QUEST_GIVER' },
                { id: `NPC_${name}_S`, x: 600, y: 200, name: `Merchant ${name}`, role: 'SHOP' }
            ]
        };
    });

    // Planets
    for(let i=1; i<=5; i++) {
        const id = `PLANET_${i}`;
        const x = rng(-4000, 4000); y = rng(-4000, 4000);
        const radius = rng(300, 600);
        galaxy.space.objects.push({ type: 'PLANET', id, x, y, r: radius, color: 'green', name: `Planet ${i}` });
        const rocks = [];
        for(let r=0; r<15; r++) rocks.push({ x: rng(100, 1900), y: rng(100, 1900), id: `rock_${i}_${r}` });
        galaxy.maps[id] = {
            type: 'SURFACE', width: 2000, height: 2000, color: 'green',
            exits: [{ x: 1000, y: 1000, to: 'SPACE', spawnX: x, spawnY: y - radius - 50 }],
            resources: rocks
        };
    }
    return galaxy;
}

function generateQuest(galaxy, player) {
    // Pick a random template
    const template = QUEST_TEMPLATES[Math.floor(Math.random() * QUEST_TEMPLATES.length)];
    
    // Setup specific targets
    let targetId = null;
    let targetName = "";

    if (template.type === 'DELIVERY') {
        const stations = galaxy.space.objects.filter(o => o.type === 'STATION');
        const t = stations[Math.floor(Math.random() * stations.length)];
        targetId = t.id; targetName = t.name;
    } 
    else if (template.type === 'SCOUT') {
        const planets = galaxy.space.objects.filter(o => o.type === 'PLANET');
        const t = planets[Math.floor(Math.random() * planets.length)];
        targetId = t.id; targetName = t.name;
    }
    else if (template.type === 'SPEED_RUN') {
        targetName = player.stats.maxSpeed.toFixed(1); // Show current max in description
    }

    return {
        type: template.type,
        targetId: targetId,
        desc: template.text(targetName),
        reward: template.reward
    };
}

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[code] = { galaxy: generateGalaxy(), players: {} };
        socket.join(code);
        rooms[code].players[socket.id] = createPlayer(socket.id);
        socket.emit('roomCreated', { code, galaxy: rooms[code].galaxy });
        io.to(code).emit('updatePlayerList', rooms[code].players);
    });

    socket.on('joinRoom', (code) => {
        if (rooms[code]) {
            socket.join(code);
            rooms[code].players[socket.id] = createPlayer(socket.id);
            socket.emit('joinedRoom', { code, galaxy: rooms[code].galaxy });
            io.to(code).emit('updatePlayerList', rooms[code].players);
        }
    });

    socket.on('mineRock', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        const p = room.players[socket.id];
        const map = room.galaxy.maps[p.location];
        if(map && map.resources) {
            const idx = map.resources.findIndex(r => r.id === data.rockId);
            if(idx !== -1) {
                map.resources.splice(idx, 1);
                p.inventory.rocks++;
                io.to(data.roomCode).emit('mapUpdate', { location: p.location, resources: map.resources });
                socket.emit('updateSelf', p);
            }
        }
    });

    socket.on('acceptQuest', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        const p = room.players[socket.id];
        p.activeQuest = generateQuest(room.galaxy, p);
        socket.emit('updateSelf', p);
    });

    socket.on('completeQuest', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        const p = room.players[socket.id];
        
        if (p.activeQuest && checkQuestCondition(p, p.activeQuest)) {
            p.money += p.activeQuest.reward;
            socket.emit('questSuccess', `Quest Complete! +$${p.activeQuest.reward}`);
            p.activeQuest = null;
            socket.emit('updateSelf', p);
        } else {
            socket.emit('questSuccess', "Requirements not met yet!");
        }
    });

    socket.on('buyUpgrade', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        const p = room.players[socket.id];
        if (data.item === 'fuelMax' && p.money >= 300) {
            p.money -= 300; p.maxFuel += 50; socket.emit('updateSelf', p);
        }
    });

    socket.on('refuel', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        rooms[room.players[socket.id].fuel = rooms[room.players[socket.id].maxFuel]];
    });

    socket.on('playerUpdate', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.players[socket.id]) {
            const p = room.players[socket.id];
            p.x = data.x; p.y = data.y; p.angle = data.angle;
            p.mode = data.mode; p.location = data.location;
            p.fuel = data.fuel;
            
            // Track Max Speed for Quests
            if(data.currentSpeed > p.stats.maxSpeed) {
                p.stats.maxSpeed = data.currentSpeed;
            }

            socket.to(data.roomCode).emit('playerMoved', p);
        }
    });
});

function createPlayer(id) {
    return {
        id,
        color: '#' + Math.floor(Math.random()*16777215).toString(16),
        x: 0, y: 0, angle: 0,
        mode: 'SHIP', location: 'SPACE',
        fuel: 100, maxFuel: 100,
        money: 0,
        inventory: { rocks: 0 },
        activeQuest: null,
        stats: { maxSpeed: 0 } // New stats tracking
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
