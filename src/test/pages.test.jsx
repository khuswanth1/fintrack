import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";
import { AppRoutes } from "../App.jsx";
import { setAccessToken } from "../lib/api.js";
import { json, mockApi, renderWithProviders, sessionRoutes } from "./utils.jsx";

const anonymous = { "POST /auth/refresh": json({ error: { code: "unauthorized", message: "No refresh token" } }, 401) };

const tx = (id, extra = {}) => ({
  id, kind: "expense", amount: "42.50", date: "2026-03-05", description: `Groceries ${id}`, notes: "",
  category: { id: 4, name: "Groceries", color: "#f59e0b" }, recurring_id: null, created_at: "2026-03-05T10:00:00Z", ...extra,
});
const page = (items, extra = {}) => ({ items, total: items.length, page: 1, size: 20, pages: 1, ...extra });

beforeEach(() => setAccessToken(null));

describe("authentication flow", () => {
  test("unauthenticated users are redirected to the login page", async () => {
    mockApi(anonymous);
    renderWithProviders(<AppRoutes />, { route: "/transactions" });
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  test("login shows server errors", async () => {
    mockApi({ ...anonymous, "POST /auth/login": json({ error: { code: "invalid_credentials", message: "Invalid email or password" } }, 401) });
    renderWithProviders(<AppRoutes />, { route: "/login" });
    await userEvent.type(await screen.findByLabelText("Email"), "a@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrongpass1");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });

  test("login requires both fields before calling the API", async () => {
    const fetchMock = mockApi(anonymous);
    renderWithProviders(<AppRoutes />, { route: "/login" });
    await userEvent.click(await screen.findByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/auth/login"))).toBe(false);
  });

  test("successful login lands on the dashboard", async () => {
    let loggedIn = false;
    mockApi({
      "POST /auth/refresh": () => json({ error: { code: "unauthorized", message: "x" } }, 401),
      "POST /auth/login": () => { loggedIn = true; return json({ access_token: "a", token_type: "bearer", expires_in: 900 }); },
      "GET /users/me": () => json(loggedIn ? { id: 1, email: "a@b.com", full_name: "A", role: "user", currency: "USD" } : {}, loggedIn ? 200 : 401),
      "GET /notifications/unread-count": { count: 3 },
      "GET /dashboard/summary": json({ error: { code: "x", message: "later" } }, 500),
    });
    renderWithProviders(<AppRoutes />, { route: "/login" });
    await userEvent.type(await screen.findByLabelText("Email"), "a@b.com");
    await userEvent.type(screen.getByLabelText("Password"), "password1");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("heading", { name: "Dashboard" }, { timeout: 8000 })).toBeInTheDocument();
    expect(await screen.findByLabelText(/notifications \(3 unread\)/i)).toBeInTheDocument();
  });

  test("registration validates password strength on the client", async () => {
    mockApi(anonymous);
    renderWithProviders(<AppRoutes />, { route: "/register" });
    await userEvent.type(await screen.findByLabelText("Password"), "short");
    expect(screen.getAllByText(/at least 8 characters/i).length).toBeGreaterThan(0);
  });
});

describe("transactions page", () => {
  test("lists transactions and shows the empty state for no matches", async () => {
    const fetchMock = mockApi(sessionRoutes({
      "GET /categories": [{ id: 4, name: "Groceries", kind: "expense", color: "#f59e0b" }],
      "GET /transactions": (url) => json(url.searchParams.get("q") === "zzz" ? page([]) : page([tx(1), tx(2, { kind: "income", amount: "1000.00", description: "Salary" })])),
    }));
    renderWithProviders(<AppRoutes />, { route: "/transactions" });
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Groceries 1")).toBeInTheDocument();
    expect(within(table).getByText(/\+\$1,000\.00/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search transactions"), "zzz");
    expect(await screen.findByText("No matching transactions")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("q=zzz"))).toBe(true));
  });

  test("clicking a column header changes the sort order", async () => {
    const fetchMock = mockApi(sessionRoutes({ "GET /categories": [], "GET /transactions": page([tx(1)]) }));
    renderWithProviders(<AppRoutes />, { route: "/transactions" });
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /amount/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("sort=amount&order=desc"))).toBe(true));
  });

  test("shows an error state with retry when loading fails", async () => {
    mockApi(sessionRoutes({ "GET /categories": [], "GET /transactions": json({ error: { code: "internal_error", message: "Database unavailable" } }, 500) }));
    renderWithProviders(<AppRoutes />, { route: "/transactions" });
    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  test("the add form validates before submitting", async () => {
    const fetchMock = mockApi(sessionRoutes({ "GET /categories": [], "GET /transactions": page([]) }));
    renderWithProviders(<AppRoutes />, { route: "/transactions" });
    await userEvent.click(await screen.findByRole("button", { name: /^add$/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /save/i }));
    expect(within(dialog).getByText(/positive amount/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u, init]) => init?.method === "POST" && String(u).endsWith("/transactions"))).toBe(false);
  });
});

describe("role-based navigation", () => {
  test("non-admins do not see or reach the admin area", async () => {
    mockApi(sessionRoutes({ "GET /dashboard/summary": json({ error: { code: "x", message: "skip" } }, 500) }));
    renderWithProviders(<AppRoutes />, { route: "/admin" });
    expect(await screen.findByRole("heading", { name: "Dashboard" }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryAllByText("Administration")).toHaveLength(0);
  });
});
