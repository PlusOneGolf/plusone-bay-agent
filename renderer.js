const { io } = require("socket.io-client");

// ── DOM refs ──
const lockScreen    = document.getElementById("lockScreen");
const hud           = document.getElementById("hud");
const timeLeftEl    = document.getElementById("timeLeft");
const statusDot     = document.getElementById("statusDot");
const statusText    = document.getElementById("statusText");
const warnOverlay   = document.getElementById("warnOverlay");
const warnOk        = document.getElementById("warnOk");
const msgOverlay    = document.getElementById("msgOverlay");
const msgText       = document.getElementById("msgText");
const msgOk         = document.getElementById("msgOk");
const configPanel   = document.getElementById("configPanel");
const reconfigBtn   = document.getElementById("reconfigureBtn");
const serverUrlIn   = document.getElementById("serverUrl");
const bayIdIn       = document.getElementById("bayId");
const saveBtn       = document.getElementById("saveConnect");

// ── State ──
let socket       = null;
let endsAt       = null;
let locked       = true;
let warned       = false;
let connected    = false;
let lastServerSeen = 0;
let pingInterval = null;
let lastPingSent = 0;
let missedPings  = 0;

// ── Helpers ──
function fmt(ms) {
  if (!ms || ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function hideOverlays() {
  warnOverlay.style.display = "none";
  msgOverlay.style.display = "none";
}

function doLock() {
  locked = true;
  endsAt = null;
  warned = false;
  hideOverlays();
}

// ── Render ──
function render() {
  // Connection indicator
  if (connected) {
    statusDot.className = "status-dot online";
    statusText.textContent = "CONNECTED";
  } else if (lastServerSeen > 0) {
    statusDot.className = "status-dot connecting";
    statusText.textContent = "RECONNECTING";
  } else {
    statusDot.className = "status-dot";
    statusText.textContent = "DISCONNECTED";
  }

  // Lock screen vs HUD
  if (locked) {
    lockScreen.style.display = "flex";
    hud.style.display = "none";
  } else {
    lockScreen.style.display = "none";
    hud.style.display = "flex";
  }
}

// ── Tick (runs every 250ms) ──
function tick() {
  // Safety: if disconnected for > 60 seconds, auto-lock
  if (!connected && lastServerSeen > 0 && Date.now() - lastServerSeen > 60000) {
    doLock();
  }

  // Stale connection detection: if we sent pings but got no server
  // activity for > 45 seconds while "connected", force disconnect
  if (connected && lastServerSeen > 0 && Date.now() - lastServerSeen > 45000) {
    connected = false;
    if (socket) {
      socket.disconnect();
    }
  }

  // Update timer display
  if (!endsAt || locked) {
    timeLeftEl.textContent = "\u2014";
    render();
    return;
  }

  const msLeft = endsAt - Date.now();
  timeLeftEl.textContent = fmt(msLeft);

  // 5-minute warning (show once)
  if (!warned && msLeft <= 5 * 60 * 1000 && msLeft > 0) {
    warned = true;
    warnOverlay.style.display = "flex";
  }

  // Auto-lock at 0:00
  if (msLeft <= 0) {
    doLock();
  }

  render();
}

// ── Warning dismiss ──
warnOk.addEventListener("click", function () {
  warnOverlay.style.display = "none";
});

// ── Message dismiss ──
msgOk.addEventListener("click", function () {
  msgOverlay.style.display = "none";
});

// ── Connect to server ──
function connect(serverUrl, bayId) {
  // Clean up previous connection
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }

  socket = io(serverUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });

  socket.on("connect", function () {
    connected = true;
    lastServerSeen = Date.now();
    socket.emit("bay:hello", { bayId: bayId });
    render();
  });

  socket.on("disconnect", function () {
    connected = false;
    render();
  });

  socket.on("reconnect", function () {
    connected = true;
    lastServerSeen = Date.now();
    socket.emit("bay:hello", { bayId: bayId });
    render();
  });

  socket.on("bay:state", function (state) {
    lastServerSeen = Date.now();
    connected = true;
    locked = !!state.locked;
    endsAt = state.endsAt || null;
    warned = false;
    if (locked) {
      hideOverlays();
    }
    render();
  });

  socket.on("bay:command", function (data) {
    var cmd = data.cmd;
    var payload = data.payload || {};
    lastServerSeen = Date.now();
    connected = true;

    switch (cmd) {
      case "lock":
        doLock();
        break;

      case "unlock":
        locked = false;
        break;

      case "start":
        locked = false;
        hideOverlays();
        var seconds = payload.seconds || 3600;
        endsAt = Date.now() + seconds * 1000;
        warned = false;
        break;

      case "extend":
        var extSec = payload.seconds || 900;
        if (endsAt) {
          endsAt += extSec * 1000;
          // Reset warning if extended past 5 minutes
          if (endsAt - Date.now() > 5 * 60 * 1000) {
            warned = false;
            warnOverlay.style.display = "none";
          }
        }
        break;

      case "end":
        doLock();
        break;

      case "message":
        msgText.textContent = payload.text || "Message from staff";
        msgOverlay.style.display = "flex";
        break;
    }

    render();
  });

  // Update lastServerSeen on any incoming event (pong, etc.)
  socket.onAny(function () {
    lastServerSeen = Date.now();
  });

  // Send ping every 15 seconds
  pingInterval = setInterval(function () {
    if (socket && socket.connected) {
      socket.emit("bay:ping", { bayId: bayId });
    }
  }, 15000);
}

// ── Load saved config ──
var savedUrl = localStorage.getItem("serverUrl") || "";
var savedBayId = localStorage.getItem("bayId") || "";
serverUrlIn.value = savedUrl;
bayIdIn.value = savedBayId;

if (savedUrl && savedBayId) {
  configPanel.classList.add("hidden");
  reconfigBtn.classList.remove("hidden");
  connect(savedUrl, savedBayId);
}

// ── Save & Connect button ──
saveBtn.addEventListener("click", function () {
  var serverUrl = serverUrlIn.value.trim();
  var bayId = bayIdIn.value.trim();

  if (!serverUrl || !bayId) {
    serverUrlIn.style.borderColor = !serverUrl ? "#ef4444" : "";
    bayIdIn.style.borderColor = !bayId ? "#ef4444" : "";
    return;
  }

  localStorage.setItem("serverUrl", serverUrl);
  localStorage.setItem("bayId", bayId);

  configPanel.classList.add("hidden");
  reconfigBtn.classList.remove("hidden");
  connect(serverUrl, bayId);
});

// ── Reconfigure button ──
reconfigBtn.addEventListener("click", function () {
  configPanel.classList.remove("hidden");
  reconfigBtn.classList.add("hidden");
  serverUrlIn.value = localStorage.getItem("serverUrl") || "";
  bayIdIn.value = localStorage.getItem("bayId") || "";
});

// ── Start ticking ──
render();
setInterval(tick, 250);
