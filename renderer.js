const { io } = require("socket.io-client");
const { ipcRenderer } = require("electron");

const lockScreen    = document.getElementById("lockScreen");
const hud           = document.getElementById("hud");
const timeLeftEl    = document.getElementById("timeLeft");
const timerBar      = document.getElementById("timerBar");
const timerBarValue = document.getElementById("timerBarValue");
const statusEl      = document.getElementById("status");
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

let socket       = null;
let endsAt       = null;
let locked       = true;
let warned       = false;
let connected    = false;
let lastServerSeen = 0;
let pingInterval = null;
let windowMode   = "kiosk";

function fmt(ms) {
  if (!ms || ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function setWindowMode(mode) {
  windowMode = mode;
  ipcRenderer.send("window:mode", mode);
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
  setWindowMode("kiosk");
  render();
}

function doUnlock() {
  locked = false;
  hideOverlays();
  if (endsAt && endsAt > Date.now()) {
    setWindowMode("timer");
  } else {
    setWindowMode("hidden");
  }
  render();
}

function doStart(seconds) {
  locked = false;
  hideOverlays();
  endsAt = Date.now() + (seconds || 3600) * 1000;
  warned = false;
  setWindowMode("timer");
  render();
}

function render() {
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

  if (windowMode === "timer") {
    lockScreen.style.display = "none";
    hud.style.display = "none";
    statusEl.style.display = "none";
    timerBar.style.display = "flex";
  } else {
    timerBar.style.display = "none";
    statusEl.style.display = "flex";

    if (locked) {
      lockScreen.style.display = "flex";
      hud.style.display = "none";
    } else {
      lockScreen.style.display = "none";
      hud.style.display = "flex";
    }
  }
}

function tick() {
  if (!connected && lastServerSeen > 0 && Date.now() - lastServerSeen > 60000) {
    doLock();
  }

  if (connected && lastServerSeen > 0 && Date.now() - lastServerSeen > 45000) {
    connected = false;
    if (socket) {
      socket.disconnect();
    }
  }

  if (!endsAt || locked) {
    timeLeftEl.textContent = "\u2014";
    timerBarValue.textContent = "\u2014";
    timerBarValue.className = "timer-value";
    render();
    return;
  }

  const msLeft = endsAt - Date.now();
  const display = fmt(msLeft);
  timeLeftEl.textContent = display;
  timerBarValue.textContent = display;

  timerBarValue.className = "timer-value";
  if (msLeft <= 60000) {
    timerBarValue.classList.add("critical");
  } else if (msLeft <= 5 * 60 * 1000) {
    timerBarValue.classList.add("warning");
  }

  if (!warned && msLeft <= 5 * 60 * 1000 && msLeft > 0) {
    warned = true;
    setWindowMode("alert");
    warnOverlay.style.display = "flex";
  }

  if (msLeft <= 0) {
    doLock();
  }

  render();
}

warnOk.addEventListener("click", function () {
  warnOverlay.style.display = "none";
  if (!locked && endsAt && endsAt > Date.now()) {
    setWindowMode("timer");
    render();
  }
});

msgOk.addEventListener("click", function () {
  msgOverlay.style.display = "none";
  if (!locked && endsAt && endsAt > Date.now()) {
    setWindowMode("timer");
    render();
  } else if (!locked) {
    setWindowMode("hidden");
    render();
  }
});

function connect(serverUrl, bayId) {
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
    warned = false;

    if (!!state.locked) {
      doLock();
    } else {
      locked = false;
      endsAt = state.endsAt || null;
      hideOverlays();
      if (endsAt && endsAt > Date.now()) {
        setWindowMode("timer");
      } else {
        setWindowMode("hidden");
      }
      render();
    }
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
        doUnlock();
        break;

      case "start":
        doStart(payload.seconds);
        break;

      case "extend":
        var extSec = payload.seconds || 900;
        if (endsAt) {
          endsAt += extSec * 1000;
          if (endsAt - Date.now() > 5 * 60 * 1000) {
            warned = false;
            warnOverlay.style.display = "none";
          }
        }
        render();
        break;

      case "end":
        doLock();
        break;

      case "message":
        msgText.textContent = payload.text || "Message from staff";
        setWindowMode("alert");
        msgOverlay.style.display = "flex";
        render();
        break;
    }
  });

  socket.onAny(function () {
    lastServerSeen = Date.now();
  });

  pingInterval = setInterval(function () {
    if (socket && socket.connected) {
      socket.emit("bay:ping", { bayId: bayId });
    }
  }, 15000);
}

var savedUrl = localStorage.getItem("serverUrl") || "";
var savedBayId = localStorage.getItem("bayId") || "";
serverUrlIn.value = savedUrl;
bayIdIn.value = savedBayId;

if (savedUrl && savedBayId) {
  configPanel.classList.add("hidden");
  reconfigBtn.classList.remove("hidden");
  connect(savedUrl, savedBayId);
}

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

reconfigBtn.addEventListener("click", function () {
  configPanel.classList.remove("hidden");
  reconfigBtn.classList.add("hidden");
  serverUrlIn.value = localStorage.getItem("serverUrl") || "";
  bayIdIn.value = localStorage.getItem("bayId") || "";
});

render();
setInterval(tick, 250);
