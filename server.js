const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- GAME DATA ---
const rooms = {};

const rng = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function generateGalaxy() {
    const galaxy = {
        space: { width: 10000, height: 10000, objects: [] },
        maps: {} 
    };

    // 1. Stations
    ['Alpha', 'Beta', 'Gamma', 'Delta', 'Omega'].forEach((name, i) => {
        const id = `STATION_${name.toUpperCase()}`;
        const x = rng(-4000, 4000);
        const y = rng(-4000, 4000);
        
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

    // 2. Planets
    for(let i=1; i<=8; i++) {
        const id = `PLANET_${i}`;
        const x = rng(-4500, 4500);
        const y = rng(-4500, 4500);
        const radius = rng(300, 700);
        const color = `hsl(${rng(0, 360)}, 60%, 40%)`;

        galaxy.space.objects.push({ type: 'PLANET', id, x, y, r: radius, color, name: `Planet ${i}` });

        const rocks = [];
        for(let r=0; r<25; r++) rocks.push({ x: rng(100, 1900), y: rng(100, 1900), id: `rock_${i}_${r}` });
        
        galaxy.maps[id] = {
            type: 'SURFACE', width: 2000, height: 2000, color: color,
            exits: [{ x: 1000, y: 1000, to: 'SPACE', spawnX: x, spawnY: y - radius - 50 }],
            resources: rocks
        };
    }
    return galaxy;
}

function generateQuest(galaxy) {
    const types = ['DELIVERY', 'MINING', 'SCOUT'];
    const type = types[Math.floor(Math.random() * types.length)];
    const stations = galaxy.space.objects.filter(o => o.type === 'STATION');
    const planets = galaxy.space.objects.filter(o => o.type === 'PLANET');

    if (type === 'DELIVERY') {
        const target = stations[Math.floor(Math.random() * stations.length)];
        return {
            type: 'DELIVERY',
            targetId: target.id,
            desc: `Deliver data to ${target.name}`,
            reward: 300,
            reqAmount: 0
        };
    } else if (type === 'MINING') {
        const amount = rng(3, 8);
        return {
            type: 'MINING',
            targetId: null, // Any location
            desc: `Bring me ${amount} Rocks`,
            reward: 100 * amount,
            reqAmount: amount
        };
    } else {
        const target = planets[Math.floor(Math.random() * planets.length)];
        return {
            type: 'SCOUT',
            targetId: target.id,
            desc: `Scout surface of ${target.name}`,
            reward: 400,
            reqAmount: 0
        };
    }
}

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomCode] = { galaxy: generateGalaxy(), players: {} };
        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = createPlayer(socket.id);
        socket.emit('roomCreated', { code: roomCode, galaxy: rooms[roomCode].galaxy });
        io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
    });

    socket.on('joinRoom', (roomCode) => {
        if (rooms[roomCode]) {
            socket.join(roomCode);
            rooms[roomCode].players[socket.id] = createPlayer(socket.id);
            socket.emit('joinedRoom', { code: roomCode, galaxy: rooms[roomCode].galaxy });
            io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
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
        // Give new quest
        p.activeQuest = generateQuest(room.galaxy);
        socket.emit('updateSelf', p);
    });

    socket.on('completeQuest', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        const p = room.players[socket.id];
        
        if (!p.activeQuest) return;

        let success = false;
        const q = p.activeQuest;

        // 1. DELIVERY: Must be at target Station
        if (q.type === 'DELIVERY' && p.location === q.targetId) {
            success = true;
        }
        // 2. SCOUT: Must be on target Planet Surface
        else if (q.type === 'SCOUT' && p.location === q.targetId) {
            success = true;
        }
        // 3. MINING: Must have enough rocks (Location doesn't matter)
        else if (q.type === 'MINING' && p.inventory.rocks >= q.reqAmount) {
            p.inventory.rocks -= q.reqAmount; // Take the rocks
