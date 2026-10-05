const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const socketNames = new Map();
const messageReadStatus = new Map();

function defaultName(socketId) {
  return `Guest-${socketId.slice(0, 4).toUpperCase()}`;
}

function generateCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      messages: [],
      participants: new Set()
    });
  }

  return rooms.get(code);
}

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function joinRoom(socket, code, name) {
  const cleanedCode = String(code || "").trim();
  if (!cleanedCode) {
    socket.emit("chat:error", { message: "Please enter a valid code." });
    return;
  }

  const room = getRoom(cleanedCode);
  const displayName = (name && name.trim()) ? name.trim().slice(0, 20) : defaultName(socket.id);

  socket.join(cleanedCode);
  socketNames.set(socket.id, displayName);
  room.participants.add(socket.id);

  socket.emit("chat:joined", {
    code: room.code,
    name: displayName,
    messages: room.messages.slice(-200)
  });

  socket.to(cleanedCode).emit("chat:message", {
    id: `system-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "system",
    sender: "System",
    text: `${displayName} joined the chat`,
    createdAt: new Date().toISOString()
  });

  io.to(cleanedCode).emit("chat:room-update", {
    code: room.code,
    participantCount: room.participants.size
  });
}

function getCurrentRoomForSocket(socket) {
  const roomCode = [...socket.rooms].find((room) => room !== socket.id);
  return roomCode ? rooms.get(roomCode) : null;
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "one-on-one-chat" });
});

io.on("connection", (socket) => {
  socketNames.set(socket.id, defaultName(socket.id));

  socket.on("chat:create-room", ({ name }) => {
    const code = generateCode();
    const room = getRoom(code);
    const displayName = (name && name.trim()) ? name.trim().slice(0, 20) : defaultName(socket.id);

    socket.join(code);
    socketNames.set(socket.id, displayName);
    room.participants.add(socket.id);

    socket.emit("chat:created", {
      code,
      name: displayName,
      shareUrl: `${process.env.APP_URL || "http://localhost:3000"}/?code=${code}`
    });

    socket.emit("chat:joined", {
      code: room.code,
      name: displayName,
      messages: room.messages.slice(-200)
    });

    io.to(code).emit("chat:room-update", {
      code: room.code,
      participantCount: room.participants.size
    });
  });

  socket.on("chat:join", ({ code, name }) => {
    joinRoom(socket, code, name);
  });

  socket.on("chat:send-message", ({ code, text, image }) => {
    const room = rooms.get(String(code));
    if (!room) {
      socket.emit("chat:error", { message: "That chat no longer exists." });
      return;
    }

    const sender = socketNames.get(socket.id) || defaultName(socket.id);
    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasImage = typeof image === "string" && image.trim().length > 0;

    if (!hasText && !hasImage) {
      socket.emit("chat:error", { message: "Your message is empty." });
      return;
    }

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: hasImage ? "image" : "text",
      sender,
      text: hasText ? escapeText(text).slice(0, 4000) : "",
      image: hasImage ? image : "",
      createdAt: new Date().toISOString(),
      isRead: false,
      readBy: []
    };

    room.messages.push(message);
    if (room.messages.length > 300) {
      room.messages = room.messages.slice(-300);
    }

    messageReadStatus.set(message.id, { read: false, readBy: [] });
    io.to(code).emit("chat:message", message);
  });

  socket.on("chat:mark-read", ({ code, messageIds }) => {
    const room = rooms.get(String(code));
    if (!room) return;

    const reader = socketNames.get(socket.id) || defaultName(socket.id);

    messageIds.forEach((messageId) => {
      const message = room.messages.find((msg) => msg.id === messageId);
      if (message && message.sender !== reader) {
        message.isRead = true;
        if (!message.readBy) message.readBy = [];
        if (!message.readBy.includes(reader)) {
          message.readBy.push(reader);
        }

        io.to(code).emit("chat:message-read", {
          messageId: message.id,
          readBy: reader
        });
      }
    });
  });

  socket.on("chat:typing", ({ code, isTyping }) => {
    if (!code) return;
    socket.to(code).emit("chat:typing", {
      user: socketNames.get(socket.id) || defaultName(socket.id),
      isTyping
    });
  });

  socket.on("disconnect", () => {
    const roomCode = [...socket.rooms].find((room) => room !== socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    room.participants.delete(socket.id);

    const sender = socketNames.get(socket.id) || defaultName(socket.id);
    socket.to(roomCode).emit("chat:message", {
      id: `system-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: "system",
      sender: "System",
      text: `${sender} left the chat`,
      createdAt: new Date().toISOString()
    });

    if (room.participants.size === 0) {
      rooms.delete(roomCode);
    } else {
      io.to(roomCode).emit("chat:room-update", {
        code: room.code,
        participantCount: room.participants.size
      });
    }
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`One-on-one chat app running on http://localhost:${PORT}`);
});
