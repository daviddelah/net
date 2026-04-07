import { sendJson, sendError } from './middleware.js';

/**
 * Simple URL router. Matches method + path pattern.
 * Supports :param placeholders.
 */
export class Router {
  constructor() {
    this.routes = [];
  }

  get(path, handler) { this.routes.push({ method: 'GET', path, handler }); }
  post(path, handler) { this.routes.push({ method: 'POST', path, handler }); }
  put(path, handler) { this.routes.push({ method: 'PUT', path, handler }); }
  delete(path, handler) { this.routes.push({ method: 'DELETE', path, handler }); }

  /**
   * Match a request and return { handler, params } or null.
   */
  match(method, url) {
    const pathname = url.split('?')[0];

    for (const route of this.routes) {
      if (route.method !== method) continue;

      const params = matchPath(route.path, pathname);
      if (params !== null) {
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  /**
   * Handle a request. Returns true if matched.
   */
  async handle(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      sendJson(res, {}, 204);
      return true;
    }

    const result = this.match(req.method, req.url);
    if (!result) return false;

    req.params = result.params;
    req.query = parseQuery(req.url);

    try {
      await result.handler(req, res);
    } catch (err) {
      console.error(`Route error: ${err.message}`);
      sendError(res, err.message, 500);
    }
    return true;
  }
}

function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = {};
  const search = url.slice(idx + 1);
  for (const pair of search.split('&')) {
    const [key, val] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(val || '');
  }
  return params;
}
