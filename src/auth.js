function firstHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function getCloudflareAccessEmail(req) {
  return firstHeader(req, 'cf-access-authenticated-user-email') || '';
}

export function getCloudflareAccessJwt(req) {
  return firstHeader(req, 'cf-access-jwt-assertion') || '';
}

export function isOriginAllowed(req, config) {
  if (config.allowedOrigins.length === 0) return true;
  const origin = firstHeader(req, 'origin');
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}

export function authorizeRequest(req, config) {
  if (!isOriginAllowed(req, config)) {
    return { ok: false, status: 403, reason: 'Origin is not allowed.' };
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
      res.status(result.status).type('text/plain').send(result.reason);
      return;
    }
    req.remoteUser = result.email;
    next();
  };
}
