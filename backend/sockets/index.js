// backend/sockets/index.js
const { Server } = require('socket.io');
const { attachChatSocket } = require('./chatSocket');
const { attachIntentsSocket } = require('./intentsSocket');

function attachSocketIO(httpServer) {
  const io = new Server(httpServer, {
    // IMPORTANT: cu cookies + credentials, nu folosi "*"
    cors: {
      origin: (origin, cb) => cb(null, true),
      credentials: true,
    },
  });

  // aici atașăm modulele (chat, etc.)
  attachChatSocket(io);
attachIntentsSocket(io);

  console.log('[socket.io] attached');
  return io;
}

module.exports = { attachSocketIO };
