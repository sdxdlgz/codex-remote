import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import pty from 'node-pty';

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const EXIT_WAIT_MS = 2500;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getShellCommand(command) {
  if (process.platform === 'win32') {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', command]
    };
  }

  return {
    file: process.env.SHELL || '/bin/sh',
    args: ['-lc', command]
  };
}

export class CodexSession extends EventEmitter {
  constructor(options) {
    super();
    this.command = options.command;
    this.cwd = options.cwd;
    this.cols = options.cols || DEFAULT_COLS;
    this.rows = options.rows || DEFAULT_ROWS;
    this.ptyProcess = null;
    this.status = 'idle';
    this.startedAt = null;
    this.endedAt = null;
    this.exitCode = null;
    this.signal = null;
    this.lastError = '';
    this.sessionNumber = 0;
    this.sessionId = null;
    this.sessionLabel = '未启动';
  }

  snapshot() {
    return {
      command: this.command,
      cwd: this.cwd,
      status: this.status,
      cols: this.cols,
      rows: this.rows,
      sessionId: this.sessionId,
      sessionLabel: this.sessionLabel,
      sessionNumber: this.sessionNumber,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      exitCode: this.exitCode,
      signal: this.signal,
      lastError: this.lastError
    };
  }

  start() {
    if (this.ptyProcess) return this.snapshot();

    const shell = getShellCommand(this.command);
    this.sessionNumber += 1;
    const suffix = randomUUID().slice(0, 8);
    this.sessionId = `codex-${String(this.sessionNumber).padStart(4, '0')}-${suffix}`;
    this.sessionLabel = `#${String(this.sessionNumber).padStart(4, '0')} · ${suffix}`;
    this.status = 'starting';
    this.startedAt = new Date().toISOString();
    this.endedAt = null;
    this.exitCode = null;
    this.signal = null;
    this.lastError = '';
    this.emitStatus();

    try {
      const child = pty.spawn(shell.file, shell.args, {
        name: 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
        cwd: this.cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      });

      this.ptyProcess = child;

      child.onData((data) => {
        this.emit('output', data);
      });

      child.onExit(({ exitCode, signal }) => {
        this.exitCode = exitCode;
        this.signal = signal;
        this.endedAt = new Date().toISOString();
        this.status = 'exited';
        this.ptyProcess = null;
        this.emitStatus();
        this.emit('exit', { exitCode, signal });
      });

      this.status = 'running';
      this.emitStatus();
    } catch (error) {
      this.status = 'error';
      this.endedAt = new Date().toISOString();
      this.lastError = error instanceof Error ? error.message : String(error);
      this.ptyProcess = null;
      this.emitStatus();
    }

    return this.snapshot();
  }

  write(data) {
    if (!this.ptyProcess || this.status !== 'running') {
      this.emit('sessionError', 'Codex session is not running.');
      return false;
    }
    this.ptyProcess.write(data);
    return true;
  }

  resize(cols, rows) {
    const nextCols = Number.parseInt(cols, 10);
    const nextRows = Number.parseInt(rows, 10);
    if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) return;
    if (nextCols < 20 || nextRows < 5 || nextCols > 300 || nextRows > 120) return;

    this.cols = nextCols;
    this.rows = nextRows;
    if (this.ptyProcess) {
      this.ptyProcess.resize(this.cols, this.rows);
    }
    this.emitStatus();
  }

  async stop() {
    if (!this.ptyProcess) return;
    const current = this.ptyProcess;
    this.status = 'stopping';
    this.emitStatus();
    const exitPromise = once(this, 'exit').catch(() => undefined);
    current.kill();
    await Promise.race([
      exitPromise,
      delay(EXIT_WAIT_MS)
    ]);
  }

  async restart() {
    await this.stop();
    this.start();
  }

  emitStatus() {
    this.emit('status', this.snapshot());
  }
}


