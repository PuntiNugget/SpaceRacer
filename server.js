// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Game State Storage
const rooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Create a Room
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            host: socket.id,
            players: {},
            gameStarted: false,
            trackIndex: 0 // Default track
        };
        rooms[roomCode].players[socket.id] = {
            id: socket.id,
            color: '#FF0000', // Host is Red
            x: 100,
            y: 100,
            angle: 0,
            isHost: true
        };
        
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
        socket.emit('updatePlayerList', rooms[roomCode].players);
    });

    // Join a Room
    socket.on('joinRoom', (roomCode) => {
        if (rooms[roomCode] && !rooms[roomCode].gameStarted) {
            rooms[roomCode].players[socket.id] = {
                id: socket.id,
                color: '#' + Math.floor(Math.random()*16777215).toString(16), // Random color
                x: 100,
                y: 100,
                angle: 0,
                isHost: false
            };
            socket.join(roomCode);
            socket.emit('joinedRoom', roomCode);
            
            // Notify everyone in room of new player
            io.to(roomCode).emit('updatePlayerList', rooms[roomCode].players);
        } else {
            socket.emit('error', 'Room not found or game started');
        }
    });

    // Start Game (Host Only)
    socket.on('startGame', (roomCode) => {
        if (rooms[roomCode] && rooms[roomCode].host === socket.id) {
            rooms[roomCode].gameStarted = true;
            // Select a random track or use a specific one
            const selectedTrack = Math.floor(Math.random() * 5); 
            io.to(roomCode).emit('gameStart', { trackIndex: selectedTrack });
        }
    });

    // Player Movement Updates
    socket.on('playerUpdate', (data) => {
        const roomCode = data.roomCode;
        if (rooms[roomCode] && rooms[roomCode].players[socket.id]) {
            // Update server state (basic validation could go here)
            const p = rooms[roomCode].players[socket.id];
            p.x = data.x;
            p.y = data.y;
            p.angle = data.angle;

            // Broadcast to others in the room (excluding sender if desired, but io.to includes sender)
            socket.to(roomCode).emit('playerMoved', {
                id: socket.id,
                x: p.x,
                y: p.y,
                angle: p.angle
            });
        }
    });

    socket.on('disconnect', () => {
        // Cleanup logic would go here (removing players from rooms)
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
