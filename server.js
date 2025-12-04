console.log("Attempting to start server...");
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Helper: Generate random track
function generateTrack() {
    const planets = [];
    let startX = 400;
    let startY = 300;
    // Generate 10 planets in a sequence
    for (let i = 0; i < 10; i++) {
        planets.push({
            x: startX,
            y: startY,
            radius: 30 + Math.random() * 40,
            color: `hsl(${Math.random() * 360}, 70%, 50%)`,
            isFinish: i === 9
        });
        // Move next planet to a random nearby location
        startX += (Math.random() - 0.5) * 800;
        startY -= (300 + Math.random() * 400); // Always move "up" generally
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
    socket.on('createRoom', () => {
        const roomCode = makeId(4);
        rooms[roomCode] = {
            players: {},
            track: generateTrack(),
            state: 'lobby'
        };
        socket.join(roomCode);
        rooms[roomCode].players[socket.id] = { id: socket.id, x: 0, y: 0, angle: 0, progress: 0, finished: false };
        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('updateLobby', rooms[roomCode].players);
    });

    // Join Room
    socket.on('joinRoom', (roomCode) => {
        if (rooms[roomCode] && rooms[roomCode].state === 'lobby') {
            socket.join(roomCode);
            rooms[roomCode].players[socket.id] = { id: socket.id, x: 0, y: 0, angle: 0, progress: 0, finished: false };
            socket.emit('roomJoined', { code: roomCode, track: rooms[roomCode].track });
            io.to(roomCode).emit('updateLobby', rooms[roomCode].players);
        } else {
            socket.emit('errorMsg', 'Room not found or game started');
        }
    });

    // Start Game
    socket.on('startGame', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].state = 'racing';
            // Send track data to everyone if they haven't got it
            io.to(roomCode).emit('gameStart', rooms[roomCode].track);
        }
    });

    // Player Movement Update
    socket.on('playerMove', (data) => {
        const room = rooms[data.room];
        if (room && room.players[socket.id]) {
            const p = room.players[socket.id];
            p.x = data.x;
            p.y = data.y;
            p.angle = data.angle;
            // Broadcast to others in room (excluding sender usually, but here simply broadcast to all)
            socket.to(data.room).emit('playerMoved', { id: socket.id, x: p.x, y: p.y, angle: p.angle });
        }
    });

    // Player Finished
    socket.on('playerFinished', (roomCode) => {
        if(!rooms[roomCode]) return;
        const player = rooms[roomCode].players[socket.id];
        player.finished = true;
        
        // Calculate rank
        const finishedCount = Object.values(rooms[roomCode].players).filter(p => p.finished).length;
        socket.emit('gameOver', finishedCount); // 1 = 1st place, etc.
    });

    socket.on('disconnect', () => {
        // Cleanup logic would go here
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
