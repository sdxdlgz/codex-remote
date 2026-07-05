import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { WebSocketServer } from 'ws';

import { authorizeRequest, hasValidAppToken, httpAuthMiddleware, isAppTokenValueValid } from './auth.js';
import { CodexSession } from './codex-session.js';
import { resolveConfig } from './config.js';
import { ScrollbackBuffer } from './scrollback-buffer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const xtermDir = path.join(rootDir, 'node_modules', '@xterm', 'xterm');

const config = resolveConfig();
const history = new ScrollbackBuffer(config.historyBytes);
const session = new CodexSession({ command: config.command, cwd: config.cwd });

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, session: session.snapshot() });
});

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function authCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 30
  };
}

function sanitizeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function renderLoginPage({ error = '', next = '/' } = {}) {
  const safeNext = String(next || '/').replaceAll('"', '&quot;');
  const errorHtml = error ? `<p class="error">${error}</p>` : '';
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Codex Remote Login</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #0b1020; color: #eef4ff; }
      main { width: min(92vw, 420px); padding: 26px; border: 1px solid rgba(255,255,255,.12); border-radius: 18px; background: #121a2f; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { color: #9fb0d0; line-height: 1.5; }
      label { display: block; margin: 18px 0 8px; color: #cfe1ff; }
      input, button { width: 100%; min-height: 44px; border-radius: 12px; font: inherit; box-sizing: border-box; }
      input { border: 1px solid rgba(255,255,255,.16); padding: 10px 12px; background: #18223a; color: #eef4ff; }
      button { margin-top: 14px; border: 0; background: #2f81f7; color: white; font-weight: 650; }
      .error { color: #ff9b9b; }
    </style>
  </head>
  <body>
    <main>
      <h1>Codex Remote</h1>
      <p>Enter the access token from the local .env file.</p>
      ${errorHtml}
      <form method="post" action="/login">
        <input type="hidden" name="next" value="${safeNext}" />
        <label for="token">Access token</label>
        <input id="token" name="token" type="password" autocomplete="current-password" autofocus required />
        <button type="submit">Login</button>
      </form>
    </main>
  </body>
</html>`;
}

app.get('/login', (req, res) => {
  if (!config.appAuthToken || hasValidAppToken(req, config)) {
    res.redirect(sanitizeNext(req.query.next));
    return;
  }
  res.type('html').send(renderLoginPage({ next: sanitizeNext(req.query.next) }));
});

app.post('/login', (req, res) => {
  const next = sanitizeNext(req.body.next);
  if (!isAppTokenValueValid(req.body.token, config)) {
    res.status(401).type('html').send(renderLoginPage({ error: 'Invalid access token.', next }));
    return;
  }
  res.cookie(config.authCookieName, config.appAuthToken, authCookieOptions(req));
  res.redirect(next);
});

app.get('/logout', (req, res) => {
  res.clearCookie(config.authCookieName, { path: '/', secure: isSecureRequest(req), sameSite: 'lax' });
  res.redirect('/login');
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const clients = new Map();
let controllerId = null;
const activityLog = [];
const terminalTail = [];
let partialTerminalLine = '';
let contextBroadcastTimer = null;

function stripAnsi(value) {
  return String(value ?? '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/\r/g, '');
}

function truncate(value, max = 220) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function pushActivity(type, text, extra = {}) {
  const item = {
    id: randomUUID(),
    at: new Date().toISOString(),
    type,
    text: truncate(text),
    sessionId: session.snapshot().sessionId,
    sessionLabel: session.snapshot().sessionLabel,
    ...extra
  };
  activityLog.push(item);
  while (activityLog.length > 40) activityLog.shift();
  broadcast({ type: 'activity', item, context: contextPayload() });
}

function appendTerminalTail(data) {
  const text = stripAnsi(data);
  if (!text.trim()) return;

  partialTerminalLine += text;
  const lines = partialTerminalLine.split('\n');
  partialTerminalLine = lines.pop() || '';

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;
    terminalTail.push({
      at: new Date().toISOString(),
      text: truncate(clean, 260),
      sessionId: session.snapshot().sessionId
    });
  }

  if (partialTerminalLine.length > 260) {
    terminalTail.push({
      at: new Date().toISOString(),
      text: truncate(partialTerminalLine, 260),
      sessionId: session.snapshot().sessionId
    });
    partialTerminalLine = '';
  }

  while (terminalTail.length > 30) terminalTail.shift();
  scheduleContextBroadcast();
}

function contextPayload() {
  return {
    activity: activityLog.slice(-20),
    terminalTail: terminalTail.slice(-16)
  };
}

function scheduleContextBroadcast() {
  if (contextBroadcastTimer) return;
  contextBroadcastTimer = setTimeout(() => {
    contextBroadcastTimer = null;
    broadcast({ type: 'context', context: contextPayload() });
  }, 900);
}

function safeSend(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcast(payload) {
  const encoded = JSON.stringify(payload);
  for (const client of clients.values()) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(encoded);
  }
}

function publicConfig() {
  return {
    host: config.host,
    port: config.port,
    publicUrl: config.publicUrl,
    command: config.command,
    cwd: config.cwd,
    authRequired: Boolean(config.appAuthToken),
    requireCloudflareAccess: config.requireCloudflareAccess,
    allowControlTakeover: config.allowControlTakeover,
    maxInputBytes: config.maxInputBytes
  };
}

function clientSummary() {
  return [...clients.values()].map((client) => ({
    id: client.id,
    role: client.role,
    email: client.email,
    connectedAt: client.connectedAt
  }));
}

function sendPresence() {
  broadcast({
    type: 'presence',
    controllerId,
    clients: clientSummary()
  });
}

function statePayload() {
  return {
    ok: true,
    config: publicConfig(),
    session: session.snapshot(),
    controllerId,
    clients: clientSummary(),
    context: contextPayload()
  };
}

function sendApiAuthFailure(res, auth) {
  res
    .status(auth.status)
    .type('application/json')
    .send(JSON.stringify({
      ok: false,
      status: auth.status,
      reason: auth.reason,
      loginRequired: Boolean(auth.loginRequired)
    }));
}

app.get('/api/state', (req, res) => {
  const auth = authorizeRequest(req, config);
  if (!auth.ok) {
    sendApiAuthFailure(res, auth);
    return;
  }
  res.json(statePayload());
});

app.get('/api/context', (req, res) => {
  const auth = authorizeRequest(req, config);
  if (!auth.ok) {
    sendApiAuthFailure(res, auth);
    return;
  }
  res.json({ ok: true, context: contextPayload() });
});

app.use(httpAuthMiddleware(config));
app.use('/vendor/xterm', express.static(xtermDir, { immutable: true, maxAge: '1h' }));
app.use(express.static(publicDir, {
  maxAge: 0,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

function setController(nextControllerId) {
  if (controllerId && clients.has(controllerId)) {
    const previous = clients.get(controllerId);
    previous.role = 'viewer';
    safeSend(previous.ws, { type: 'role', role: 'viewer' });
  }

  controllerId = nextControllerId;

  if (controllerId && clients.has(controllerId)) {
    const current = clients.get(controllerId);
    current.role = 'controller';
    safeSend(current.ws, { type: 'role', role: 'controller' });
  }

  sendPresence();
}

function promoteFirstClientIfNeeded() {
  if (controllerId && clients.has(controllerId)) return;
  const first = clients.values().next().value;
  if (first) setController(first.id);
  else {
    controllerId = null;
    sendPresence();
  }
}

function sendError(ws, message) {
  safeSend(ws, { type: 'error', message });
}

function isController(client) {
  return client && client.id === controllerId && client.role === 'controller';
}

function rejectUpgrade(socket, status, reason) {
  const body = reason || 'WebSocket upgrade rejected.';
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      '\r\n' +
      body
  );
  socket.destroy();
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  const auth = authorizeRequest(req, config);
  if (!auth.ok) {
    rejectUpgrade(socket, auth.status, auth.reason);
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, auth);
  });
});

let lastRecordedSessionKey = '';

session.on('output', (data) => {
  history.append(data);
  appendTerminalTail(data);
  broadcast({ type: 'output', data });
});

session.on('status', (snapshot) => {
  const key = `${snapshot.sessionId || 'none'}:${snapshot.status}:${snapshot.exitCode ?? ''}`;
  if (key !== lastRecordedSessionKey) {
    lastRecordedSessionKey = key;
    pushActivity('session', `Session ${snapshot.sessionLabel || snapshot.sessionId || 'not started'} is ${snapshot.status}`);
  }
  broadcast({ type: 'status', session: snapshot });
});

session.on('sessionError', (message) => {
  broadcast({ type: 'error', message });
});

wss.on('connection', (ws, _req, auth) => {
  const id = randomUUID();
  const client = {
    id,
    ws,
    email: auth.email || 'local',
    role: controllerId ? 'viewer' : 'controller',
    connectedAt: new Date().toISOString(),
    isAlive: true
  };

  clients.set(id, client);
  if (!controllerId) controllerId = id;
  pushActivity('client', `${client.email} connected as ${client.role}`, { clientId: id });

  ws.on('pong', () => {
    client.isAlive = true;
  });

  safeSend(ws, {
    type: 'hello',
    id,
    role: client.role,
    config: publicConfig(),
    session: session.snapshot(),
    controllerId,
    clients: clientSummary(),
    context: contextPayload()
  });

  const scrollback = history.toString();
  if (scrollback) safeSend(ws, { type: 'output', data: scrollback });
  sendPresence();

  ws.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      sendError(ws, 'Invalid WebSocket message.');
      return;
    }

    if (!message || typeof message.type !== 'string') {
      sendError(ws, 'Message type is required.');
      return;
    }

    if (message.type === 'takeControl') {
      if (!config.allowControlTakeover && controllerId && controllerId !== id) {
        sendError(ws, 'Control takeover is disabled.');
        return;
      }
      setController(id);
      pushActivity('control', `${client.email} took control`, { clientId: id });
      return;
    }

    if (message.type === 'resize') {
      if (!isController(client)) return;
      session.resize(message.cols, message.rows);
      return;
    }

    if (message.type === 'start') {
      if (!isController(client)) return sendError(ws, 'Only the controller can start Codex.');
      pushActivity('control', `${client.email} started Codex`, { clientId: id });
      session.start();
      return;
    }

    if (message.type === 'stop') {
      if (!isController(client)) return sendError(ws, 'Only the controller can stop Codex.');
      pushActivity('control', `${client.email} stopped Codex`, { clientId: id });
      await session.stop();
      return;
    }

    if (message.type === 'restart') {
      if (!isController(client)) return sendError(ws, 'Only the controller can restart Codex.');
      pushActivity('control', `${client.email} restarted Codex`, { clientId: id });
      history.clear();
      broadcast({ type: 'clear' });
      await session.restart();
      return;
    }

    if (message.type === 'input') {
      if (!isController(client)) return sendError(ws, 'Only the controller can send input.');
      const data = String(message.data ?? '');
      if (Buffer.byteLength(data, 'utf8') > config.maxInputBytes) {
        sendError(ws, `Input is too large. Limit: ${config.maxInputBytes} bytes.`);
        return;
      }
      const printable = stripAnsi(data).replace(/[\r\n]+/g, ' ').trim();
      if (printable && (data.includes('\r') || data.includes('\n') || printable.length > 1)) {
        pushActivity('input', `${client.email}: ${printable}`, { clientId: id });
      }
      session.write(data);
      return;
    }

    if (message.type === 'macro') {
      if (!isController(client)) return sendError(ws, 'Only the controller can send input.');
      const macros = {
        continue: '\r',
        approve: 'y\r',
        reject: 'n\r',
        ctrlC: '\u0003'
      };
      const data = macros[message.name];
      if (!data) return sendError(ws, 'Unknown macro.');
      pushActivity('macro', `${client.email}: ${message.name}`, { clientId: id });
      session.write(data);
      return;
    }

    sendError(ws, `Unsupported message type: ${message.type}`);
  });

  ws.on('close', () => {
    clients.delete(id);
    pushActivity('client', `${client.email} disconnected`, { clientId: id });
    if (controllerId === id) controllerId = null;
    promoteFirstClientIfNeeded();
  });
});

const heartbeat = setInterval(() => {
  for (const client of clients.values()) {
    if (!client.isAlive) {
      client.ws.terminate();
      clients.delete(client.id);
      if (controllerId === client.id) controllerId = null;
      continue;
    }
    client.isAlive = false;
    client.ws.ping();
  }
  promoteFirstClientIfNeeded();
}, 30_000);

server.on('close', () => clearInterval(heartbeat));

server.listen(config.port, config.host, () => {
  console.log(`[codex-remote] Listening on http://${config.host}:${config.port}`);
  console.log(`[codex-remote] Codex command: ${config.command}`);
  console.log(`[codex-remote] Working directory: ${config.cwd}`);
  if (config.publicUrl) console.log(`[codex-remote] Public URL: ${config.publicUrl}`);
  if (!config.requireCloudflareAccess) {
    console.warn('[codex-remote] REQUIRE_CF_ACCESS is false. Enable it before exposing this service publicly.');
  }
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    console.warn('[codex-remote] Service is not bound to 127.0.0.1. Prefer localhost behind Cloudflare Tunnel.');
  }
  if (config.autoStart) session.start();
});

async function shutdown() {
  console.log('\n[codex-remote] Shutting down...');
  clearInterval(heartbeat);
  for (const client of clients.values()) client.ws.close(1001, 'Server shutting down');
  await session.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

