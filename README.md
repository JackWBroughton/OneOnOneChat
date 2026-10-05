const socket = io();

const state = {
  currentCode: "",
  userName: "",
  isTyping: false,
  typingTimeout: null,
  awaitingCode: false
};

const nameInput = document.getElementById("nameInput");
const codeInput = document.getElementById("codeInput");
const createChatBtn = document.getElementById("createChatBtn");
const joinChatBtn = document.getElementById("joinChatBtn");
const shareLinkBtn = document.getElementById("shareLinkBtn");
const messageInput = document.getElementById("messageInput");
const imageInput = document.getElementById("imageInput");
const sendBtn = document.getElementById("sendBtn");
const messagesEl = document.getElementById("messages");
const chatCodeEl = document.getElementById("chatCode");
const roomTitle = document.getElementById("roomTitle");
const participantBadge = document.getElementById("participantBadge");
const typingIndicator = document.getElementById("typingIndicator");

function getName() {
  const value = nameInput.value.trim();
  if (value) return value.slice(0, 20);
  return `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
}

function setRoomCode(code) {
  state.currentCode = code;
  chatCodeEl.textContent = code;
  roomTitle.textContent = `Room ${code}`;

  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${code}`;
  shareLinkBtn.dataset.url = shareUrl;
  shareLinkBtn.title = shareUrl;
  codeInput.value = code;

  const url = new URL(window.location.href);
  url.searchParams.set("code", code);
  window.history.replaceState({}, "", url);
}

function appendMessage(message) {
  const item = document.createElement("div");
  item.className = `message ${message.type === "system" ? "system" : ""}`;

  if (message.type !== "system") {
    const isSelf = message.sender === getName();
    if (isSelf) item.classList.add("self");
  }

  const header = document.createElement("div");
  header.className = "message-header";

  if (message.type === "system") {
    const meta = document.createElement("span");
    meta.textContent = "System";
    header.appendChild(meta);
  } else {
    const sender = document.createElement("span");
    sender.textContent = message.sender;
    const time = document.createElement("span");
    time.textContent = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    header.append(sender, time);
  }

  item.appendChild(header);

  if (message.type === "image" && message.image) {
    const image = document.createElement("img");
    image.src = message.image;
    image.alt = "Shared photo";
    item.appendChild(image);
  }

  if (message.text) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text;
    item.appendChild(text);
  }

  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages(messages) {
  messagesEl.innerHTML = "";
  messages.forEach((message) => appendMessage(message));
}

function attachTyping() {
  if (!state.currentCode) return;

  if (state.typingTimeout) clearTimeout(state.typingTimeout);
  state.isTyping = true;
  socket.emit("chat:typing", { code: state.currentCode, isTyping: true });

  state.typingTimeout = setTimeout(() => {
    state.isTyping = false;
    socket.emit("chat:typing", { code: state.currentCode, isTyping: false });
  }, 1000);
}

function sendMessage() {
  const code = state.currentCode;
  const text = messageInput.value.trim();
  const imageValue = imageInput.files[0] ? imageInput.files[0] : null;

  if (!code) {
    alert("Create or join a chat first.");
    return;
  }

  if (!text && !imageValue) {
    return;
  }

  const payload = {
    code,
    text,
    image: ""
  };

  if (imageValue) {
    const reader = new FileReader();
    reader.onload = () => {
      payload.image = reader.result;
      socket.emit("chat:send-message", payload);
      messageInput.value = "";
      imageInput.value = "";
      attachTyping();
    };
    reader.readAsDataURL(imageValue);
    return;
  }

  socket.emit("chat:send-message", payload);
  messageInput.value = "";
  attachTyping();
}

function joinRoom(code) {
  state.userName = getName();
  nameInput.value = state.userName;

  if (!code) return;

  socket.emit("chat:join", {
    code: code.trim(),
    name: state.userName
  });
}

createChatBtn.addEventListener("click", () => {
  state.userName = getName();
  nameInput.value = state.userName;
  socket.emit("chat:create-room", { name: state.userName });
});

joinChatBtn.addEventListener("click", () => {
  const code = codeInput.value.trim();
  if (!code) {
    alert("Enter a valid code to join the chat.");
    return;
  }
  joinRoom(code);
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }

  if (messageInput.value.trim().length > 0) {
    attachTyping();
  }
});

sendBtn.addEventListener("click", sendMessage);
shareLinkBtn.addEventListener("click", async () => {
  const url = shareLinkBtn.dataset.url || window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    shareLinkBtn.textContent = "Link copied";
    setTimeout(() => {
      shareLinkBtn.textContent = "Share link";
    }, 1200);
  } catch (error) {
    window.prompt("Copy this link to share the chat:", url);
  }
});

socket.on("chat:created", ({ code, name, shareUrl }) => {
  state.userName = name;
  nameInput.value = name;
  setRoomCode(code);
  shareLinkBtn.dataset.url = shareUrl;
  participantBadge.textContent = "1 online";
});

socket.on("chat:joined", ({ code, name, messages }) => {
  state.userName = name;
  nameInput.value = name;
  setRoomCode(code);
  renderMessages(messages);
});

socket.on("chat:message", (message) => {
  appendMessage(message);
});

socket.on("chat:room-update", ({ code, participantCount }) => {
  if (code === state.currentCode) {
    participantBadge.textContent = `${participantCount} online`;
  }
});

socket.on("chat:typing", ({ user, isTyping }) => {
  if (isTyping) {
    typingIndicator.textContent = `${user} is typing…`;
    typingIndicator.classList.remove("hidden");
  } else {
    typingIndicator.classList.add("hidden");
  }
});

socket.on("chat:error", ({ message }) => {
  alert(message);
});

const params = new URLSearchParams(window.location.search);
const codeFromUrl = params.get("code");
if (codeFromUrl) {
  joinRoom(codeFromUrl);
}
