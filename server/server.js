// server/server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios'); 
const qs = require("qs");

const app = express();
app.use(cors());
app.use(express.json()); // <-- 2. REQUIRED: This is crucial for parsing JSON request bodies

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- Visualizer Language Map ---
const VISUALIZER_LANG_MAP = {
  'cpp': 'cpp',
  'c': 'c',
  'java': 'java',
  'javascript': 'js',
  'python': 'py3', // Assuming Python 3
};


app.post("/visualize", async (req, res) => {
  console.log("📩 /visualize called with:", req.body); // <--- LOG

  const { language, code } = req.body;

  const VISUALIZER_LANG_MAP = {
    cpp: "cpp",
    c: "c",
    java: "java",
    javascript: "js",
    python: "py3",
  };

  const visualizerLang = VISUALIZER_LANG_MAP[(language || "").toLowerCase()];

  if (!visualizerLang) {
    return res.status(400).json({ error: "Language not supported." });
  }

  try {
    const payload = qs.stringify({
      user_script: code,
      raw_input_json: JSON.stringify(null),
      options_json: JSON.stringify({
        cumulative_mode: false,
        heap_primitives: false,
        show_only_user_code: true,
      }),
      lang: visualizerLang,
    });

    console.log("🌐 Sending to PythonTutor...", payload.length, "bytes");

    const response = await axios.post(
      "https://pythontutor.com/web_exec",
      payload,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*",
          "Origin": "https://pythontutor.com",
          "Referer": "https://pythontutor.com/",
        },
        timeout: 20000, // prevent "socket hang up"
      }
    );

    console.log("✅ PythonTutor response OK");
    return res.json(response.data);
  } catch (error) {
    console.error("❌ PYTHONTUTOR ERROR:");
    console.error("Status:", error?.response?.status);
    console.error("Data:", error?.response?.data);
    console.error("Message:", error.message);

    return res.status(500).json({
      error: "Visualizer request failed",
      details: error?.response?.data || error.message,
    });
  }
});


console.log('✅ /visualize endpoint registered.'); 

// --- ALL YOUR EXISTING SOCKET.IO CODE REMAINS UNCHANGED ---
const roomMessages = {};
const roomUsers = {}; 
const callsInProgress = {}; 

function getRoomUserList(room) {
  return Object.values(roomUsers[room] || {});
}

function setUserAvailability(room, socketId, isAvailable) {
    if (roomUsers[room] && roomUsers[room][socketId]) {
        roomUsers[room][socketId].isAvailableForCall = isAvailable;
        io.to(room).emit('room-users-update', getRoomUserList(room));
    }
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  let currentRoom = null;
  let currentUserDetails = null; 

  socket.on('join-room', ({ room, userDetails }) => {
    socket.join(room);
    currentRoom = room;
    currentUserDetails = {
        userId: userDetails.userId,
        displayName: userDetails.displayName,
        socketId: socket.id, 
        isAvailableForCall: true 
    };

    console.log(`User ${currentUserDetails.displayName} (${socket.id}) joined room: ${room}`);

    if (!roomUsers[room]) {
      roomUsers[room] = {};
    }
    roomUsers[room][socket.id] = currentUserDetails;

    if (roomMessages[room]) {
      roomMessages[room].forEach(msg => socket.emit('receive-message', msg));
    }

    io.to(room).emit('room-users-update', getRoomUserList(room));
  });

  socket.on('code-change', ({ room, file, code }) => {
    socket.to(room).emit('code-update', { file, code });
  });

  socket.on('send-message', ({ room, message }) => {
    if (!roomMessages[room]) {
      roomMessages[room] = [];
    }
    roomMessages[room].push(message);
    io.to(room).emit('receive-message', message);
    console.log(`Message in room ${room} from ${message.sender}: ${message.text}`);
  });

  // --- WebRTC Signaling Events ---
  socket.on('call-request', ({ room, callerId, callerDisplayName, offer }) => {
    console.log(`Call request in room ${room} from ${callerDisplayName} (${socket.id})`);

    const availablePeers = Object.entries(roomUsers[room] || {})
        .filter(([sockId, user]) => sockId !== socket.id && user.isAvailableForCall);

    if (availablePeers.length > 0) {
      const [targetSocketId, targetUserDetails] = availablePeers[0]; // Take the first available
      console.log(`Found target for call: ${targetUserDetails.displayName} (${targetSocketId})`);

      // Set both caller and callee as 'not available' for other calls
      setUserAvailability(room, socket.id, false); // Caller becomes unavailable
      setUserAvailability(room, targetSocketId, false); // Target becomes unavailable

      // Store the call in progress
      callsInProgress[socket.id] = targetSocketId;
      callsInProgress[targetSocketId] = socket.id;

      // Notify the target about the incoming call
      io.to(targetSocketId).emit('incoming-call', {
          callerSocketId: socket.id,
          callerDisplayName: callerDisplayName,
      });

      // Forward the offer to the target
      io.to(targetSocketId).emit('webrtc-offer', {
          offer,
          senderSocketId: socket.id,
      });

    } else {
      console.log(`No available peers in room ${room} for call from ${callerDisplayName}.`);
      socket.emit('call-ended', { reason: 'no-available-peers' }); // Inform caller
      setUserAvailability(room, socket.id, true); // Make caller available again
    }
  });

  socket.on('call-accepted', ({ room, callerSocketId, calleeSocketId }) => {
      console.log(`Call accepted in room ${room} by ${calleeSocketId} for ${callerSocketId}`);
      // Set both participants as unavailable
      setUserAvailability(room, callerSocketId, false);
      setUserAvailability(room, calleeSocketId, false);

      io.to(callerSocketId).emit('call-established', { remoteSocketId: calleeSocketId });
      io.to(calleeSocketId).emit('call-established', { remoteSocketId: callerSocketId });
  });

  socket.on('webrtc-offer', ({ room, offer, targetSocketId, senderSocketId }) => {
    console.log(`Forwarding offer to: ${targetSocketId} from ${senderSocketId}`);
    io.to(targetSocketId).emit('webrtc-offer', { offer, senderSocketId });
  });

  socket.on('webrtc-answer', ({ room, answer, targetSocketId, senderSocketId }) => {
    console.log(`WebRTC Answer from ${senderSocketId} to ${targetSocketId} in room ${room}`);
    io.to(targetSocketId).emit('webrtc-answer', { answer, senderSocketId });
  });

  socket.on('webrtc-ice-candidate', ({ room, candidate, targetSocketId, senderSocketId }) => {
    io.to(targetSocketId).emit('webrtc-ice-candidate', { candidate, senderSocketId });
  });

  // Changed 'call-end' to 'call-ended' to match client's emit
  socket.on('call-ended', ({ room }) => {
      console.log(`Call end initiated by ${socket.id} in room ${room}`);
      if (callsInProgress[socket.id]) { // Ensure call exists before clearing
          const partner = callsInProgress[socket.id];
          io.to(partner).emit('call-ended'); // Notify partner that call ended
          setUserAvailability(room, socket.id, true); // Make current user available
          setUserAvailability(room, partner, true); // Make partner available
          delete callsInProgress[socket.id];
          delete callsInProgress[partner]; // Clean up both ends of the call
      }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (currentRoom && roomUsers[currentRoom]) {
      const disconnectedSocketId = socket.id;

      // If the disconnected user was in a call, end it for the partner
      if (callsInProgress[disconnectedSocketId]) {
          const partnerSocketId = callsInProgress[disconnectedSocketId];
          io.to(partnerSocketId).emit('call-ended', { reason: 'partner-disconnected' });
          // Make partner available again
          setUserAvailability(currentRoom, partnerSocketId, true);
          delete callsInProgress[disconnectedSocketId];
          delete callsInProgress[partnerSocketId]; // Clean up both ends
      }
      
      delete roomUsers[currentRoom][disconnectedSocketId]; // Remove disconnected user from roomUsers
      io.to(currentRoom).emit('room-users-update', getRoomUserList(currentRoom)); // Broadcast updated list
      io.to(currentRoom).emit('call-ended-by-disconnect', { disconnectedSocketId: disconnectedSocketId });
    }
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});