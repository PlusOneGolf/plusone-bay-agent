# PlusOne Bay Agent (Electron)

Fullscreen kiosk overlay that runs on each bay PC. Connects to the PlusOne Control Room server via Socket.IO.

## Features

- **Soft-lock overlay** — fullscreen, always-on-top, no frame, kiosk mode
- **Timer HUD** — shows remaining time in top-right corner when unlocked
- **5-minute warning** — overlay alert when 5 minutes remain
- **Auto-lock** — locks screen when timer reaches 0:00
- **Disconnect safety** — auto-locks after 60 seconds without server contact
- **Persistent config** — Server URL and Bay ID saved in localStorage
- **Connection indicator** — shows CONNECTED / DISCONNECTED / RECONNECTING

## Commands (received from Control Room)

| Command | Effect |
|---------|--------|
| `lock` | Show lock overlay, clear timer |
| `unlock` | Hide lock overlay, show timer HUD |
| `start {seconds}` | Unlock + start countdown |
| `extend {seconds}` | Add time to running timer |
| `end` | Lock immediately |
| `message {text}` | Show staff message overlay |

## Prerequisites

- **Node.js** 18+ installed on the Windows PC
- **npm** (comes with Node.js)

## Running Locally (Development)

```bash
cd bay-agent
npm install
npm start
```

This launches the fullscreen overlay. To **exit** the kiosk, press `Ctrl+Shift+X`.

## First-Time Setup

1. Launch the app — you'll see the LOCKED screen with a configuration form
2. Enter the **Server URL** (the deployed Control Room URL, e.g. `https://your-app.replit.app`)
3. Enter the **Bay ID** (e.g. `Bay-1`)
4. Click **Save & Connect**
5. The bay will appear as ONLINE in the Control Room dashboard

Configuration persists across restarts. Click "Reconfigure" on the lock screen to change settings.

## Packaging for Distribution

```bash
cd bay-agent
npm run dist
```

This uses `electron-builder` to create a Windows NSIS installer in the `dist/` folder. The resulting `.exe` can be installed on any bay PC.

## Architecture

```
bay-agent/
├── package.json      # Electron + socket.io-client dependencies
├── main.js           # Electron main process (BrowserWindow config)
├── renderer.html     # UI markup + styles
├── renderer.js       # Socket.IO client logic + timer + commands
└── README.md         # This file
```

### Key Behaviors

- **Kiosk mode**: `fullscreen: true`, `kiosk: true`, `alwaysOnTop: true`, `frame: false`
- **Hard to dismiss**: Alt+F4, Ctrl+W, Ctrl+Q are blocked. Only Ctrl+Shift+X exits.
- **Window refocus**: If window loses focus, it re-grabs it automatically
- **Reconnection**: Socket.IO reconnects automatically with exponential backoff
- **Safety lock**: If server contact is lost for >60 seconds, bay auto-locks

## Exit Shortcut

Press `Ctrl + Shift + X` to quit the application. This is intentionally hidden from end users.
