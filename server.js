// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Explorer connected:', socket.id);

    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            host: socket.id,
            players: {} // No gameStarted flag needed for open world
        };
        // Initialize Host in Deep Space
        rooms[roomCode].players[socket.id] = {
            id: socket.id,
            color: '#00FF00',
            x: 0, y: 0, 
            angle: 0,
            mode: 'SHIP', // SHIP or WALK
            location: 'SPACE' // SPACE, STATION_1, PLANET_RED
        };
        
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        socket.emit('updatePlayerList', rooms[roomCode].players);
    });

    socket.on('joinRoom', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].players[socket.id] = {
                id: socket.id,
                color: '#' + Math.floor(Math.random()*16777215).toString(16),
                x: 0, y: 0, 
                angle: 0,
                mode: 'SHIP',
                location: 'SPACE'
            };
            socket.join(roomCode);
            socket.emit('joinedRoom', roomCode);
            io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
        }
    });

    // Unified Update Handler
    socket.on('playerUpdate', (data) => {
        const roomCode = data.roomCode;
        if (rooms[roomCode] && rooms[roomCode].players[socket.id]) {
            const p = rooms[roomCode].players[socket.id];
            p.x = data.x;
            p.y = data.y;
            p.angle = data.angle;
            p.mode = data.mode;
            p.location = data.location;

            // Broadcast to room
            socket.to(roomCode).emit('playerMoved', {
                id: socket.id,
                x: p.x, y: p.y, angle: p.angle,
                mode: p.mode,
                location: p.location
            });
        }
    });

    socket.on('disconnect', () => {
        // In a real app, we'd clean up the room object here
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
