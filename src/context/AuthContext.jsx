import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | authenticated | anonymous

  const loadMe = useCallback(async () => {
    const me = await api("/users/me");
    setUser(me);
    setStatus("authenticated");
    return me;
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => { setUser(null); setStatus("anonymous"); });
    // Restore the session from the httpOnly refresh cookie, if any.
    refreshSession().then(loadMe).catch(() => setStatus("anonymous"));
  }, [loadMe]);

  const login = useCallback(async (email, password) => {
    const tokens = await api("/auth/login", { method: "POST", body: { email, password } });
    setAccessToken(tokens.access_token);
    return loadMe();
  }, [loadMe]);

  // Sign in or sign up with a Google ID token. Resolves to true when a new account was created.
  const loginWithGoogle = useCallback(async (credential) => {
    const tokens = await api("/auth/google", { method: "POST", body: { credential } });
    setAccessToken(tokens.access_token);
    await loadMe();
    return tokens.is_new_user;
  }, [loadMe]);

  const register = useCallback(async (data) => {
    await api("/auth/register", { method: "POST", body: data });
    return login(data.email, data.password);
  }, [login]);

  const logout = useCallback(async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* already logged out */ }
    setAccessToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(() => ({ user, status, login, loginWithGoogle, register, logout, setUser, isAdmin: user?.role === "admin" }),
    [user, status, login, loginWithGoogle, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
