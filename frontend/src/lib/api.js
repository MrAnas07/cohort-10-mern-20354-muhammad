// Central API client (architecture 6.2): one place for the base URL, cookie
// credentials, the CSRF header every mutating request needs (6.10) and the
// { success, data | error } envelope. Errors are normalised into ApiError so
// pages can show a message plus field-level details without re-parsing.

const DEFAULT_BASE_URL = '/api/v1';
const CSRF_HEADER = 'X-Requested-With';
const CSRF_VALUE = 'notes-app';

// A 401 from these paths means "bad credentials", not "expired session" -
// a refresh cannot help, so skip straight to the error.
const REFRESH_EXEMPT = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

// main.jsx injects the Vite env value before the first render; Jest never
// loads main.jsx, so tests fall back to the default that matches
// frontend/.env.example.
function resolveBaseUrl() {
  const injected = globalThis.__NOTES_API_BASE_URL__;
  if (typeof injected === 'string' && injected.length > 0) {
    return injected.replace(/\/+$/, '');
  }
  return DEFAULT_BASE_URL;
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', details = [] } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Field-level messages from a 400 VALIDATION_ERROR, keyed by field name so
// forms can attach them to the right input.
export function fieldErrorsFrom(error) {
  const map = {};
  if (error instanceof ApiError) {
    for (const detail of error.details) {
      if (detail.field && map[detail.field] === undefined) {
        map[detail.field] = detail.message;
      }
    }
  }
  return map;
}

let unauthorizedHandler = null;

// AuthContext registers here so any 401 clears the session exactly once,
// wherever in the app it originates; the route guards do the redirect.
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

function notifyUnauthorized(error) {
  if (typeof unauthorizedHandler === 'function') {
    unauthorizedHandler(error);
  }
}

let refreshInFlight = null;

// Architecture 7.2: one silent refresh, then the original request is retried
// once. The shared promise collapses simultaneous 401s into a single refresh
// call; a rejected refresh clears the session instead of looping.
function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = request('/auth/refresh', { method: 'POST', allowRefresh: false })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request(path, { method = 'GET', body, allowRefresh = true } = {}) {
  const isMutating = method !== 'GET' && method !== 'HEAD';
  const headers = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (isMutating) {
    headers[CSRF_HEADER] = CSRF_VALUE;
  }

  const response = await fetch(`${resolveBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (
    response.status === 401 &&
    allowRefresh &&
    !REFRESH_EXEMPT.some((prefix) => path.startsWith(prefix))
  ) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request(path, { method, body, allowRefresh: false });
    }
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok || (payload && payload.success === false)) {
    const envelope = (payload && payload.error) || {};
    const error = new ApiError(
      envelope.message || `Request failed with status ${response.status}`,
      {
        status: response.status,
        code: envelope.code || '',
        details: Array.isArray(envelope.details) ? envelope.details : [],
      },
    );
    if (response.status === 401) {
      notifyUnauthorized(error);
    }
    throw error;
  }

  return payload ? payload.data : null;
}

const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
};

export default api;
