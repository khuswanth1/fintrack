// Thin fetch wrapper: JSON in/out, the API's error envelope, and transparent access-token refresh.
// The access token lives only in memory; the refresh token is an httpOnly cookie the browser sends
// to /api/v1/auth/* automatically, so neither token is exposed to localStorage.
const BASE = "/api/v1";

let accessToken = null;
let refreshInFlight = null;
let onSessionExpired = () => {};

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn; };

async function parseError(res) {
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error */ }
  const err = body?.error;
  return new ApiError(res.status, err?.code || "http_error", err?.message || `Request failed (${res.status})`, err?.details);
}

export function refreshSession() {
  // Concurrent 401s share one refresh request; refresh tokens are single-use.
  refreshInFlight ??= fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) throw await parseError(res);
      const data = await res.json();
      accessToken = data.access_token;
      return data;
    })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function buildUrl(path, params) {
  const url = `${BASE}${path}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.append(k, v);
  });
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

export async function api(path, { method = "GET", body, params, raw = false, retry = true, signal } = {}) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, params), {
    method, headers, signal, credentials: "same-origin",
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    try {
      await refreshSession();
    } catch {
      accessToken = null;
      onSessionExpired();
      throw await parseError(res);
    }
    return api(path, { method, body, params, raw, retry: false, signal });
  }
  if (!res.ok) throw await parseError(res);
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

export async function downloadFile(path, params, fallbackName) {
  const res = await api(path, { params, raw: true });
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: match?.[1] || fallbackName });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
