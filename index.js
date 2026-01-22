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
      socketId: { 
        name, 
        score,
        hasAnswered,
        currentAnswer
      }
    },
    currentQuestion: {
      question: string,
      options: [string, string, string, string],
      index: number
    },
    currentCorrectAnswer: number,
    isActive: boolean,
    isQuizEnded: boolean,
    totalQuestions: number
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
      isQuizEnded: false,
      totalQuestions: 0,
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
      hasAnswered: false,
      currentAnswer: null,
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
    if (!roomId || !rooms[roomId]) {
      socket.emit('errorMessage', 'Room not found');
      return;
    }
    
    const room = rooms[roomId];
    const player = room.players[socket.id];
    
    if (!player) {
      socket.emit('errorMessage', 'Player not found in room');
      return;
    }
    
    if (player.hasAnswered) {
      socket.emit('errorMessage', 'You have already answered this question');
      return;
    }

    if (room.isQuizEnded) {
      socket.emit('errorMessage', 'Quiz has ended');
      return;
    }
    
    // Mark player as answered
    player.hasAnswered = true;
    player.currentAnswer = selectedIndex;
    
    // Check if answer is correct - handle both manual questions and stored questions
    let isCorrect = false;
    let correctIndex = -1;
    
    if (room.currentCorrectAnswer !== undefined) {
      // Manual question - use stored correct answer
      correctIndex = room.currentCorrectAnswer;
      isCorrect = selectedIndex === correctIndex;
    } else {
      // Stored question - use original logic
      const question = room.questions[room.currentQuestionIndex];
      if (question) {
        correctIndex = question.correctIndex;
        isCorrect = question.correctIndex === selectedIndex;
      }
    }
    
    if (isCorrect) {
      player.score += 1; // Increment score for correct answer
    }
    
    // Send result back to the player
    socket.emit('answerResult', {
      correct: isCorrect,
      correctIndex: correctIndex,
      currentScore: player.score,
      questionNumber: room.currentQuestionIndex + 1
    });
    
    // Update all players about score changes
    const playersData = {};
    Object.keys(room.players).forEach(playerId => {
      playersData[playerId] = {
        name: room.players[playerId].name,
        score: room.players[playerId].score,
        hasAnswered: room.players[playerId].hasAnswered
      };
    });
    
    io.to(roomId).emit('playersUpdated', playersData);
    
    console.log(`Player ${player.name} answered question ${room.currentQuestionIndex + 1} in room ${roomId}:`, {
      selectedIndex,
      isCorrect,
      newScore: player.score
    });
  });

  /* NEXT QUESTION (HOST ONLY) */
  socket.on("nextQuestion", ({ roomId }) => {
    const room = rooms[roomId];
    if (room?.hostId !== socket.id) return;

    if (room.isQuizEnded) {
      socket.emit('errorMessage', 'Quiz has already ended');
      return;
    }

    room.currentQuestionIndex++;
    
    // Reset player answers for new question
    Object.keys(room.players).forEach(playerId => {
      if (room.players[playerId]) {
        room.players[playerId].hasAnswered = false;
        room.players[playerId].currentAnswer = null;
      }
    });

    sendQuestion(roomId);
  });

  /* END QUIZ (HOST ONLY) */
  socket.on("endQuiz", ({ roomId }) => {
    const room = rooms[roomId];
    if (room?.hostId !== socket.id) {
      socket.emit('errorMessage', 'Only the host can end the quiz');
      return;
    }

    if (room.isQuizEnded) {
      socket.emit('errorMessage', 'Quiz has already ended');
      return;
    }

    // Mark quiz as ended
    room.isQuizEnded = true;

    // Calculate final results
    const finalResults = [];
    Object.keys(room.players).forEach(playerId => {
      const player = room.players[playerId];
      finalResults.push({
        playerId,
        name: player.name,
        score: player.score,
        totalQuestions: room.currentQuestionIndex + 1,
        percentage: room.currentQuestionIndex >= 0 ? Math.round((player.score / (room.currentQuestionIndex + 1)) * 100) : 0
      });
    });

    // Sort by score (highest first)
    finalResults.sort((a, b) => b.score - a.score);

    // Send final results to all participants and host
    io.to(roomId).emit("quizEnded", {
      results: finalResults,
      totalQuestions: room.currentQuestionIndex + 1,
      endedBy: 'host'
    });

    console.log(`Quiz ended by host in room ${roomId}. Final results:`, finalResults);
  });

  /* HANDLE MANUAL QUESTIONS FROM HOST */
  socket.on('sendManualQuestion', (data) => {
    const { roomId, question, options, correctIndex } = data;
    
    console.log(`Manual question from host in room ${roomId}:`, {
      question,
      options,
      correctIndex
    });
    
    if (!roomId || !rooms[roomId]) {
      socket.emit('errorMessage', 'Room not found');
      return;
    }
    
    const room = rooms[roomId];
    
    // Verify that the sender is the host
    if (room.hostId !== socket.id) {
      socket.emit('errorMessage', 'Only the host can send questions');
      return;
    }

    if (room.isQuizEnded) {
      socket.emit('errorMessage', 'Quiz has already ended');
      return;
    }
    
    // Validate question data
    if (!question || !options || options.length !== 4 || correctIndex < 0 || correctIndex > 3) {
      socket.emit('errorMessage', 'Invalid question format');
      return;
    }

    // Increment question index for new question
    if (room.isActive) {
      room.currentQuestionIndex++;
    }
    
    // Create question object (don't send correctIndex to participants)
    const questionData = {
      question: question.trim(),
      options: options.map(opt => opt.trim()),
      index: room.currentQuestionIndex,
      questionNumber: room.currentQuestionIndex + 1
    };
    
    // Store the correct answer on server side
    room.currentCorrectAnswer = correctIndex;
    room.currentQuestion = questionData;
    room.isActive = true;
    
    // Reset player answers for new question
    Object.keys(room.players).forEach(playerId => {
      if (room.players[playerId]) {
        room.players[playerId].hasAnswered = false;
        room.players[playerId].currentAnswer = null;
      }
    });
    
    // Send question to all players in the room
    io.to(roomId).emit('newQuestion', questionData);
    
    console.log(`Manual question ${room.currentQuestionIndex + 1} sent to room ${roomId}: "${question}"`);
  });

  /* GET CURRENT QUIZ STATUS (FOR RECONNECTION) */
  socket.on("getQuizStatus", ({ roomId }) => {
    if (!rooms[roomId]) {
      socket.emit("errorMessage", "Room not found");
      return;
    }

    const room = rooms[roomId];
    socket.emit("quizStatus", {
      isQuizEnded: room.isQuizEnded,
      currentQuestionIndex: room.currentQuestionIndex,
      isActive: room.isActive,
      currentQuestion: room.currentQuestion,
      players: room.players
    });
  });

  /* DISCONNECT */
  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        io.to(roomId).emit("playersUpdated", rooms[roomId].players);
      }
    }
  });
});

/* ---------------- HELPER FUNCTIONS ---------------- */
function sendQuestion(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.isQuizEnded) {
    return;
  }

  const question = room.questions[room.currentQuestionIndex];

  if (!question) {
    // Auto end quiz when no more questions
    endQuizAutomatically(roomId);
    return;
  }

  // Reset player answers for new question
  Object.keys(room.players).forEach(playerId => {
    if (room.players[playerId]) {
      room.players[playerId].hasAnswered = false;
      room.players[playerId].currentAnswer = null;
    }
  });

  io.to(roomId).emit("newQuestion", {
    index: room.currentQuestionIndex,
    questionNumber: room.currentQuestionIndex + 1,
    question: question.question,
    options: question.options,
  });
}

function endQuizAutomatically(roomId) {
  const room = rooms[roomId];
  if (!room || room.isQuizEnded) return;

  // Mark quiz as ended
  room.isQuizEnded = true;

  // Calculate final results
  const finalResults = [];
  Object.keys(room.players).forEach(playerId => {
    const player = room.players[playerId];
    finalResults.push({
      playerId,
      name: player.name,
      score: player.score,
      totalQuestions: room.currentQuestionIndex,
      percentage: room.currentQuestionIndex > 0 ? Math.round((player.score / room.currentQuestionIndex) * 100) : 0
    });
  });

  // Sort by score (highest first)
  finalResults.sort((a, b) => b.score - a.score);

  // Send final results to all participants and host
  io.to(roomId).emit("quizEnded", {
    results: finalResults,
    totalQuestions: room.currentQuestionIndex,
    endedBy: 'automatic'
  });

  console.log(`Quiz automatically ended in room ${roomId}. Final results:`, finalResults);
}

/* ---------------- START SERVER ---------------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Quiz server running on port ${PORT}`);
});
