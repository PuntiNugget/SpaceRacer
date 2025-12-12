const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const CHUNK_SIZE = 2000; 

// Helper: Generate Linear Race Track with Side Barriers
function generateRaceTrack() {
    const items = { planets: [], hazards: [], spawnPoints: [], walls: [] };
    
    // Spawn is always safe at 0,0
    items.spawnPoints.push({ x: 0, y: 0, radius: 50 });

    let currentX = 0;
    let currentY = 0;
    const trackWidth = 1000; // Width of the safe corridor

    // Generate Path Nodes
    for (let i = 0; i < 25; i++) {
        // Calculate next point (move generally UP and slightly Random X)
        // First point is further away to give spawn space
        const moveY = (i === 0) ? -1200 : -(800 + Math.random() * 400); 
        const moveX = (Math.random() - 0.5) * 1500;

        const nextX = currentX + moveX;
        const nextY = currentY + moveY;

        // Add Planet at the center of the path node
        items.planets.push({
            id: `p_${i}`,
            x: nextX, 
            y: nextY,
            radius: 60 + Math.random() * 60,
            color: `hsl(${Math.random() * 360}, 70%, 50%)`,
            isFinish: i === 24 // Last planet is finish
        });

        // --- WALL GENERATION (The Tunnel) ---
        // Calculate the angle between current point and next point
        const angle = Math.atan2(nextY - currentY, nextX - currentX);
        const dist = Math.hypot(nextX - currentX, nextY - currentY);
        
        // Midpoint between current and next
        const midX = (currentX + nextX) / 2;
        const midY = (currentY + nextY) / 2;

        // Left Wall Position (Perpendicular -90 deg)
        // Cos/Sin math ensures walls stay parallel to the path
        items.walls.push({
            id: `w_l_${i}`,
            x: midX + Math.cos(angle - Math.PI/2) * trackWidth,
            y: midY + Math.sin(angle - Math.PI/2) * trackWidth,
            w: dist + 100, // Length matches distance
            h: 50,         // Thickness
            angle: angle   // Rotate to match path direction
        });

        // Right Wall Position (Perpendicular +90 deg)
        items.walls.push({
            id: `w_r_${i}`,
            x: midX + Math.cos(angle + Math.PI/2) * trackWidth,
            y: midY + Math.sin(angle + Math.PI/2) * trackWidth,
            w: dist + 100,
            h: 50,
            angle: angle
        });

        // Add occasional hazards strictly in the middle of the path
        if(i > 2 && i < 24 && Math.random() < 0.4) {
            items.hazards.push({
                id: `h_${i}`,
                type: 'meteor',
                x: midX,
                y: midY,
                radius: 40,
                vx: (Math.random()-0.5)*2, vy: (Math.random()-0.5)*2
            });
        }

        // Update current for next loop
        currentX = nextX;
        currentY = nextY;
    }

    return items;
}

// Helper: Chunk Generation (Open World)
function generateChunkData(cx, cy) {
    const items = { planets: [], hazards: [], spawnPoints: [], walls: [] };
    const offsetX = cx * CHUNK_SIZE;
    const offsetY = cy * CHUNK_SIZE;

    if ((cx === 0 && cy === 0) || Math.random() < 0.3) {
        items.spawnPoints.push({
            id: `sp_${cx}_${cy}`,
            x: offsetX + Math.random() * CHUNK_SIZE,
            y: offsetY + Math.random() * CHUNK_SIZE,
            radius: 40
        });
    }

    const planetCount = Math.floor(Math.random() * 2) + 1;
    for(let i=0; i<planetCount; i++) {
        items.planets.push({
            id: `chunk_${cx}_${cy}_p_${i}`,
            x: offsetX + Math.random() * CHUNK_SIZE,
            y: offsetY + Math.random() * CHUNK_SIZE,
            radius: 60 + Math.random() * 80,
            color: `hsl(${Math.random() * 360}, 60%, 45%)`,
            isFinish: false
        });
    }

    // Open World Walls are random obstacles
    const wallCount = Math.floor(Math.random() * 3);
    for(let i=0; i<wallCount; i++) {
        items.walls.push({
            id: `chunk_${cx}_${cy}_w_${i}`,
            x: offsetX + Math.random() * CHUNK_SIZE,
            y: offsetY + Math.random() * CHUNK_SIZE,
            w: 300 + Math.random() * 400,
            h: 30 + Math.random() * 50,
            angle: Math.random() * Math.PI
        });
    }

    const hazardCount = Math.floor(Math.random() * 3); 
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
            vx: type === 'meteor' ? (Math.random()-0.5) * 6 : 0,
            vy: type === 'meteor' ? (Math.random()-0.5) * 6 : 0
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
    
    // --- NEW: MATCHMAKING LOGIC ---
    socket.on('findOpenWorld', () => {
        // Look for an existing Open World room that isn't full
        const foundRoomId = Object.keys(rooms).find(id => {
            const r = rooms[id];
            return r.type === 'openworld' && Object.keys(r.players).length < 20;
        });

        if (foundRoomId) {
            // Join existing
            socket.emit('matchFound', foundRoomId);
        } else {
            // Create new
            const newCode = makeId(4);
            rooms[newCode] = {
                players: {},
                chunks: {},
                trackData: null,
                type: 'openworld'
            };
            socket.emit('matchFound', newCode);
        }
    });

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

            if(room.type === 'openworld') {
                const chunkX = Math.floor(p.x / CHUNK_SIZE);
                const chunkY = Math.floor(p.y / CHUNK_SIZE);
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

    socket.on('placeObject', (data) => {
        const room = rooms[data.room];
        if(!room || room.type !== 'openworld') return;
        const chunkX = Math.floor(data.x / CHUNK_SIZE);
        const chunkY = Math.floor(data.y / CHUNK_SIZE);
        const chunkKey = `${chunkX},${chunkY}`;
        if(!room.chunks[chunkKey]) room.chunks[chunkKey] = generateChunkData(chunkX, chunkY);

        const newWall = {
            id: `usr_${makeId(6)}`,
            x: data.x, y: data.y, w: data.w, h: data.h, angle: data.angle, isUser: true
        };
        room.chunks[chunkKey].walls.push(newWall);
        io.to(data.room).emit('objectPlaced', newWall);
    });

    socket.on('chatMessage', (data) => {
        io.to(data.room).emit('chatMessage', { id: socket.id, msg: data.msg });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
