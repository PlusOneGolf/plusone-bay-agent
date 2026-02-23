const { io } = require("socket.io-client");
const { ipcRenderer } = require("electron");

const lockScreen    = document.getElementById("lockScreen");
const hud           = document.getElementById("hud");
const timeLeftEl    = document.getElementById("timeLeft");
const timerBar      = document.getElementById("timerBar");
const timerBarValue = document.getElementById("timerBarValue");
const notifyBar     = document.getElementById("notifyBar");
const notifyIcon    = document.getElementById("notifyIcon");
const notifyText    = document.getElementById("notifyText");
const notifyTimer   = document.getElementById("notifyTimer");
const statusEl      = document.getElementById("status");
const statusDot     = document.getElementById("statusDot");
const statusText    = document.getElementById("statusText");
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
let warnEnabled  = false;
let notifyMessage = null;
let notifyTimeout = null;

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

function doLock() {
  locked = true;
  endsAt = null;
  warned = false;
  warnEnabled = false;
  notifyMessage = null;
  if (notifyTimeout) { clearTimeout(notifyTimeout); notifyTimeout = null; }
  setWindowMode("kiosk");
  render();
}

function doUnlock() {
  locked = false;
  notifyMessage = null;
  if (notifyTimeout) { clearTimeout(notifyTimeout); notifyTimeout = null; }
  if (endsAt && endsAt > Date.now()) {
    setWindowMode("timer");
  } else {
    setWindowMode("hidden");
  }
  render();
}

function doStart(seconds, warn) {
  locked = false;
  notifyMessage = null;
  if (notifyTimeout) { clearTimeout(notifyTimeout); notifyTimeout = null; }
  endsAt = Date.now() + (seconds || 3600) * 1000;
  warned = false;
  warnEnabled = !!warn;
  setWindowMode("timer");
  render();
}

function showNotification(icon, text, durationMs) {
  notifyMessage = { icon: icon, text: text };
  setWindowMode("notify");
  render();

  if (notifyTimeout) { clearTimeout(notifyTimeout); }
  notifyTimeout = setTimeout(function () {
    notifyMessage = null;
    notifyTimeout = null;
    if (!locked && endsAt && endsAt > Date.now()) {
      setWindowMode("timer");
    } else if (!locked) {
      setWindowMode("hidden");
    }
    render();
  }, durationMs || 8000);
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

  timerBar.style.display = "none";
  notifyBar.style.display = "none";
  lockScreen.style.display = "none";
  hud.style.display = "none";
  statusEl.style.display = "none";

  if (windowMode === "timer") {
    timerBar.style.display = "flex";
  } else if (windowMode === "notify") {
    notifyBar.style.display = "flex";
    if (notifyMessage) {
      notifyIcon.textContent = notifyMessage.icon;
      notifyText.textContent = notifyMessage.text;
    }
    if (endsAt && endsAt > Date.now()) {
      notifyTimer.textContent = fmt(endsAt - Date.now());
      notifyTimer.style.display = "";
    } else {
      notifyTimer.style.display = "none";
    }
  } else if (windowMode === "kiosk") {
    statusEl.style.display = "flex";
    lockScreen.style.display = "flex";
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
    timerBarValue.textContent = "\u2014";
    timerBarValue.className = "timer-value";
    render();
    return;
  }

  const msLeft = endsAt - Date.now();
  const display = fmt(msLeft);
  timerBarValue.textContent = display;
  timeLeftEl.textContent = display;

  timerBarValue.className = "timer-value";
  if (msLeft <= 60000) {
    timerBarValue.classList.add("critical");
  } else if (msLeft <= 10 * 60 * 1000) {
    timerBarValue.classList.add("warning");
  }

  if (windowMode === "notify" && endsAt && endsAt > Date.now()) {
    notifyTimer.textContent = display;
  }

  if (warnEnabled && !warned && msLeft <= 10 * 60 * 1000 && msLeft > 0) {
    warned = true;
    notifyMessage = { icon: "\u26A0", text: "Time remaining" };
    setWindowMode("notify");
  }

  if (msLeft <= 0) {
    doLock();
  }

  render();
}

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
      notifyMessage = null;
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
        doStart(payload.seconds, payload.warn);
        break;

      case "extend":
        var extSec = payload.seconds || 900;
        if (endsAt) {
          endsAt += extSec * 1000;
          if (endsAt - Date.now() > 10 * 60 * 1000) {
            warned = false;
          }
        }
        render();
        break;

      case "end":
        doLock();
        break;

      case "message":
        var msgContent = payload.text || "Message from staff";
        showNotification("\u2709", msgContent, 15000);
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
