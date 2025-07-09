const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const roomMessages = {};
const roomUsers = {}; // Stores { roomName: { socketId: { displayName, userId, socketId, isAvailableForCall } } }
const callsInProgress = {}; // To track active calls: {callerId: calleeId, calleeId: callerId}

// Helper function to get a list of user objects for a given room
function getRoomUserList(room) {
  // Return an array of user objects, not just display names
  return Object.values(roomUsers[room] || {});
}

// Helper function to manage user call availability and broadcast updates
function setUserAvailability(room, socketId, isAvailable) {
    if (roomUsers[room] && roomUsers[room][socketId]) {
        roomUsers[room][socketId].isAvailableForCall = isAvailable;
        // Emit the full updated list to the room
        io.to(room).emit('room-users-update', getRoomUserList(room));
    }
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  let currentRoom = null;
  let currentUserDetails = null; // Store user details here

  socket.on('join-room', ({ room, userDetails }) => {
    socket.join(room);
    currentRoom = room;
    currentUserDetails = { // Store complete user details, including socketId and initial availability
        userId: userDetails.userId,
        displayName: userDetails.displayName,
        socketId: socket.id, // Add socketId to user details for easier lookup
        isAvailableForCall: true // Default to available when joining
    };

    console.log(`User ${currentUserDetails.displayName} (${socket.id}) joined room: ${room}`);

    if (!roomUsers[room]) {
      roomUsers[room] = {};
    }
    roomUsers[room][socket.id] = currentUserDetails; // Store by socket.id

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

  // The 'offer' parameter is now expected from the client's startCall
  socket.on('call-request', ({ room, callerId, callerDisplayName, offer }) => {
    console.log(`Call request in room ${room} from ${callerDisplayName} (${socket.id})`);

    // Find a target (the first available user in the room, excluding the caller)
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


const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));