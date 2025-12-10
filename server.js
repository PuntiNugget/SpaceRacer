const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Helper: Generate random track
function generateTrack(isOpenWorld) {
    const planets = [];
    let startX = 400;
    let startY = 300;
    
    // If Open World, generate scattered field
    if(isOpenWorld) {
        for(let i=0; i<50; i++) {
            planets.push({
                x: (Math.random() - 0.5) * 10000,
                y: (Math.random() - 0.5) * 10000,
                radius: 50 + Math.random() * 100,
                color: `hsl(${Math.random() * 360}, 70%, 50%)`,
                isFinish: false
            });
        }
    } else {
        // Linear Race Track
        for (let i = 0; i < 10; i++) {
            planets.push({
                x: startX,
                y: startY,
                radius: 30 + Math.random() * 40,
                color: `hsl(${Math.random() * 360}, 70%, 50%)`,
                isFinish: i === 9
            });
            startX += (Math.random() - 0.5) * 800;
            startY -= (300 + Math.random() * 400); 
        }
    }
    return planets;
}

// Helper: Create Room Code
function makeId(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

io.on('connection', (socket) => {
    
    // Create Room
    socket.on('createRoom', (type) => {
        const roomCode = makeId(4);
        const isOpenWorld = (type === 'openworld');
        
        rooms[roomCode] = {
            players: {},
            track: generateTrack(isOpenWorld),
            state: isOpenWorld ? 'openworld' : 'lobby',
            type: type || 'race'
        };
        socket.join(roomCode);
        // Default player
        rooms[roomCode].players[socket.id] = { id: socket.id, x: 0, y: 0, angle: 0, finished: false };
        
        socket.emit('roomCreated', { code: roomCode, type: rooms[roomCode].type });
        io.to(roomCode).emit('updateLobby', rooms[roomCode].players);
        
        // If open world, send track immediately
        if(isOpenWorld) socket.emit('gameStart', rooms[roomCode].track);
    });

    // Join Room
    socket.on('joinRoom', (roomCode) => {
        if (rooms[roomCode]) {
            socket.join(roomCode);
            rooms[roomCode].players[socket.id] = { id: socket.id, x: 0, y: 0, angle: 0, finished: false };
            
            socket.emit('roomJoined', { 
                code: roomCode, 
                track: rooms[roomCode].track,
                type: rooms[roomCode].type
            });
            
            io.to(roomCode).emit('updateLobby', rooms[roomCode].players);
            
            // If joining an active open world
            if(rooms[roomCode].type === 'openworld') {
                 socket.emit('gameStart', rooms[roomCode].track);
            }

        } else {
            socket.emit('errorMsg', 'Room not found');
        }
    });

    // Start Game (Race Mode)
    socket.on('startGame', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].state = 'racing';
            io.to(roomCode).emit('gameStart', rooms[roomCode].track);
        }
    });

    // Player Movement
    socket.on('playerMove', (data) => {
        const room = rooms[data.room];
        if (room && room.players[socket.id]) {
            const p = room.players[socket.id];
            p.x = data.x;
            p.y = data.y;
            p.angle = data.angle;
            socket.to(data.room).emit('playerMoved', { id: socket.id, x: p.x, y: p.y, angle: p.angle });
        }
    });

    // CHAT SYSTEM
    socket.on('chatMessage', (data) => {
        // Broadcast to everyone in the room INCLUDING sender
        io.to(data.room).emit('chatMessage', { id: socket.id, msg: data.msg });
    });

    // Cleanup
    socket.on('disconnect', () => {
        // Basic cleanup logic omitted for brevity
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
