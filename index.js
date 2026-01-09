const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

/* ---------------- MIDDLEWARE ---------------- */
app.use(cors());
app.use(express.json());

/* ---------------- ROOT TEST ROUTE ---------------- */
app.get("/", (req, res) => {
  res.send("🚀 Quiz Backend is running successfully");
});

/* ---------------- SOCKET.IO CONFIG (FIXED) ---------------- */
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"], // IMPORTANT
  allowEIO3: true,
});

/* ---------------- IN-MEMORY STORAGE ---------------- */
const rooms = {};
/*
rooms = {
  roomId: {
    hostId,
    currentQuestionIndex,
    questions: [],
    players: {
      socketId: { name, score }
    }
  }
}
*/

/* ---------------- SOCKET EVENTS ---------------- */
io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  /* CREATE ROOM (HOST) */
  socket.on("createRoom", ({ roomId }) => {
    rooms[roomId] = {
      hostId: socket.id,
      currentQuestionIndex: 0,
      questions: [],
      players: {},
    };

    socket.join(roomId);
    socket.emit("roomCreated", { roomId });
  });

  /* JOIN ROOM (PLAYER) */
  socket.on("joinRoom", ({ roomId, name }) => {
    if (!rooms[roomId]) {
      socket.emit("errorMessage", "Room not found");
      return;
    }

    rooms[roomId].players[socket.id] = {
      name,
      score: 0,
    };

    socket.join(roomId);
    io.to(roomId).emit("playersUpdated", rooms[roomId].players);
  });

  /* ADD QUESTION (HOST ONLY) */
  socket.on("addQuestion", ({ roomId, question }) => {
    if (rooms[roomId]?.hostId !== socket.id) return;
    rooms[roomId].questions.push(question);
  });

  /* START QUIZ */
  socket.on("startQuiz", ({ roomId }) => {
    sendQuestion(roomId);
  });

  /* SUBMIT ANSWER */
  socket.on("submitAnswer", ({ roomId, selectedIndex }) => {
    const room = rooms[roomId];
    if (!room) return;

    const question = room.questions[room.currentQuestionIndex];
    if (!question) return;

    const isCorrect = question.correctIndex === selectedIndex;

    if (isCorrect && room.players[socket.id]) {
      room.players[socket.id].score += 1;
    }

    socket.emit("answerResult", { correct: isCorrect });
  });

  /* NEXT QUESTION (HOST ONLY) */
  socket.on("nextQuestion", ({ roomId }) => {
    const room = rooms[roomId];
    if (room?.hostId !== socket.id) return;

    room.currentQuestionIndex++;
    sendQuestion(roomId);
  });

  /* DISCONNECT */
  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
    for (const roomId in rooms) {
      delete rooms[roomId].players[socket.id];
      io.to(roomId).emit("playersUpdated", rooms[roomId].players);
    }
  });
});

/* ---------------- HELPER FUNCTION ---------------- */
function sendQuestion(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const question = room.questions[room.currentQuestionIndex];

  if (!question) {
    io.to(roomId).emit("quizEnded", room.players);
    return;
  }

  io.to(roomId).emit("newQuestion", {
    index: room.currentQuestionIndex,
    question: question.question,
    options: question.options,
  });
}

/* ---------------- START SERVER ---------------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Quiz server running on port ${PORT}`);
});
