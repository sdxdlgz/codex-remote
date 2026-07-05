const el = {
  terminal: document.getElementById('terminal'),
  subtitle: document.getElementById('subtitle'),
  connectionBadge: document.getElementById('connectionBadge'),
  roleBadge: document.getElementById('roleBadge'),
  connectionDot: document.getElementById('connectionDot'),
  connectionDetail: document.getElementById('connectionDetail'),
  endpointText: document.getElementById('endpointText'),
  wsEndpointText: document.getElementById('wsEndpointText'),
  retryButton: document.getElementById('retryButton'),
  sessionDot: document.getElementById('sessionDot'),
  sessionIdText: document.getElementById('sessionIdText'),
  sessionStatusText: document.getElementById('sessionStatusText'),
  sessionTimeText: document.getElementById('sessionTimeText'),
  cwdText: document.getElementById('cwdText'),
  roleText: document.getElementById('roleText'),
  clientIdText: document.getElementById('clientIdText'),
  controllerText: document.getElementById('controllerText'),
  clientsText: document.getElementById('clientsText'),
  activityList: document.getElementById('activityList'),
  terminalTailList: document.getElementById('terminalTailList'),
  terminalHint: document.getElementById('terminalHint'),
  clearButton: document.getElementById('clearButton'),
  sendForm: document.getElementById('sendForm'),
  lineInput: document.getElementById('lineInput'),
  sendButton: document.getElementById('sendButton'),
  takeControlButton: document.getElementById('takeControlButton'),
  startButton: document.getElementById('startButton'),
  restartButton: document.getElementById('restartButton'),
  stopButton: document.getElementById('stopButton'),
  statusPanel: document.getElementById('statusPanel'),
  toast: document.getElementById('toast')
};

const term = new Terminal({
  cursorBlink: true,
  convertEol: false,
  fontFamily: '"Cascadia Mono", Consolas, "SFMono-Regular", monospace',
  fontSize: 13,
  lineHeight: 1.15,
  scrollback: 8000,
  theme: {
    background: '#050816',
    foreground: '#e5ecff',
    cursor: '#7dd3fc',
    selectionBackground: '#31476d',
    black: '#0b1020',
    red: '#fb7185',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e5e7eb'
  }
});
term.open(el.terminal);
term.writeln('\x1b[36mCodex Remote\x1b[0m connecting to WebSocket...');

const state = {
  ws: null,
  connected: false,
  socketOpen: false,
  phase: 'connecting',
  detail: 'Preparing connection...',
  role: 'viewer',
  id: '',
  config: null,
  session: null,
  clients: [],
  context: { activity: [], terminalTail: [] },
  controllerId: null,
  reconnectMs: 750,
  reconnectTimer: null,
  toastTimer: null,
  lastCols: 100,
  lastRows: 30,
  lastClose: null
};

function pageUrl(path) {
  return `${window.location.origin}${path}`;
}

function wsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function shortId(value) {
  if (!value) return '-';
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 6)}...${text.slice(-6)}` : text;
}

function formatTime(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function classForConnection() {
  if (state.connected) return 'ok';
  if (state.phase === 'error' || state.phase === 'closed') return 'danger';
  return 'warn';
}

function classForSession(status) {
  if (status === 'running') return 'ok';
  if (status === 'starting' || status === 'stopping') return 'warn';
  if (status === 'error') return 'danger';
  return 'muted';
}

function setPill(node, text, mode) {
  node.textContent = text;
  node.className = `pill ${mode || 'muted'}`;
}

function setDot(node, mode) {
  node.className = `dot ${mode || 'muted'}`;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function controllerClient() {
  return state.clients.find((client) => client.id === state.controllerId || client.role === 'controller');
}

function contextIcon(type) {
  const icons = {
    input: 'You',
    macro: 'Macro',
    control: 'Control',
    session: 'Session',
    client: 'Client'
  };
  return icons[type] || 'Event';
}

function renderContextList(node, items, emptyText, mapper) {
  if (!items || items.length === 0) {
    node.innerHTML = `<div class="empty-context">${emptyText}</div>`;
    return;
  }

  node.innerHTML = items
    .slice()
    .reverse()
    .map(mapper)
    .join('');
}

function renderContext() {
  renderContextList(
    el.activityList,
    state.context.activity,
    'No recent activity yet.',
    (item) => `
      <div class="context-item">
        <div class="context-meta">${contextIcon(item.type)} | ${formatTime(item.at)} | ${item.sessionLabel || item.sessionId || '-'}</div>
        <div class="context-text">${escapeHtml(item.text || '')}</div>
      </div>
    `
  );

  renderContextList(
    el.terminalTailList,
    state.context.terminalTail,
    'No terminal output yet.',
    (item) => `
      <div class="context-item terminal-tail-item">
        <div class="context-meta">${formatTime(item.at)} | ${shortId(item.sessionId)}</div>
        <div class="context-text monospace">${escapeHtml(item.text || '')}</div>
      </div>
    `
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function updateControls() {
  const isController = state.connected && state.role === 'controller';
  el.sendButton.disabled = !isController;
  el.lineInput.disabled = !isController;
  document.querySelectorAll('[data-macro]').forEach((button) => {
    button.disabled = !isController;
  });
  el.startButton.disabled = !isController || state.session?.status === 'running' || state.session?.status === 'starting';
  el.stopButton.disabled = !isController || state.session?.status !== 'running';
  el.restartButton.disabled = !isController;
  el.takeControlButton.disabled = !state.connected || isController;

  if (!state.connected) el.lineInput.placeholder = `Waiting for ${wsUrl()} ...`;
  else if (!isController) el.lineInput.placeholder = 'Viewer mode. Tap "Take control" before typing.';
  else el.lineInput.placeholder = 'Type a message and press Enter';
}

function updateStatusPanel() {
  const payload = {
    page: window.location.origin,
    websocket: wsUrl(),
    connection: {
      connected: state.connected,
      socketOpen: state.socketOpen,
      phase: state.phase,
      detail: state.detail,
      lastClose: state.lastClose
    },
    role: state.role,
    browserConnectionId: state.id,
    controllerId: state.controllerId,
    session: state.session,
    clients: state.clients,
    context: state.context,
    config: state.config
  };
  el.statusPanel.textContent = JSON.stringify(payload, null, 2);
}

function updateUi() {
  const connMode = classForConnection();
  const status = state.session?.status || 'unknown';
  const sessionMode = classForSession(status);
  const currentController = controllerClient();

  setPill(el.connectionBadge, state.connected ? 'connected' : state.phase === 'reconnecting' ? 'reconnecting' : 'offline', connMode);
  setPill(el.roleBadge, state.role === 'controller' ? 'controller' : 'viewer', state.role === 'controller' ? 'ok' : 'warn');
  setDot(el.connectionDot, connMode);
  setDot(el.sessionDot, sessionMode);

  el.subtitle.textContent = state.connected
    ? `${state.session?.sessionLabel || 'not started'} | ${status} | ${state.config?.publicUrl || window.location.origin}`
    : `Connecting to ${wsUrl()}`;

  el.connectionDetail.textContent = state.detail;
  el.endpointText.textContent = window.location.origin;
  el.wsEndpointText.textContent = wsUrl();

  el.sessionIdText.textContent = state.session?.sessionLabel || state.session?.sessionId || 'not started';
  el.sessionStatusText.textContent = status;
  el.sessionTimeText.textContent = state.session?.startedAt ? `${formatTime(state.session.startedAt)} start` : '-';
  el.cwdText.textContent = `cwd: ${state.session?.cwd || state.config?.cwd || '-'}`;

  el.roleText.textContent = state.role === 'controller' ? 'controller, can type' : 'viewer, take control first';
  el.clientIdText.textContent = shortId(state.id);
  el.controllerText.textContent = currentController
    ? `${currentController.email || 'local'} / ${shortId(currentController.id)}`
    : '-';
  el.clientsText.textContent = `${state.clients.length}`;

  el.terminalHint.textContent = state.session?.sessionId
    ? `${state.session.sessionId} | ${state.session.command}`
    : 'no Codex session yet';

  updateControls();
  renderContext();
  updateStatusPanel();
}

function send(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    showToast('WebSocket is not connected; retrying');
    return false;
  }
  state.ws.send(JSON.stringify(payload));
  return true;
}

function addLocalActivity(type, text) {
  state.context.activity = [
    ...state.context.activity,
    {
      id: `local-${Date.now()}`,
      at: new Date().toISOString(),
      type,
      text,
      sessionId: state.session?.sessionId,
      sessionLabel: state.session?.sessionLabel || 'local pending'
    }
  ].slice(-20);
  renderContext();
  updateStatusPanel();
}

function sendInput(data) {
  if (state.role !== 'controller') {
    showToast('Viewer mode: take control first');
    return false;
  }
  return send({ type: 'input', data });
}

function calculateTerminalSize() {
  const rect = el.terminal.getBoundingClientRect();
  const cols = Math.max(20, Math.min(300, Math.floor((rect.width - 18) / 8.1)));
  const rows = Math.max(5, Math.min(120, Math.floor((rect.height - 18) / 15.5)));
  return { cols, rows };
}

function resizeTerminal() {
  const { cols, rows } = calculateTerminalSize();
  if (cols === state.lastCols && rows === state.lastRows) return;
  state.lastCols = cols;
  state.lastRows = rows;
  term.resize(cols, rows);
  if (state.role === 'controller') send({ type: 'resize', cols, rows });
}

let resizeTimer = null;
function scheduleResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(resizeTerminal, 120);
}

function setPhase(phase, detail) {
  state.phase = phase;
  state.detail = detail;
  updateUi();
}

function handleMessage(message) {
  if (message.type === 'hello') {
    state.connected = true;
    state.socketOpen = true;
    state.phase = 'connected';
    state.detail = 'Connected to Codex Remote server';
    state.id = message.id;
    state.role = message.role;
    state.config = message.config;
    state.session = message.session;
    state.controllerId = message.controllerId;
    state.clients = message.clients || [];
    state.context = message.context || state.context;
    term.clear();
    term.writeln(`\x1b[32m[remote]\x1b[0m connected: ${message.session?.sessionLabel || message.session?.sessionId || 'not started'}`);
    resizeTerminal();
    updateUi();
    return;
  }

  if (message.type === 'output') {
    term.write(message.data || '');
    return;
  }

  if (message.type === 'clear') {
    term.clear();
    return;
  }

  if (message.type === 'status') {
    state.session = message.session;
    updateUi();
    return;
  }

  if (message.type === 'presence') {
    state.controllerId = message.controllerId;
    state.clients = message.clients || [];
    const me = state.clients.find((client) => client.id === state.id);
    if (me) state.role = me.role;
    updateUi();
    return;
  }

  if (message.type === 'context') {
    state.context = message.context || state.context;
    updateUi();
    return;
  }

  if (message.type === 'activity') {
    if (message.context) state.context = message.context;
    else if (message.item) state.context.activity = [...state.context.activity, message.item].slice(-20);
    updateUi();
    return;
  }

  if (message.type === 'role') {
    state.role = message.role;
    showToast(message.role === 'controller' ? 'You are now the controller' : 'You are now a viewer');
    updateUi();
    resizeTerminal();
    return;
  }

  if (message.type === 'error') {
    showToast(message.message || 'Unknown error');
    term.writeln(`\r\n\x1b[31m[remote] ${message.message || 'Unknown error'}\x1b[0m`);
  }
}

function scheduleReconnect() {
  window.clearTimeout(state.reconnectTimer);
  const wait = state.reconnectMs;
  setPhase('reconnecting', `Disconnected. Reconnecting to ${wsUrl()} in ${Math.round(wait / 1000)}s`);
  state.reconnectTimer = window.setTimeout(connect, wait);
  state.reconnectMs = Math.min(Math.round(state.reconnectMs * 1.6), 8000);
}

async function probeState() {
  setPhase('checking', `Checking HTTP auth at ${pageUrl('/api/state')}`);
  const response = await fetch('/api/state', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' }
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;

  if (response.status === 401 || response.status === 403) {
    const reason = body?.reason || `HTTP ${response.status}`;
    const suffix = body?.loginRequired ? ' Open /login or reload this page to sign in again.' : '';
    throw new Error(`Auth check failed: ${reason}.${suffix}`);
  }

  if (!response.ok || !body?.ok) {
    throw new Error(`State check failed: HTTP ${response.status}`);
  }

  state.config = body.config || state.config;
  state.session = body.session || state.session;
  state.controllerId = body.controllerId || state.controllerId;
  state.clients = body.clients || state.clients;
  state.context = body.context || state.context;
  return body;
}

async function connect() {
  window.clearTimeout(state.reconnectTimer);
  if (state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.ws.readyState)) {
    try { state.ws.close(); } catch {}
  }

  state.connected = false;
  state.socketOpen = false;
  state.role = state.role || 'viewer';
  setPhase('connecting', `Preparing to connect to ${wsUrl()}`);

  try {
    await probeState();
    updateUi();
  } catch (error) {
    state.connected = false;
    state.socketOpen = false;
    setPhase('error', error.message || `Cannot reach ${pageUrl('/api/state')}`);
    showToast(error.message || 'Connection check failed');
    if (!String(error.message || '').includes('Auth check failed')) {
      scheduleReconnect();
    }
    return;
  }

  const ws = new WebSocket(wsUrl());
  state.ws = ws;

  ws.addEventListener('open', () => {
    state.socketOpen = true;
    state.reconnectMs = 750;
    setPhase('opening', 'WebSocket opened; waiting for session metadata...');
  });

  ws.addEventListener('message', (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
      showToast('Received an invalid server message');
    }
  });

  ws.addEventListener('close', (event) => {
    state.connected = false;
    state.socketOpen = false;
    state.role = 'viewer';
    state.lastClose = { code: event.code, reason: event.reason || '', at: new Date().toISOString() };
    term.writeln(`\r\n\x1b[33m[remote] disconnected code=${event.code}; reconnecting...\x1b[0m`);
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    setPhase('error', `Connection failed. Check login, PC power, and tunnel. Target: ${wsUrl()}`);
    showToast('Connection failed; automatic retry is enabled');
  });
}

term.onData((data) => {
  sendInput(data);
});

el.sendForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = el.lineInput.value;
  if (!text) return;
  if (sendInput(`${text}\r`)) {
    addLocalActivity('input', `sent: ${text}`);
    el.lineInput.value = '';
  }
});

document.querySelectorAll('[data-macro]').forEach((button) => {
  button.addEventListener('click', () => {
    if (send({ type: 'macro', name: button.dataset.macro })) {
      addLocalActivity('macro', `sent macro: ${button.dataset.macro}`);
    }
  });
});

el.retryButton.addEventListener('click', () => {
  state.reconnectMs = 750;
  connect();
});
el.clearButton.addEventListener('click', () => term.clear());
el.takeControlButton.addEventListener('click', () => send({ type: 'takeControl' }));
el.startButton.addEventListener('click', () => send({ type: 'start' }));
el.stopButton.addEventListener('click', () => {
  if (window.confirm('Stop the current Codex session?')) send({ type: 'stop' });
});
el.restartButton.addEventListener('click', () => {
  if (window.confirm('Restarting creates a new session ID and clears the replay buffer. Continue?')) send({ type: 'restart' });
});

window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
setTimeout(resizeTerminal, 80);
updateUi();
connect();
