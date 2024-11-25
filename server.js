const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');

const corsOptions = {
    origin: 'https://zakarias666.github.io',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
};

const app = express();
app.use(cors(corsOptions));
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

let players = [];
const rooms = 10;
const roomMax = 2;
const roundTime = 30000;
let roomData = Array.from({ length: rooms }, () => ({
    players: [],
    status: 'open'
}));
const drawData = Array.from({ length: rooms }, () => []);
const chatData = Array.from({ length: rooms }, () => []);

const dictionary = [
    "Abe",
    "Ananas",
    "Bil",
    "Banan",
    "Citron",
    "Dør",
    "Elefant",
    "Fisk",
    "Gul",
    "Hund",
    "Is",
    "Jordbær",
    "Ko",
    "Løve",
    "Mus",
    "Nøgle",
    "Øje",
    "Pære",
    "Robot",
    "Sol",
];

function startNextPlayer(roomIndex) {
    const room = roomData[roomIndex];

    if (!room.players || room.players.length === 0) {
        console.log(`No players in room ${roomIndex + 1}. Skipping turn.`);
        return;
    }

    room.players.forEach((player) => (player.brush = false));

    room.currentPlayerIndex =
        (room.currentPlayerIndex + 1) % room.players.length;

    const currentPlayer = room.players[room.currentPlayerIndex];

    if (!currentPlayer) {
        console.error(
            `No valid current player found for room ${roomIndex + 1}`
        );
        return;
    }

    currentPlayer.brush = true;

    // Vælg et nyt ord fra ordbogen
    const word = dictionary[Math.floor(Math.random() * dictionary.length)];
    room.currentWord = word;

    console.log(
        `Player ${currentPlayer.username} is now drawing the word: ${word}`
    );

    // Ryd tegne- og chatdata
    drawData[roomIndex] = [];
    chatData[roomIndex] = [];

    // Send opdateringer til alle spillere i rummet
    room.players.forEach((player) => {
        if (player.socket.readyState === WebSocket.OPEN) {
            player.socket.send(
                JSON.stringify({
                    
                    data: player.brush ? word : null,
                })
            );

            player.socket.send(
                JSON.stringify({
                    type: 'drawdata',
                    data: [],
                })
            );

            player.socket.send(
                JSON.stringify({
                    type: 'chatdata',
                    data: [],
                })
            );

            // Send roomdata til alle
            player.socket.send(
                JSON.stringify({
                    type: 'roomdata',
                    data: {
                        players: room.players.map(({ username, score, brush }) => ({
                            username,
                            score,
                            brush,
                        })),
                        status: room.status,
                        currentWord: room.currentWord,
                    },
                })
            );
        }
    });

    clearTimeout(room.timer);
    room.timer = setTimeout(() => startNextPlayer(roomIndex), roundTime);
};

wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'roomcount', data: rooms }));
    socket.send(JSON.stringify({ type: 'roommax', data: roomMax }));
    socket.send(JSON.stringify({ type: 'roundtime', data: roundTime }));
    const sanitizedRoomData = roomData.map((room) => ({
        ...room,
        timer: undefined,
        players: room.players.map(({ username, score, brush }) => ({
            username,
            score,
            brush,
        })),
        currentWord: room.currentWord,
        currentPlayerIndex: room.currentPlayerIndex,
    }));
    
    socket.send(JSON.stringify({ type: 'roomdata', data: sanitizedRoomData }));
    
    console.log('A new player connected!');
    
    players.push(socket);

    socket.on('message', (data) => {
        const message = JSON.parse(data);

        if (message.type === 'draw') {
            const roomIndex = message.data.id - 1;
        
            if (!drawData[roomIndex]) drawData[roomIndex] = [];
            if (drawData[roomIndex].length === 0) {
                drawData[roomIndex].push([]);
            }
        
            drawData[roomIndex][drawData[roomIndex].length - 1].push(message.data.point);
        
            roomData[roomIndex].players.forEach((player) => {
                if (player.socket !== socket && player.socket.readyState === WebSocket.OPEN) {
                    player.socket.send(JSON.stringify({ type: 'draw', data: { point: message.data.point } }));
                }
            });
        } else if (message.type === 'guess') {
            const roomIndex = message.data.id - 1;
        
            if (message.data.guess && message.data.username) {
                const room = roomData[roomIndex];
                const guessEntry = { username: message.data.username, guess: message.data.guess };
                
                chatData[roomIndex].push(guessEntry);
        
                // Tjek om gættet er korrekt
                if (message.data.guess.toLowerCase() === room.currentWord.toLowerCase()) {
                    console.log(`${message.data.username} guessed the word correctly: ${room.currentWord}`);
        
                    // Find spilleren og giv point
                    const player = room.players.find(player => player.username === message.data.username);
                    if (player) {
                        player.score += 10; // Juster pointværdien efter behov
                    }
        
                    // Send besked om korrekt gæt til alle spillere i rummet
                    room.players.forEach((player) => {
                        if (player.socket.readyState === WebSocket.OPEN) {
                            player.socket.send(JSON.stringify({
                                type: 'correctGuess',
                                data: { username: message.data.username, word: room.currentWord }
                            }));
                        }
                    });
        
                    // Skift til næste spiller
                    startNextPlayer(roomIndex);
                    return; 
                }
        
                // Send beskeden til alle spillere i rummet
                room.players.forEach((player) => {
                    if (player.socket.readyState === WebSocket.OPEN) {
                        player.socket.send(JSON.stringify({ type: 'guess', data: guessEntry }));
                    }
                });
        
                console.log('Guess message received:', guessEntry);
            } else {
                console.error('Invalid guess message:', message.data);
            }
        }
         else if (message.type === 'join') {
            const roomIndex = message.data.id - 1;
        
            if (roomData[roomIndex].status !== 'open') {
                socket.send(JSON.stringify({ type: 'error', message: 'Cannot join. Game in progress.' }));
                return;
            }
        
            console.log(message.data.username, 'joined room:', message.data.id);
        
            roomData[roomIndex].players.push({
                username: message.data.username,
                score: 0,
                brush: false,
                socket: socket
            });
        
            socket.send(JSON.stringify({ type: 'drawdata', data: drawData[roomIndex] }));
            socket.send(JSON.stringify({ type: 'chatdata', data: chatData[roomIndex] }));
        
            updateRooms();
        } else if (message.type === 'start') {
            console.log('Game started in room:', message.data.id);
        
            const roomIndex = message.data.id - 1;
            const room = roomData[roomIndex];
        
            room.status = 'in-progress';
            room.currentPlayerIndex = 0; // Start med den første spiller
        
            room.players.forEach((player, index) => {
                player.brush = index === 0; // Første spiller får brush
            });
        
            // Send `start`-besked til alle spillere
            room.players.forEach((player) => {
                if (player.socket.readyState === WebSocket.OPEN) {
                    player.socket.send(
                        JSON.stringify({
                            type: 'start',
                            data: { id: message.data.id }, // Inkluder rumnummer
                        })
                    );
                }
            });
        
            // Start første spiller og rotationslogik
            startNextPlayer(roomIndex);
        
            updateRooms();
        } else if (message.type === 'newStroke') {
            const roomIndex = message.data.id - 1;
        
            if (!drawData[roomIndex]) drawData[roomIndex] = [];
            drawData[roomIndex].push([]); // Start en ny streg
        
            if (roomData[roomIndex].players) {
                roomData[roomIndex].players.forEach((player) => {
                    if (player.socket !== socket && player.socket.readyState === WebSocket.OPEN) {
                        player.socket.send(JSON.stringify({ type: 'newStroke' }));
                    }
                });
            }
        } else if (message.type === 'leave') {
            console.log(message.data.username, 'left room:', message.data.id);
            const roomIndex = message.data.id - 1;

            roomData[roomIndex].players = roomData[roomIndex].players.filter(
                (player) => player.socket !== socket
            );

            if (roomData[roomIndex].players.length === 0) {
                // Nulstil rummet, hvis det er tomt
                roomData[roomIndex].status = 'open';
                roomData[roomIndex].currentWord = null;
                roomData[roomIndex].currentPlayerIndex = 0;
                clearTimeout(roomData[roomIndex].timer);
                drawData[roomIndex] = [];
                chatData[roomIndex] = [];
                console.log(`Room ${roomIndex + 1} reset.`);
            }

            updateRooms();
        }
    });

    const updateRooms = () => {
        const sanitizedRoomData = roomData.map((room) => ({
            ...room,
            timer: undefined, // Fjern `timer` for at undgå JSON.stringify-problemer
            players: room.players.map(({ username, score, brush }) => ({
                username,
                score,
                brush,
            })),
            currentWord: room.currentWord, // Inkluder currentWord
            currentPlayerIndex: room.currentPlayerIndex, // Inkluder currentPlayerIndex
        }));
    
        players.forEach((player) => {
            if (player.readyState === WebSocket.OPEN) {
                player.send(
                    JSON.stringify({ type: 'roomdata', data: sanitizedRoomData })
                );
            }
        });
    };
    
    
    

    
    

    socket.on('close', () => {
        console.log('Player disconnected!');
        players = players.filter((player) => player !== socket);

        roomData.forEach((room, index) => {
            room.players = room.players.filter((player) => player.socket !== socket);

            if (room.players.length === 0) {
                room.status = 'open';
                room.currentWord = null;
                room.currentPlayerIndex = 0;
                clearTimeout(room.timer);
                drawData[index] = [];
                chatData[index] = [];
                console.log(`Room ${index + 1} reset due to disconnect.`);
            }
        });

        updateRooms();
    });
});

server.listen(3000, () => {
    console.log('Server started :)');
});
