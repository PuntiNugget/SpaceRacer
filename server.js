const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const CHUNK_SIZE = 2000; 

// Helper: Linear Race Track
function generateRaceTrack() {
    const items = { planets: [], hazards: [], spawnPoints: [] }; // spawnPoints added for consistency
    let startX = 400;
    let startY = 300;
    
    // Race Spawn
    items.spawnPoints.push({ x: 400, y: 300 });

    for (let i = 0; i < 20; i++) {
        items.planets.push({
            id: `p_${i}`,
            x: startX, y: startY,
            radius: 40 + Math.random() * 40,
            color: `hsl(${Math.random() * 360}, 70%, 50%)`,
            isFinish: i === 19
        });
        startX += (Math.random() - 0.5) * 1000;
        startY -= (500 + Math.random() * 400); 
    }
    return items;
}

// Helper: Chunk Generation
function generateChunkData(cx, cy) {
    const items = { planets: [], hazards: [], spawnPoints: [] };
    const offsetX = cx * CHUNK_SIZE;
    const offsetY = cy * CHUNK_SIZE;

    // 1. Generate Spawn Point (Safe Zone)
    // Always put one at 0,0. Otherwise 40% chance per chunk.
    if ((cx === 0 && cy === 0) || Math.random() < 0.4) {
        items.spawnPoints.push({
            id: `sp_${cx}_${cy}`,
            x: offsetX + (Math.random() * CHUNK_SIZE),
            y: offsetY + (Math.random() * CHUNK_SIZE),
            radius: 40 // Visual radius of beacon
        });
    }

    // 2. Generate Planets
    const planetCount = Math.floor(Math.random() * 3);
    for(let i=0; i<planetCount; i++) {
        items.planets.push({
            id: `chunk_${cx}_${cy}_p_${i}`,
            x: offsetX + Math.random() * CHUNK_SIZE,
            y: offsetY + Math.random() * CHUNK_SIZE,
            radius: 50 + Math.random() * 100,
            color: `hsl(${Math.random() * 360}, 60%, 45%)`,
            isFinish: false
        });
    }

    // 3. Generate Hazards
    const hazardCount = Math.floor(Math.random() * 4); 
    for(let i=0; i<hazardCount; i++) {
        const typeRoll = Math.random();
        let type = 'meteor';
        if(typeRoll > 0.8) type = 'blackhole';
        else if(typeRoll > 0.95) type = 'wormhole';

        items.hazards.push({
            id: `chunk_${cx}_${cy}_h_${i}`,
            type: type,
            x: offsetX + Math.random() * CHUNK_SIZE,
            y: offsetY + Math.random() * CHUNK_SIZE,
            radius: type === 'meteor' ? 20 + Math.random() * 30 : 0,
            vx: type === 'meteor' ? (Math.random()-0.5) * 5 : 0, // Faster meteors
            vy: type === 'meteor' ? (Math.random()-0.5) * 5 : 0
        });
    }

    return items;
}

function makeId(length) {
    let result = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

io.on('connection', (socket) => {
    
    socket.on('createRoom', (type) => {
        const roomCode = makeId(4);
        const isOpenWorld = (type === 'openworld');
        
        rooms[roomCode] = {
            players: {},
            chunks: {}, 
            trackData: isOpenWorld ? null : generateRaceTrack(),
            type: type || 'race'
        };
        
        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = { id: socket.id, x: 0, y: 0, angle: 0 };
        
        socket.emit('roomCreated', { code: roomCode, type: rooms[roomCode].type });
        io.to(roomCode).emit('updateLobby', rooms[roomCode].players);
        
        if(!isOpenWorld) socket.emit('gameStart', rooms[roomCode].trackData);
    });

    socket.on('joinRoom', (roomCode) => {
        if (rooms[roomCode]) {
            socket.join(roomCode);
            rooms[roomCode].players[socket.id] = { id: socket.id, x: 0, y: 0, angle: 0 };
            
            socket.emit('roomJoined', { 
                code: roomCode, 
                type: rooms[roomCode].type,
                trackData: rooms[roomCode].trackData 
            });
            io.to(roomCode).emit('updateLobby', rooms[roomCode].players);
            if(rooms[roomCode].type === 'race') socket.emit('gameStart', rooms[roomCode].trackData);
        } else {
            socket.emit('errorMsg', 'Room not found');
        }
    });

    socket.on('startGame', (roomCode) => {
        if (rooms[roomCode] && rooms[roomCode].type === 'race') {
            io.to(roomCode).emit('gameStart', rooms[roomCode].trackData);
        }
    });

    socket.on('playerMove', (data) => {
        const room = rooms[data.room];
        if (!room) return;
        
        if(room.players[socket.id]) {
            const p = room.players[socket.id];
            p.x = data.x;
            p.y = data.y;
            p.angle = data.angle;
            socket.to(data.room).emit('playerMoved', { id: socket.id, x: p.x, y: p.y, angle: p.angle });

            // Chunk Logic
            if(room.type === 'openworld') {
                const chunkX = Math.floor(p.x / CHUNK_SIZE);
                const chunkY = Math.floor(p.y / CHUNK_SIZE);

                // Load 3x3 area
                for(let cx = chunkX - 1; cx <= chunkX + 1; cx++) {
                    for(let cy = chunkY - 1; cy <= chunkY + 1; cy++) {
                        const chunkKey = `${cx},${cy}`;
                        if(!room.chunks[chunkKey]) {
                            const newChunk = generateChunkData(cx, cy);
                            room.chunks[chunkKey] = newChunk;
                            io.to(data.room).emit('newChunk', newChunk);
                        }
                    }
                }
            }
        }
    });

    socket.on('chatMessage', (data) => {
        io.to(data.room).emit('chatMessage', { id: socket.id, msg: data.msg });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
