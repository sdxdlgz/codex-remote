import { cwd as processCwd } from 'node:process';

export function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

export function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveConfig(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  const port = parsePositiveInt(env.PORT, 8787);
  const command = env.CODEX_REMOTE_COMMAND || 'codex';
  const cwd = env.CODEX_REMOTE_CWD || processCwd();

  return {
    host,
    port,
    publicUrl: env.PUBLIC_URL || '',
    command,
    cwd,
    autoStart: parseBool(env.CODEX_REMOTE_AUTO_START, true),
    historyBytes: parsePositiveInt(env.REMOTE_HISTORY_BYTES, 1024 * 1024),
    maxInputBytes: parsePositiveInt(env.MAX_INPUT_BYTES, 8 * 1024),
    allowControlTakeover: parseBool(env.ALLOW_CONTROL_TAKEOVER, true),
    appAuthToken: env.REMOTE_AUTH_TOKEN || env.CODEX_REMOTE_AUTH_TOKEN || '',
    authCookieName: env.AUTH_COOKIE_NAME || 'codex_remote_token',
    requireCloudflareAccess: parseBool(env.REQUIRE_CF_ACCESS, false),
    allowedEmails: parseCsv(env.ACCESS_ALLOWED_EMAILS).map((email) => email.toLowerCase()),
    allowedOrigins: parseCsv(env.ALLOWED_ORIGINS),
    trustProxy: parseBool(env.TRUST_PROXY, true)
  };
}
