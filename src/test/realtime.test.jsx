import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AppRoutes } from "../App.jsx";
import { resetAuthProvidersCache } from "../components/GoogleSignIn.jsx";
import { setAccessToken } from "../lib/api.js";
import { realtime } from "../lib/realtime.js";
import { FakeWebSocket, json, ME, mockApi, renderWithProviders, sessionRoutes } from "./utils.jsx";

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => setAccessToken(null));

describe("realtime client", () => {
  afterEach(() => vi.useRealTimers());

  test("authenticates in the first frame, then dispatches events", async () => {
    mockApi(sessionRoutes());
    setAccessToken("tok-1");
    const seen = [];
    const unsubscribe = realtime.subscribe("data.changed", (m) => seen.push(m));
    const statuses = [];
    realtime.onStatus((s) => statuses.push(s));

    realtime.start();
    await flush();
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe(`ws://${window.location.host}/api/v1/ws`);
    expect(ws.url).not.toContain("tok-1"); // the token never goes in the URL
    expect(ws.sent[0]).toEqual({ type: "auth", token: "tok-1" });

    ws.serverSend({ type: "ready", data: { user_id: 1 } });
    expect(realtime.status).toBe("open");
    ws.serverSend({ type: "data.changed", data: { source: "transactions" } });
    expect(seen).toHaveLength(1);

    unsubscribe();
    ws.serverSend({ type: "data.changed", data: {} });
    expect(seen).toHaveLength(1);
    expect(statuses).toContain("connecting");
  });

  test("on 4001 it refreshes the token and reconnects with the new one", async () => {
    const fetchMock = mockApi(sessionRoutes({ "POST /auth/refresh": { access_token: "tok-2", token_type: "bearer", expires_in: 900 } }));
    setAccessToken("tok-1");
    realtime.start();
    await flush();
    FakeWebSocket.last.serverSend({ type: "ready", data: { user_id: 1 } });

    vi.useFakeTimers();
    FakeWebSocket.last.serverClose(4001);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/auth/refresh"))).toBe(true));
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.last.sent[0]).toEqual({ type: "auth", token: "tok-2" });
  });

  test("4003 (account disabled) stops reconnecting", async () => {
    mockApi(sessionRoutes());
    setAccessToken("tok-1");
    realtime.start();
    await flush();
    FakeWebSocket.last.serverClose(4003);
    expect(realtime.status).toBe("closed");
    await new Promise((r) => setTimeout(r, 50));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test("stop() closes the socket and does not reconnect", async () => {
    mockApi(sessionRoutes());
    setAccessToken("tok-1");
    realtime.start();
    await flush();
    const ws = FakeWebSocket.last;
    realtime.stop();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(realtime.status).toBe("closed");
  });
});

describe("live updates in the app", () => {
  test("a pushed notification bumps the bell badge and shows a toast", async () => {
    mockApi(sessionRoutes({ "GET /dashboard/summary": json({ error: { code: "x", message: "later" } }, 500) }));
    renderWithProviders(<AppRoutes />, { route: "/" });
    expect(await screen.findByLabelText(/notifications \(0 unread\)/i)).toBeInTheDocument();
    await waitFor(() => expect(FakeWebSocket.last?.sent[0]?.type).toBe("auth"));
    act(() => FakeWebSocket.last.serverSend({ type: "ready", data: { user_id: 1 } }));
    expect(await screen.findByText("Live")).toBeInTheDocument();

    act(() => FakeWebSocket.last.serverSend({
      id: "evt_1", type: "notification.created",
      data: { id: 9, type: "budget_alert", title: "Dining budget exceeded", message: "…", is_read: false },
    }));
    expect(await screen.findByLabelText(/notifications \(1 unread\)/i)).toBeInTheDocument();
    expect(screen.getByText("Dining budget exceeded")).toBeInTheDocument();
  });
});

describe("Google sign-in", () => {
  beforeEach(() => resetAuthProvidersCache());
  afterEach(() => { delete window.google; });

  test("hidden when the server has no Google client id", async () => {
    mockApi({ "POST /auth/refresh": json({ error: { code: "unauthorized", message: "x" } }, 401),
      "GET /auth/providers": { password: true, google: { enabled: false, client_id: null } } });
    renderWithProviders(<AppRoutes />, { route: "/login" });
    await screen.findByRole("button", { name: /sign in/i });
    await flush();
    expect(screen.queryByTestId("google-signin")).not.toBeInTheDocument();
  });

  test("a Google credential signs up a new user and lands on the dashboard", async () => {
    let signedIn = false;
    const id = { initialize: vi.fn(), renderButton: vi.fn() };
    window.google = { accounts: { id } };
    const fetchMock = mockApi({
      "POST /auth/refresh": () => json({ error: { code: "unauthorized", message: "x" } }, 401),
      "GET /auth/providers": { password: true, google: { enabled: true, client_id: "cid.apps.googleusercontent.com" } },
      "POST /auth/google": () => { signedIn = true; return json({ access_token: "g", token_type: "bearer", expires_in: 900, is_new_user: true }); },
      "GET /users/me": () => json(signedIn ? { ...ME, has_password: false, google_linked: true } : {}, signedIn ? 200 : 401),
      "GET /notifications/unread-count": { count: 0 },
      "GET /dashboard/summary": json({ error: { code: "x", message: "later" } }, 500),
    });
    renderWithProviders(<AppRoutes />, { route: "/register" });
    expect(await screen.findByTestId("google-signin")).toBeInTheDocument();
    await waitFor(() => expect(id.renderButton).toHaveBeenCalled());
    const config = id.initialize.mock.calls[0][0];
    expect(config.client_id).toBe("cid.apps.googleusercontent.com");
    expect(id.renderButton.mock.calls[0][1].text).toBe("signup_with");

    await act(async () => config.callback({ credential: "google-id-token" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText(/welcome to fintrack/i)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/auth/google"));
    expect(JSON.parse(call[1].body)).toEqual({ credential: "google-id-token" });
  });
});

describe("Webhooks page", () => {
  const endpoint = { id: 1, url: "https://hooks.example.com/x", description: "Zapier", events: ["*"], is_active: true,
    consecutive_failures: 0, disabled_reason: null, secret_hint: "whsec_abcd…wxyz", created_at: "2026-10-01T00:00:00Z" };
  const events = [{ type: "transaction.created", description: "A transaction was added" },
    { type: "budget.alert", description: "A budget crossed its alert threshold" }];

  test("lists endpoints and shows the secret once after creating one", async () => {
    let created = false;
    const fetchMock = mockApi(sessionRoutes({
      "GET /webhooks": () => json(created ? [endpoint, { ...endpoint, id: 2, url: "https://new.example.com/hook", events: ["budget.alert"] }] : [endpoint]),
      "GET /webhooks/events": events,
      "POST /webhooks": () => { created = true; return json({ ...endpoint, id: 2, secret: "whsec_supersecret" }, 201); },
    }));
    renderWithProviders(<AppRoutes />, { route: "/webhooks" });
    expect(await screen.findByText("https://hooks.example.com/x")).toBeInTheDocument();
    expect(screen.getByText("all events")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /add endpoint/i }));
    const dialog = await screen.findByRole("dialog", { name: /add webhook endpoint/i });
    await userEvent.type(screen.getByLabelText(/endpoint url/i), "https://new.example.com/hook");
    await userEvent.click(screen.getByLabelText(/all events/i)); // untick "all"
    await userEvent.click(screen.getByRole("checkbox", { name: /budget\.alert/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /^add endpoint$/i }));

    expect(await screen.findByText("whsec_supersecret")).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([u, init]) => String(u).endsWith("/webhooks") && init?.method === "POST");
    expect(JSON.parse(post[1].body)).toMatchObject({ url: "https://new.example.com/hook", events: ["budget.alert"] });
    expect(dialog).not.toBeInTheDocument();
  });

  test("send test shows the delivery outcome", async () => {
    mockApi(sessionRoutes({
      "GET /webhooks": [endpoint],
      "GET /webhooks/events": events,
      "POST /webhooks/1/test": json({ id: 5, status: "failed", error: "Endpoint responded with HTTP 500" }, 202),
      "GET /webhooks/1/deliveries": { items: [], total: 0, page: 1, size: 10, pages: 0 },
    }));
    renderWithProviders(<AppRoutes />, { route: "/webhooks" });
    await userEvent.click(await screen.findByRole("button", { name: /send test/i }));
    expect(await screen.findByText(/test failed: endpoint responded with http 500/i)).toBeInTheDocument();
  });
});
