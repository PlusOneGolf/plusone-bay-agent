const { io } = require("socket.io-client");
const { ipcRenderer } = require("electron");

const lockScreen      = document.getElementById("lockScreen");
const hud             = document.getElementById("hud");
const timeLeftEl      = document.getElementById("timeLeft");
const timerBar        = document.getElementById("timerBar");
const timerBarValue   = document.getElementById("timerBarValue");
const notifyBar       = document.getElementById("notifyBar");
const notifyIcon      = document.getElementById("notifyIcon");
const notifyText      = document.getElementById("notifyText");
const notifyTimer     = document.getElementById("notifyTimer");
const statusEl        = document.getElementById("status");
const statusDot       = document.getElementById("statusDot");
const statusText      = document.getElementById("statusText");
const configPanel     = document.getElementById("configPanel");
const reconfigBtn     = document.getElementById("reconfigureBtn");
const serverUrlIn     = document.getElementById("serverUrl");
const bayNameIn       = document.getElementById("bayName");
const facilityIdIn    = document.getElementById("facilityId");
const saveBtn         = document.getElementById("saveConnect");
const nextReservation = document.getElementById("nextReservation");
const nextResName     = document.getElementById("nextResName");
const nextResTime     = document.getElementById("nextResTime");

let socket             = null;
let endsAt             = null;
let locked             = true;
let warned             = false;
let connected          = false;
let lastServerSeen     = 0;
let pingInterval       = null;
let windowMode         = "kiosk";
let warnEnabled        = false;
let pinUnlocked        = false;
let disconnectBehavior = null;
let notifyMessage      = null;
let notifyTimeout      = null;

const STAFF_PIN = "7748";
let pinBuffer = "";
let pinTimer  = null;
const pinDotsEl    = document.getElementById("pinDots");
const pinErrorMsgEl = document.getElementById("pinErrorMsg");
const pinDots = [
  document.getElementById("pinDot0"),
  document.getElementById("pinDot1"),
  document.getElementById("pinDot2"),
  document.getElementById("pinDot3"),
];

function resetPin() {
  pinBuffer = "";
  pinDotsEl.classList.remove("active");
  pinDots.forEach(function (dot) { dot.className = "pin-dot"; });
  if (pinTimer) { clearTimeout(pinTimer); pinTimer = null; }
}

function updatePinDots() {
  pinDotsEl.classList.add("active");
  pinDots.forEach(function (dot, i) {
    dot.className = i < pinBuffer.length ? "pin-dot filled" : "pin-dot";
  });
}

function showPinError(msg) {
  pinDots.forEach(function (dot) { dot.className = "pin-dot error"; });
  if (msg) {
    pinErrorMsgEl.textContent = msg;
    pinErrorMsgEl.classList.add("visible");
    setTimeout(function () { pinErrorMsgEl.classList.remove("visible"); }, 3000);
  }
  setTimeout(resetPin, 800);
}

document.addEventListener("keydown", function (e) {
  if (!locked || windowMode !== "kiosk") return;
  if (e.key >= "0" && e.key <= "9") {
    pinBuffer += e.key;
    updatePinDots();

    if (pinTimer) clearTimeout(pinTimer);
    pinTimer = setTimeout(resetPin, 5000);

    if (pinBuffer.length === 4) {
      var entered = pinBuffer;
      resetPin();

      if (entered === STAFF_PIN) {
        pinUnlocked = true;
        doUnlock();
        if (socket && socket.connected) {
          socket.emit("bay:state", { locked: false });
        }
      } else {
        if (socket && socket.connected) {
          socket.emit("bay:pin-unlock", { pin: entered });
        } else {
          showPinError("Incorrect code, please try again");
        }
      }
    }
  }
});

function fmtMs(ms) {
  if (!ms || ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function fmtLocalTime(isoStr) {
  if (!isoStr) return "";
  var d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function setWindowMode(mode) {
  windowMode = mode;
  ipcRenderer.send("window:mode", mode);
}

function showNextReservation(res) {
  if (res) {
    nextResName.textContent = res.name || "Guest";
    var start = fmtLocalTime(res.startTime);
    var end   = fmtLocalTime(res.endTime);
    nextResTime.textContent = start && end ? start + " \u2013 " + end : "";
    nextReservation.classList.remove("hidden");
  } else {
    nextReservation.classList.add("hidden");
  }
}

function doLock(opts) {
  locked    = true;
  endsAt    = null;
  warned    = false;
  warnEnabled = false;
  pinUnlocked = false;
  notifyMessage = null;
  if (notifyTimeout) { clearTimeout(notifyTimeout); notifyTimeout = null; }
  showNextReservation(opts && opts.nextReservation ? opts.nextReservation : null);
  setWindowMode("kiosk");
  render();
  if (socket && socket.connected) {
    socket.emit("bay:state", { locked: true });
  }
}

function doUnlock() {
  locked = false;
  notifyMessage = null;
  showNextReservation(null);
  if (notifyTimeout) { clearTimeout(notifyTimeout); notifyTimeout = null; }
  if (endsAt && endsAt > Date.now()) {
    setWindowMode("timer");
  } else {
    setWindowMode("hidden");
  }
  render();
  if (socket && socket.connected) {
    socket.emit("bay:state", { locked: false });
  }
}

function doStart(seconds, warn) {
  locked = false;
  notifyMessage = null;
  showNextReservation(null);
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

  timerBar.style.display  = "none";
  notifyBar.style.display = "none";
  lockScreen.style.display = "none";
  hud.style.display       = "none";
  statusEl.style.display  = "none";

  if (windowMode === "timer") {
    timerBar.style.display = "flex";
  } else if (windowMode === "notify") {
    notifyBar.style.display = "flex";
    if (notifyMessage) {
      notifyIcon.textContent = notifyMessage.icon;
      notifyText.textContent = notifyMessage.text;
    }
    if (endsAt && endsAt > Date.now()) {
      notifyTimer.textContent = fmtMs(endsAt - Date.now());
      notifyTimer.style.display = "";
    } else {
      notifyTimer.style.display = "none";
    }
  } else if (windowMode === "kiosk") {
    statusEl.style.display  = "flex";
    lockScreen.style.display = "flex";
  }
}

function tick() {
  if (!endsAt || locked) {
    timerBarValue.textContent = "\u2014";
    timerBarValue.className   = "timer-value";
    render();
    return;
  }

  const msLeft  = endsAt - Date.now();
  const display = fmtMs(msLeft);
  timerBarValue.textContent = display;
  timeLeftEl.textContent    = display;

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

  render();
}

function handleCommand(data) {
  var command = data.command || data.cmd;
  var payload = data.payload || data;
  lastServerSeen = Date.now();
  connected = true;

  if (command === "lock") {
    if (payload.reason === "invalid_pin" || payload.reason === "invalid_request") {
      showPinError("Incorrect code, please try again");
      return;
    }
    pinUnlocked = false;
    doLock({ nextReservation: payload.nextReservation || null });
    return;
  }

  if (command === "unlock") {
    pinUnlocked = false;
    doUnlock();
    return;
  }

  if (command === "start") {
    doStart(payload.seconds, payload.warn);
    return;
  }

  if (command === "extend") {
    var extSec = payload.seconds || 900;
    if (endsAt) {
      endsAt += extSec * 1000;
      if (endsAt - Date.now() > 10 * 60 * 1000) { warned = false; }
    }
    render();
    return;
  }

  if (command === "end") {
    pinUnlocked = false;
    doLock({});
    return;
  }

  if (command === "message") {
    var msgContent = payload.text || "Message from staff";
    showNotification("\u2709", msgContent, 15000);
    return;
  }

  if (command === "hibernate") {
    ipcRenderer.send("app:hibernate");
    return;
  }

  if (command === "shutdown") {
    ipcRenderer.send("app:shutdown");
    return;
  }
}

function connect(serverUrl, bayName, facilityId) {
  if (socket) { socket.disconnect(); socket = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }

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
    var hello = { bayName: bayName };
    if (facilityId) hello.facilityId = Number(facilityId);
    socket.emit("bay:hello", hello);
    render();
  });

  socket.on("disconnect", function () {
    connected = false;
    if (disconnectBehavior === "unlock" && locked) {
      pinUnlocked = true;
      locked = false;
      showNextReservation(null);
      setWindowMode("hidden");
    }
    render();
  });

  socket.on("reconnect", function () {
    connected = true;
    lastServerSeen = Date.now();
    var hello = { bayName: bayName };
    if (facilityId) hello.facilityId = Number(facilityId);
    socket.emit("bay:hello", hello);
    render();
  });

  socket.on("bay:hello:ack", function (data) {
    disconnectBehavior = (data && data.disconnectBehavior) || null;
  });

  socket.on("bay:command", function (data) {
    handleCommand(data);
  });

  socket.on("bay:pong", function () {
    lastServerSeen = Date.now();
    connected = true;
  });

  socket.onAny(function () {
    lastServerSeen = Date.now();
  });

  pingInterval = setInterval(function () {
    if (socket && socket.connected) {
      socket.emit("bay:ping");
    }
  }, 25000);
}

var savedConfig = null;

async function initConfig() {
  savedConfig = await ipcRenderer.invoke("config:load");
  if (savedConfig && savedConfig.serverUrl && (savedConfig.bayName || savedConfig.bayId)) {
    var bayName    = savedConfig.bayName || savedConfig.bayId;
    var facilityId = savedConfig.facilityId || "";
    serverUrlIn.value  = savedConfig.serverUrl;
    bayNameIn.value    = bayName;
    facilityIdIn.value = facilityId;
    configPanel.classList.add("hidden");
    reconfigBtn.classList.remove("hidden");
    connect(savedConfig.serverUrl, bayName, facilityId);
  }
}

saveBtn.addEventListener("click", async function () {
  var serverUrl  = serverUrlIn.value.trim();
  var bayName    = bayNameIn.value.trim();
  var facilityId = facilityIdIn.value.trim();

  if (!serverUrl || !bayName) {
    serverUrlIn.style.borderColor = !serverUrl ? "#ef4444" : "";
    bayNameIn.style.borderColor   = !bayName   ? "#ef4444" : "";
    return;
  }

  var cfg = { serverUrl: serverUrl, bayName: bayName, facilityId: facilityId };
  await ipcRenderer.invoke("config:save", cfg);
  savedConfig = cfg;

  configPanel.classList.add("hidden");
  reconfigBtn.classList.remove("hidden");
  connect(serverUrl, bayName, facilityId);
});

reconfigBtn.addEventListener("click", function () {
  configPanel.classList.remove("hidden");
  reconfigBtn.classList.add("hidden");
  if (savedConfig) {
    serverUrlIn.value  = savedConfig.serverUrl || "";
    bayNameIn.value    = savedConfig.bayName || savedConfig.bayId || "";
    facilityIdIn.value = savedConfig.facilityId || "";
  }
});

initConfig();

render();
setInterval(tick, 250);
