const { io } = require("socket.io-client");
const { ipcRenderer } = require("electron");

const setupScreen      = document.getElementById("setupScreen");
const setupSummary     = document.getElementById("setupSummary");
const setupFormWrap    = document.getElementById("setupFormWrap");
const connectBtn       = document.getElementById("connectBtn");
const editSettingsBtn  = document.getElementById("editSettingsBtn");
const backToSummaryBtn = document.getElementById("backToSummaryBtn");
const summaryServer    = document.getElementById("summaryServer");
const summaryBay       = document.getElementById("summaryBay");
const summaryTps       = document.getElementById("summaryTps");
const summaryTpsRow    = document.getElementById("summaryTpsRow");
const lockScreen       = document.getElementById("lockScreen");
const hud              = document.getElementById("hud");
const timeLeftEl       = document.getElementById("timeLeft");
const timerBar         = document.getElementById("timerBar");
const timerBarValue    = document.getElementById("timerBarValue");
const notifyBar        = document.getElementById("notifyBar");
const notifyIcon       = document.getElementById("notifyIcon");
const notifyText       = document.getElementById("notifyText");
const notifyTimer      = document.getElementById("notifyTimer");
const statusEl         = document.getElementById("status");
const statusDot        = document.getElementById("statusDot");
const statusText       = document.getElementById("statusText");

const serverUrlIn      = document.getElementById("serverUrl");
const bayNameIn        = document.getElementById("bayName");
const facilityIdIn     = document.getElementById("facilityId");
const saveBtn          = document.getElementById("saveConnect");
const tpsPathIn        = document.getElementById("tpsPath");
const tpsProcessIn     = document.getElementById("tpsProcessName");
const nircmdPathIn     = document.getElementById("nircmdPath");
const browseTpsBtn     = document.getElementById("browseBtn");
const browseNircmdBtn  = document.getElementById("browseNircmd");
const nextReservation  = document.getElementById("nextReservation");
const nextResName      = document.getElementById("nextResName");
const nextResTime      = document.getElementById("nextResTime");

let socket             = null;
let endsAt             = null;
let locked             = true;
let warned             = false;
let connected          = false;
let lastServerSeen     = 0;
let pingInterval       = null;
let windowMode         = "setup";
let warnEnabled        = false;
let pinUnlocked        = false;
let disconnectBehavior = null;
let notifyMessage      = null;
let notifyTimeout      = null;
let displayOffTimer    = null;
let displayWakeTimer   = null;
let localConfig        = {};

function log(msg) {
  var prefix = typeof msg === "string" ? msg : JSON.stringify(msg);
  console.log(prefix);
  ipcRenderer.send("log:write", prefix);
}

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
        log("PIN staff unlock → opening settings");
        cancelDisplayTimers();
        wakeDisplay();
        pinUnlocked = true;
        doUnlock();
        ipcRenderer.send("tps:launch");
        showSetupSummary();
        if (socket && socket.connected) {
          log("emit bay:state {locked:false}");
          socket.emit("bay:state", { locked: false });
        }
      } else {
        if (socket && socket.connected) {
          log("emit bay:pin-unlock (PIN hidden)");
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

  setupScreen.classList.toggle("hidden", windowMode !== "setup");
  timerBar.style.display   = "none";
  notifyBar.style.display  = "none";
  lockScreen.style.display = "none";
  hud.style.display        = "none";
  statusEl.style.display   = "none";

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
    statusEl.style.display   = "flex";
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

function cancelDisplayTimers() {
  if (displayOffTimer)  { clearTimeout(displayOffTimer);  displayOffTimer  = null; }
  if (displayWakeTimer) { clearTimeout(displayWakeTimer); displayWakeTimer = null; }
}

function wakeDisplay() {
  ipcRenderer.send("display:wake");
}

function sleepDisplay() {
  ipcRenderer.send("display:off");
}

function scheduleDisplayOff(delaySeconds) {
  var fallback = (localConfig && localConfig.displayOffDelaySeconds) || 300;
  var ms = (delaySeconds || fallback) * 1000;
  displayOffTimer = setTimeout(function () {
    displayOffTimer = null;
    sleepDisplay();
  }, ms);
}

function scheduleDisplayWake(wakeAtIso) {
  if (!wakeAtIso) return;
  var wakeMs = new Date(wakeAtIso).getTime() - Date.now();
  if (wakeMs <= 0) { wakeDisplay(); return; }
  displayWakeTimer = setTimeout(function () {
    displayWakeTimer = null;
    wakeDisplay();
  }, wakeMs);
}

function handleCommand(data) {
  var command = data.command || data.cmd;
  var payload = data.payload || data;
  lastServerSeen = Date.now();
  connected = true;

  if (windowMode === "setup") {
    log("CMD ignored while setup screen open: " + command);
    return;
  }

  if (command === "lock") {
    if (payload.reason === "invalid_pin" || payload.reason === "invalid_request") {
      log("CMD lock rejected reason=" + payload.reason);
      showPinError("Incorrect code, please try again");
      return;
    }
    log("CMD lock mode=" + (payload.mode || "transition") + " next=" + JSON.stringify(payload.nextReservation || null));
    cancelDisplayTimers();
    ipcRenderer.send("tps:kill");
    pinUnlocked = false;
    doLock({ nextReservation: payload.nextReservation || null });

    if (payload.mode === "sleep") {
      scheduleDisplayOff(payload.displayOffDelaySeconds || null);
      if (payload.wakeAt) { scheduleDisplayWake(payload.wakeAt); }
    }
    return;
  }

  if (command === "unlock") {
    log("CMD unlock");
    cancelDisplayTimers();
    wakeDisplay();
    pinUnlocked = false;
    doUnlock();
    ipcRenderer.send("tps:launch");
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
    cancelDisplayTimers();
    ipcRenderer.send("tps:kill");
    pinUnlocked = false;
    doLock({});
    return;
  }

  if (command === "message") {
    var msgContent = payload.text || "Message from staff";
    showNotification("\u2709", msgContent, 15000);
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
    log("CONNECTED to " + serverUrl + " | emit bay:hello " + JSON.stringify(hello));
    socket.emit("bay:hello", hello);
    render();
  });

  socket.on("disconnect", function (reason) {
    connected = false;
    log("DISCONNECTED reason=" + reason + " disconnectBehavior=" + disconnectBehavior + " locked=" + locked);
    if (disconnectBehavior === "unlock" && locked) {
      cancelDisplayTimers();
      wakeDisplay();
      pinUnlocked = true;
      locked = false;
      showNextReservation(null);
      ipcRenderer.send("tps:launch");
      log("disconnect:unlock → launching TPS, hiding window");
      setWindowMode("hidden");
    }
    render();
  });

  socket.on("reconnect", function (attempt) {
    connected = true;
    lastServerSeen = Date.now();
    var hello = { bayName: bayName };
    if (facilityId) hello.facilityId = Number(facilityId);
    log("RECONNECTED attempt=" + attempt + " | emit bay:hello " + JSON.stringify(hello));
    socket.emit("bay:hello", hello);
    render();
  });

  socket.on("connect_error", function (err) {
    log("CONNECT_ERROR " + err.message);
  });

  socket.on("bay:hello:ack", function (data) {
    disconnectBehavior = (data && data.disconnectBehavior) || null;
    log("RECV bay:hello:ack " + JSON.stringify(data));
  });

  socket.on("bay:command", function (data) {
    log("RECV bay:command " + JSON.stringify(data));
    handleCommand(data);
  });

  socket.on("bay:pong", function () {
    lastServerSeen = Date.now();
    connected = true;
  });

  socket.onAny(function (event, data) {
    lastServerSeen = Date.now();
    if (event !== "bay:pong") {
      log("RECV " + event + (data !== undefined ? " " + JSON.stringify(data) : ""));
    }
  });

  pingInterval = setInterval(function () {
    if (socket && socket.connected) {
      socket.emit("bay:ping");
    }
  }, 25000);
}

var savedConfig = null;

function populateLocalConfigFields() {
  tpsPathIn.value    = localConfig.tpsPath        || "";
  tpsProcessIn.value = localConfig.tpsProcessName || "";
  nircmdPathIn.value = localConfig.nircmdPath      || "";
}

function launchKiosk() {
  locked = true;
  setWindowMode("kiosk");
  render();
}

function showSetupForm() {
  setupSummary.classList.add("hidden");
  setupFormWrap.classList.remove("hidden");
  backToSummaryBtn.classList.add("hidden");
  setWindowMode("setup");
  render();
}

function showSetupSummary() {
  if (!savedConfig) { showSetupForm(); return; }
  summaryServer.textContent = savedConfig.serverUrl || "";
  summaryBay.textContent    = savedConfig.bayName || savedConfig.bayId || "";
  var tpsFile = localConfig.tpsPath ? localConfig.tpsPath.split("\\").pop() : null;
  if (tpsFile) {
    summaryTps.textContent = tpsFile;
    summaryTpsRow.classList.remove("hidden");
  } else {
    summaryTpsRow.classList.add("hidden");
  }
  if (savedConfig) {
    serverUrlIn.value  = savedConfig.serverUrl || "";
    bayNameIn.value    = savedConfig.bayName || savedConfig.bayId || "";
    facilityIdIn.value = savedConfig.facilityId || "";
  }
  populateLocalConfigFields();
  setupSummary.classList.remove("hidden");
  setupFormWrap.classList.add("hidden");
  setWindowMode("setup");
  render();
}

async function initConfig() {
  localConfig = (await ipcRenderer.invoke("app:config:load")) || {};
  var logPath = await ipcRenderer.invoke("log:path");
  log("=== Bay Agent starting | log=" + logPath + " ===");
  log("localConfig " + JSON.stringify(localConfig));
  populateLocalConfigFields();
  savedConfig = await ipcRenderer.invoke("config:load");
  if (savedConfig && savedConfig.serverUrl && (savedConfig.bayName || savedConfig.bayId)) {
    var bayName    = savedConfig.bayName || savedConfig.bayId;
    var facilityId = savedConfig.facilityId || "";
    serverUrlIn.value  = savedConfig.serverUrl;
    bayNameIn.value    = bayName;
    facilityIdIn.value = facilityId;
    log("Saved config found — showing summary (waiting for Connect)");
    showSetupSummary();
  } else {
    log("No saved config — showing setup form");
    showSetupForm();
  }
}

saveBtn.addEventListener("click", async function () {
  var serverUrl   = serverUrlIn.value.trim();
  var bayName     = bayNameIn.value.trim();
  var facilityId  = facilityIdIn.value.trim();
  var tpsPath     = tpsPathIn.value.trim();
  var tpsProcess  = tpsProcessIn.value.trim();
  var nircmdPath  = nircmdPathIn.value.trim();

  if (!serverUrl || !bayName) {
    serverUrlIn.style.borderColor = !serverUrl ? "#ef4444" : "";
    bayNameIn.style.borderColor   = !bayName   ? "#ef4444" : "";
    return;
  }

  var cfg = { serverUrl: serverUrl, bayName: bayName, facilityId: facilityId };
  await ipcRenderer.invoke("config:save", cfg);
  savedConfig = cfg;

  var localCfg = {};
  if (tpsPath)    localCfg.tpsPath        = tpsPath;
  if (tpsProcess) localCfg.tpsProcessName = tpsProcess;
  if (nircmdPath) localCfg.nircmdPath     = nircmdPath;
  if (Object.keys(localCfg).length > 0) {
    await ipcRenderer.invoke("app:config:save", localCfg);
    localConfig = Object.assign({}, localConfig, localCfg);
    log("localConfig saved " + JSON.stringify(localCfg));
  }

  log("Setup complete — showing lock screen, server will reconcile");
  launchKiosk();
  connect(serverUrl, bayName, facilityId);
});

connectBtn.addEventListener("click", function () {
  var bayName    = savedConfig.bayName || savedConfig.bayId;
  var facilityId = savedConfig.facilityId || "";
  log("Connect clicked — showing lock screen, server will reconcile");
  launchKiosk();
  connect(savedConfig.serverUrl, bayName, facilityId);
});

editSettingsBtn.addEventListener("click", function () {
  if (savedConfig) {
    serverUrlIn.value  = savedConfig.serverUrl || "";
    bayNameIn.value    = savedConfig.bayName || savedConfig.bayId || "";
    facilityIdIn.value = savedConfig.facilityId || "";
  }
  populateLocalConfigFields();
  setupSummary.classList.add("hidden");
  setupFormWrap.classList.remove("hidden");
  backToSummaryBtn.classList.remove("hidden");
});

backToSummaryBtn.addEventListener("click", function () {
  showSetupSummary();
});

document.getElementById("quitBtnSummary").addEventListener("click", function () {
  ipcRenderer.send("app:quit");
});

document.getElementById("quitBtnForm").addEventListener("click", function () {
  ipcRenderer.send("app:quit");
});

browseTpsBtn.addEventListener("click", async function () {
  var chosen = await ipcRenderer.invoke("dialog:open-file", {
    title: "Select TPS / TrackMan executable",
    filters: [{ name: "Executables", extensions: ["exe"] }, { name: "All Files", extensions: ["*"] }],
  });
  if (chosen) {
    tpsPathIn.value = chosen;
    var name = chosen.split("\\").pop().replace(/\.exe$/i, "");
    if (!tpsProcessIn.value) tpsProcessIn.value = name;
  }
});

browseNircmdBtn.addEventListener("click", async function () {
  var chosen = await ipcRenderer.invoke("dialog:open-file", {
    title: "Select nircmd.exe",
    filters: [{ name: "nircmd", extensions: ["exe"] }, { name: "All Files", extensions: ["*"] }],
  });
  if (chosen) nircmdPathIn.value = chosen;
});

initConfig();

render();
setInterval(tick, 250);
