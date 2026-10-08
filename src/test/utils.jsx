import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { AuthProvider } from "../context/AuthContext.jsx";
import { RealtimeProvider } from "../context/RealtimeContext.jsx";
import { ThemeProvider } from "../context/ThemeContext.jsx";
import { ToastProvider } from "../context/ToastContext.jsx";

export const json = (body, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Install a fetch mock. `routes` maps "METHOD /path" (path without /api/v1 and query) to a response
 * body, a Response, or a function (url, init) => Response. Unmatched calls return 404.
 */
export function mockApi(routes) {
  const fn = vi.fn(async (input, init = {}) => {
    const url = new URL(input, "http://localhost");
    const key = `${init.method || "GET"} ${url.pathname.replace("/api/v1", "")}`;
    const handler = routes[key];
    if (handler === undefined) return json({ error: { code: "not_found", message: `No mock for ${key}` } }, 404);
    if (typeof handler === "function") return handler(url, init);
    return handler instanceof Response ? handler : json(handler);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export const ME = { id: 1, email: "demo@example.com", full_name: "Demo User", role: "user", is_active: true, currency: "USD", created_at: "2026-01-01T00:00:00Z" };

/** Routes for an already-signed-in session (refresh cookie valid). */
export const sessionRoutes = (extra = {}) => ({
  "POST /auth/refresh": { access_token: "access-1", token_type: "bearer", expires_in: 900 },
  "GET /users/me": ME,
  "GET /notifications/unread-count": { count: 0 },
  ...extra,
});

export function renderWithProviders(ui, { route = "/" } = {}) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <RealtimeProvider>
            <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
          </RealtimeProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

/** In-memory WebSocket double. setup.js installs it globally; tests drive the "server" side. */
export class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = FakeWebSocket.CONNECTING;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); });
  }

  send(data) { this.sent.push(JSON.parse(data)); }
  close(code = 1000) { this.serverClose(code); }
  serverSend(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  serverClose(code) {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  static get last() { return FakeWebSocket.instances.at(-1); }
}
