// server.js
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

// Helper: Random Range
const rng = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Helper: Generate a unique Galaxy for the room
function generateGalaxy() {
    const galaxy = {
        space: { width: 10000, height: 10000, objects: [] },
        maps: {} // Stores detailed maps for Planets/Stations
    };

    // 1. Generate 3 Space Stations (Safe Zones)
    const stationNames = ['Alpha', 'Beta', 'Gamma'];
    stationNames.forEach((name, index) => {
        const id = `STATION_${name}`;
        const x = rng(-3000, 3000);
        const y = rng(-3000, 3000);
        
        // Add to Space View
        galaxy.space.objects.push({ type: 'STATION', id, x, y, r: 150, color: '#888', name: `Station ${name}` });

        // Generate Interior Map
        galaxy.maps[id] = {
            type: 'INTERIOR', width: 800, height: 600, color: '#222',
            exits: [{ x: 400, y: 550, to: 'SPACE', spawnX: x, spawnY: y + 200 }],
            npcs: [
                { id: `NPC_${name}_1`, x: 200, y: 200, name: `Commander ${name}`, role: 'QUEST_GIVER' },
                { id: `NPC_${name}_SHOP`, x: 600, y: 200, name: `Merchant ${name}`, role: 'SHOP' }
            ]
        };
    });

    // 2. Generate 5 Random Planets
    for(let i=1; i<=5; i++) {
        const id = `PLANET_${i}`;
        const x = rng(-4000, 4000);
        const y = rng(-4000, 4000);
        const radius = rng(300, 600);
        const color = `hsl(${rng(0, 360)}, 60%, 40%)`;

        galaxy.space.objects.push({ type: 'PLANET', id, x, y, r: radius, color, name: `Planet ${i}` });

        // Generate Surface Map
        const rocks = [];
        for(let r=0; r<20; r++) rocks.push({ x: rng(100, 1900), y: rng(100, 1900), id: `rock_${i}_${r}` });
        
        galaxy.maps[id] = {
            type: 'SURFACE', width: 2000, height: 2000, color: color,
            exits: [{ x: 1000, y: 1000, to: 'SPACE', spawnX: x, spawnY: y - radius - 50 }],
            resources: rocks
        };
    }

    return galaxy;
}

// Generate a random Quest
function generateQuest(galaxy) {
    const types = ['DELIVERY', 'GATHER'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    if (type === 'DELIVERY') {
        // Find two random stations
        const stations = galaxy.space.objects.filter(o => o.type === 'STATION');
        const target = stations[Math.floor(Math.random() * stations.length)];
        return {
            type: 'DELIVERY',
            targetId: target.id,
            targetName: target.name,
            desc: `Deliver strict orders to ${target.name}.`,
            reward: 200
        };
    } else {
        return {
            type: 'GATHER',
            amount: 5,
            desc: `Bring back 5 Space Rocks.`,
            reward: 150
        };
    }
}

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomCode] = {
            galaxy: generateGalaxy(),
            players: {}
        };
        socket.join(roomCode);
        
        // Initialize Player Data
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

    // Player Interaction Events
    socket.on('mineRock', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        const p = room.players[socket.id];
        
        // Remove rock from server state (basic implementation)
        const map = room.galaxy.maps[p.location];
        if(map && map.resources) {
            const idx = map.resources.findIndex(r => r.id === data.rockId);
            if(idx !== -1) {
                map.resources.splice(idx, 1);
                p.inventory.rocks++;
                io.to(data.roomCode).emit('mapUpdate', { location: p.location, resources: map.resources });
                socket.emit('updateSelf', p); // Sync inventory
            }
        }
    });

    socket.on('acceptQuest', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        const p = room.players[socket.id];
        p.activeQuest = generateQuest(room.galaxy);
        socket.emit('updateSelf', p);
    });

    socket.on('completeQuest', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        const p = room.players[socket.id];
        
        if (p.activeQuest) {
            let success = false;
            if (p.activeQuest.type === 'GATHER' && p.inventory.rocks >= p.activeQuest.amount) {
                p.inventory.rocks -= p.activeQuest.amount;
                success = true;
            } else if (p.activeQuest.type === 'DELIVERY' && p.location === p.activeQuest.targetId) {
                success = true;
            }

            if(success) {
                p.money += p.activeQuest.reward;
                p.activeQuest = null;
                socket.emit('updateSelf', p);
                socket.emit('questSuccess', 'Quest Complete!');
            }
        }
    });

    socket.on('buyUpgrade', (data) => {
        const room = rooms[data.roomCode];
        if(!room) return;
        const p = room.players[socket.id];
        
        if (data.item === 'fuelMax' && p.money >= 300) {
            p.money -= 300;
            p.maxFuel += 50;
            socket.emit('updateSelf', p);
        }
    });

    // Unified Movement Update
    socket.on('playerUpdate', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.players[socket.id]) {
            const p = room.players[socket.id];
            Object.assign(p, { ...data, inventory: p.inventory, money: p.money, activeQuest: p.activeQuest }); // Protect server-side fields
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
        activeQuest: null
    };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
