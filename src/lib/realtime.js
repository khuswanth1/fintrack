// Live updates over a single WebSocket per tab. Authenticates with the in-memory access token in the first
// frame (never in the URL), reconnects with jittered exponential backoff, and refreshes the token when the
// server closes with 4001. Server event types: "ready", "data.changed", "notification.created".
import { getAccessToken, refreshSession } from "./api.js";

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

const listeners = new Map(); // type -> Set<fn>
const statusListeners = new Set();
let socket = null;
let status = "idle"; // idle | connecting | open | reconnecting | closed
let wanted = false;
let attempt = 0;
let retryTimer = null;
let pingTimer = null;

function setStatus(next) {
  if (next === status) return;
  status = next;
  statusListeners.forEach((fn) => fn(next));
}

function dispatch(msg) {
  for (const key of [msg.type, "*"]) {
    listeners.get(key)?.forEach((fn) => {
      try { fn(msg); } catch (err) { console.error("realtime listener failed", err); }
    });
  }
}

function wsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/v1/ws`;
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  if (!wanted) return;
  setStatus("reconnecting");
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
  attempt += 1;
  retryTimer = setTimeout(connect, delay);
}

async function connect() {
  clearTimeout(retryTimer);
  if (!wanted || socket) return;
  let token = getAccessToken();
  if (!token) {
    try { await refreshSession(); token = getAccessToken(); } catch { scheduleReconnect(); return; }
  }
  if (!wanted || socket || !token) return;

  setStatus(attempt ? "reconnecting" : "connecting");
  const ws = new WebSocket(wsUrl());
  socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === "pong") return;
    if (msg.type === "ready") {
      attempt = 0;
      setStatus("open");
      clearInterval(pingTimer);
      pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), PING_MS);
    }
    dispatch(msg);
  };
  ws.onclose = async (event) => {
    if (socket === ws) socket = null;
    clearInterval(pingTimer);
    if (!wanted) { setStatus("closed"); return; }
    if (event.code === 4003) { wanted = false; setStatus("closed"); return; } // account disabled
    if (event.code === 4001 && getAccessToken() === token) {
      // Our token expired or was rejected; get a fresh one (shared with any in-flight API refresh).
      try { await refreshSession(); } catch { wanted = false; setStatus("closed"); return; }
    }
    scheduleReconnect();
  };
}

function reconnectNow() {
  if (wanted && !socket) { attempt = 0; connect(); }
}

export const realtime = {
  start() {
    if (wanted) return;
    wanted = true;
    attempt = 0;
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", onVisible);
    connect();
  },
  stop() {
    wanted = false;
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    window.removeEventListener("online", reconnectNow);
    document.removeEventListener("visibilitychange", onVisible);
    const ws = socket;
    socket = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, "Signed out");
    setStatus("closed");
  },
  subscribe(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },
  /** Deliver an event to local subscribers only, e.g. "data.changed" after a write made in this tab. */
  emit(msg) { dispatch(msg); },
  onStatus(fn) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  },
  get status() { return status; },
};

function onVisible() {
  if (document.visibilityState === "visible") reconnectNow();
}
