import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { WebSocketServer } from 'ws';

import { authorizeRequest, httpAuthMiddleware } from './auth.js';
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

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, session: session.snapshot() });
});

app.use(httpAuthMiddleware(config));
app.use('/vendor/xterm', express.static(xtermDir, { immutable: true, maxAge: '1h' }));
app.use(express.static(publicDir, { maxAge: '5m' }));
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const clients = new Map();
let controllerId = null;

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

session.on('output', (data) => {
  history.append(data);
  broadcast({ type: 'output', data });
});

session.on('status', (snapshot) => {
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
    clients: clientSummary()
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
      return;
    }

    if (message.type === 'resize') {
      if (!isController(client)) return;
      session.resize(message.cols, message.rows);
      return;
    }

    if (message.type === 'start') {
      if (!isController(client)) return sendError(ws, 'Only the controller can start Codex.');
      session.start();
      return;
    }

    if (message.type === 'stop') {
      if (!isController(client)) return sendError(ws, 'Only the controller can stop Codex.');
      await session.stop();
      return;
    }

    if (message.type === 'restart') {
      if (!isController(client)) return sendError(ws, 'Only the controller can restart Codex.');
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
      session.write(data);
      return;
    }

    sendError(ws, `Unsupported message type: ${message.type}`);
  });

  ws.on('close', () => {
    clients.delete(id);
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

