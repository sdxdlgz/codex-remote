const terminalEl = document.getElementById('terminal');
const subtitleEl = document.getElementById('subtitle');
const connectionBadge = document.getElementById('connectionBadge');
const roleBadge = document.getElementById('roleBadge');
const sendForm = document.getElementById('sendForm');
const lineInput = document.getElementById('lineInput');
const sendButton = document.getElementById('sendButton');
const takeControlButton = document.getElementById('takeControlButton');
const startButton = document.getElementById('startButton');
const restartButton = document.getElementById('restartButton');
const stopButton = document.getElementById('stopButton');
const statusPanel = document.getElementById('statusPanel');
const toastEl = document.getElementById('toast');

const term = new Terminal({
  cursorBlink: true,
  convertEol: false,
  fontFamily: 'Consolas, "Cascadia Mono", "SFMono-Regular", monospace',
  fontSize: 13,
  lineHeight: 1.1,
  scrollback: 5000,
  theme: {
    background: '#070b14',
    foreground: '#eef4ff',
    cursor: '#74c0fc',
    selectionBackground: '#335c81'
  }
});
term.open(terminalEl);
term.writeln('\x1b[36mCodex Remote\x1b[0m connecting...');

const state = {
  ws: null,
  connected: false,
  role: 'viewer',
  id: '',
  config: null,
  session: null,
  clients: [],
  reconnectMs: 750,
  toastTimer: null,
  lastCols: 100,
  lastRows: 30
};

function wsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function badge(el, text, mode = '') {
  el.textContent = text;
  el.className = `badge ${mode}`.trim();
}

function updateControls() {
  const isController = state.connected && state.role === 'controller';
  sendButton.disabled = !isController;
  lineInput.disabled = !isController;
  document.querySelectorAll('[data-macro]').forEach((button) => {
    button.disabled = !isController;
  });
  startButton.disabled = !isController || state.session?.status === 'running';
  stopButton.disabled = !isController || state.session?.status !== 'running';
  restartButton.disabled = !isController;
  takeControlButton.disabled = !state.connected || isController;
}

function updateStatusPanel() {
  const payload = {
    connected: state.connected,
    role: state.role,
    id: state.id,
    session: state.session,
    clients: state.clients.map((client) => ({
      role: client.role,
      email: client.email,
      connectedAt: client.connectedAt
    })),
    config: state.config
      ? {
          publicUrl: state.config.publicUrl,
          command: state.config.command,
          cwd: state.config.cwd,
          requireCloudflareAccess: state.config.requireCloudflareAccess
        }
      : null
  };
  statusPanel.textContent = JSON.stringify(payload, null, 2);

  const sessionStatus = state.session?.status || 'unknown';
  const who = state.clients.find((client) => client.id === state.id)?.email || '';
  subtitleEl.textContent = `${sessionStatus} · ${who || 'unknown user'}`;
}

function updateUi() {
  if (state.connected) badge(connectionBadge, 'online', 'ok');
  else badge(connectionBadge, 'offline', 'danger');

  badge(roleBadge, state.role, state.role === 'controller' ? 'ok' : 'warn');
  updateControls();
  updateStatusPanel();
}

function send(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    showToast('WebSocket 未连接');
    return false;
  }
  state.ws.send(JSON.stringify(payload));
  return true;
}

function sendInput(data) {
  if (state.role !== 'controller') {
    showToast('当前是只读模式，请先接管控制');
    return false;
  }
  return send({ type: 'input', data });
}

function calculateTerminalSize() {
  const rect = terminalEl.getBoundingClientRect();
  const cols = Math.max(20, Math.min(300, Math.floor((rect.width - 16) / 8.1)));
  const rows = Math.max(5, Math.min(120, Math.floor((rect.height - 16) / 15.5)));
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

function handleMessage(message) {
  if (message.type === 'hello') {
    state.connected = true;
    state.id = message.id;
    state.role = message.role;
    state.config = message.config;
    state.session = message.session;
    state.clients = message.clients || [];
    term.clear();
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
    state.clients = message.clients || [];
    const me = state.clients.find((client) => client.id === state.id);
    if (me) state.role = me.role;
    updateUi();
    return;
  }

  if (message.type === 'role') {
    state.role = message.role;
    showToast(message.role === 'controller' ? '你现在拥有控制权' : '你现在是只读模式');
    updateUi();
    resizeTerminal();
    return;
  }

  if (message.type === 'error') {
    showToast(message.message || 'Unknown error');
    term.writeln(`\r\n\x1b[31m[remote] ${message.message || 'Unknown error'}\x1b[0m`);
    return;
  }
}

function connect() {
  state.connected = false;
  updateUi();
  const ws = new WebSocket(wsUrl());
  state.ws = ws;

  ws.addEventListener('open', () => {
    state.connected = true;
    state.reconnectMs = 750;
    updateUi();
  });

  ws.addEventListener('message', (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
      showToast('收到无法解析的服务器消息');
    }
  });

  ws.addEventListener('close', () => {
    state.connected = false;
    state.role = 'viewer';
    updateUi();
    term.writeln('\r\n\x1b[33m[remote] disconnected, reconnecting...\x1b[0m');
    window.setTimeout(connect, state.reconnectMs);
    state.reconnectMs = Math.min(state.reconnectMs * 1.6, 8000);
  });

  ws.addEventListener('error', () => {
    showToast('连接失败，正在重试');
  });
}

term.onData((data) => {
  sendInput(data);
});

sendForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = lineInput.value;
  if (!text) return;
  if (sendInput(`${text}\r`)) lineInput.value = '';
});

document.querySelectorAll('[data-macro]').forEach((button) => {
  button.addEventListener('click', () => {
    send({ type: 'macro', name: button.dataset.macro });
  });
});

takeControlButton.addEventListener('click', () => send({ type: 'takeControl' }));
startButton.addEventListener('click', () => send({ type: 'start' }));
stopButton.addEventListener('click', () => {
  if (window.confirm('停止当前 Codex 会话？')) send({ type: 'stop' });
});
restartButton.addEventListener('click', () => {
  if (window.confirm('重启会清空页面回放并重新启动 Codex，会继续吗？')) send({ type: 'restart' });
});

window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
setTimeout(resizeTerminal, 50);
connect();
updateUi();

