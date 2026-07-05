import { timingSafeEqual } from 'node:crypto';

function firstHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function safeEquals(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(req) {
  const header = firstHeader(req, 'cookie');
  if (!header) return {};

  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        const key = part.slice(0, index);
        const value = part.slice(index + 1);
        try {
          return [key, decodeURIComponent(value)];
        } catch {
          return [key, value];
        }
      })
  );
}

export function getCloudflareAccessEmail(req) {
  return firstHeader(req, 'cf-access-authenticated-user-email') || '';
}

export function getCloudflareAccessJwt(req) {
  return firstHeader(req, 'cf-access-jwt-assertion') || '';
}

export function getRequestToken(req, config) {
  const url = new URL(req.url || '/', 'http://localhost');
  const authorization = firstHeader(req, 'authorization') || '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : '';
  const cookies = parseCookies(req);

  return (
    bearer ||
    url.searchParams.get('token') ||
    firstHeader(req, 'x-codex-remote-token') ||
    cookies[config.authCookieName] ||
    ''
  );
}

export function isOriginAllowed(req, config) {
  if (config.allowedOrigins.length === 0) return true;
  const origin = firstHeader(req, 'origin');
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}

export function hasValidAppToken(req, config) {
  if (!config.appAuthToken) return true;
  return safeEquals(getRequestToken(req, config), config.appAuthToken);
}

export function isAppTokenValueValid(value, config) {
  if (!config.appAuthToken) return true;
  return safeEquals(value, config.appAuthToken);
}

export function authorizeRequest(req, config) {
  if (!isOriginAllowed(req, config)) {
    return { ok: false, status: 403, reason: 'Origin is not allowed.' };
  }

  if (!hasValidAppToken(req, config)) {
    return { ok: false, status: 401, reason: 'Login required.', loginRequired: true };
  }

  const email = getCloudflareAccessEmail(req).toLowerCase();
  const jwt = getCloudflareAccessJwt(req);

  if (config.requireCloudflareAccess && !email) {
    return { ok: false, status: 401, reason: 'Cloudflare Access identity header is missing.' };
  }

  if (config.requireCloudflareAccess && !jwt) {
    return { ok: false, status: 401, reason: 'Cloudflare Access JWT header is missing.' };
  }

  if (config.allowedEmails.length > 0 && (!email || !config.allowedEmails.includes(email))) {
    return { ok: false, status: 403, reason: 'This Cloudflare Access user is not allowed.' };
  }

  return { ok: true, email: email || 'local' };
}

export function httpAuthMiddleware(config) {
  return (req, res, next) => {
    const result = authorizeRequest(req, config);
    if (!result.ok) {
      if (result.loginRequired && req.method === 'GET') {
        const nextPath = encodeURIComponent(req.originalUrl || '/');
        res.redirect(302, `/login?next=${nextPath}`);
        return;
      }
      res.status(result.status).type('text/plain').send(result.reason);
      return;
    }
    req.remoteUser = result.email;
    next();
  };
}
