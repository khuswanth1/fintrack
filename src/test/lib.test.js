import { beforeEach, describe, expect, test } from "vitest";
import { api, ApiError, getAccessToken, setAccessToken } from "../lib/api.js";
import { money, pct, shortDate, monthLabel } from "../lib/format.js";
import { validateTransaction } from "../components/TransactionForm.jsx";
import { json, mockApi } from "./utils.jsx";

describe("format helpers", () => {
  test("money formats currency and tolerates strings and nulls", () => {
    expect(money("1234.5", "USD")).toMatch(/1,234\.50/);
    expect(money(null, "USD")).toMatch(/0\.00/);
    expect(money("abc", "USD")).toMatch(/0\.00/);
  });
  test("pct handles missing values", () => {
    expect(pct(12.345)).toBe("12.3%");
    expect(pct(null)).toBe("—");
  });
  test("dates are parsed as local calendar dates (no timezone shift)", () => {
    expect(shortDate("2026-01-01")).toMatch(/2026/);
    expect(shortDate("2026-01-01")).toMatch(/Jan/);
    expect(monthLabel("2026-03")).toMatch(/Mar/);
  });
});

describe("transaction validation", () => {
  const base = { amount: "10.50", date: "2026-01-01", description: "" };
  test("accepts a valid transaction", () => expect(validateTransaction(base)).toEqual({}));
  test.each(["", "0", "-5", "1.234", "abc"])("rejects amount %s", (amount) => {
    expect(validateTransaction({ ...base, amount }).amount).toBeTruthy();
  });
  test("requires a date", () => expect(validateTransaction({ ...base, date: "" }).date).toBeTruthy());
});

describe("api client", () => {
  beforeEach(() => setAccessToken(null));

  test("sends bearer token and parses JSON", async () => {
    setAccessToken("tok");
    const fetchMock = mockApi({ "GET /users/me": { id: 1 } });
    await expect(api("/users/me")).resolves.toEqual({ id: 1 });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  test("builds query strings and skips empty params", async () => {
    const fetchMock = mockApi({ "GET /transactions": { items: [] } });
    await api("/transactions", { params: { q: "coffee", kind: "", page: 2, category_id: null } });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/transactions?q=coffee&page=2");
  });

  test("raises ApiError with the server's error envelope", async () => {
    mockApi({ "POST /transactions": json({ error: { code: "validation_error", message: "Request validation failed",
      details: [{ field: "amount", message: "must be > 0" }] } }, 422) });
    const err = await api("/transactions", { method: "POST", body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe("validation_error");
    expect(err.details[0].field).toBe("amount");
  });

  test("refreshes an expired access token once and retries", async () => {
    setAccessToken("expired");
    let calls = 0;
    const fetchMock = mockApi({
      "GET /dashboard/summary": (_, init) => (++calls === 1 || init.headers.Authorization !== "Bearer fresh"
        ? json({ error: { code: "token_expired", message: "Token expired" } }, 401) : json({ ok: true })),
      "POST /auth/refresh": { access_token: "fresh" },
    });
    await expect(api("/dashboard/summary")).resolves.toEqual({ ok: true });
    expect(getAccessToken()).toBe("fresh");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("gives up when the refresh also fails", async () => {
    mockApi({
      "GET /goals": json({ error: { code: "unauthorized", message: "Not authenticated" } }, 401),
      "POST /auth/refresh": json({ error: { code: "unauthorized", message: "No refresh token" } }, 401),
    });
    await expect(api("/goals")).rejects.toMatchObject({ status: 401 });
  });
});
