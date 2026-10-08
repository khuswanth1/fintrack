import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useTheme } from "../context/ThemeContext.jsx";

// Google Identity Services: Google renders the button and hands us a signed ID token (a JWT) that the API
// verifies. The client id comes from the API, so enabling Google needs only GOOGLE_CLIENT_ID on the server.
const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisPromise = null;
let providersPromise = null;

function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) { resolve(window.google); return; }
    const script = Object.assign(document.createElement("script"), { src: GIS_SRC, async: true, defer: true });
    script.onload = () => resolve(window.google);
    script.onerror = () => { gisPromise = null; script.remove(); reject(new Error("Could not load Google sign-in")); };
    document.head.appendChild(script);
  });
  return gisPromise;
}

/** Test hook: forget the cached /auth/providers answer. */
export const resetAuthProvidersCache = () => { providersPromise = null; };

// Only concurrent callers share a request. Not caching for the page's lifetime means a long-lived tab picks up
// a changed GOOGLE_CLIENT_ID the next time a sign-in button mounts, instead of sending Google a deleted client.
export function getAuthProviders() {
  providersPromise ??= api("/auth/providers")
    .catch(() => ({ google: { enabled: false } }))
    .finally(() => { providersPromise = null; });
  return providersPromise;
}

/**
 * Renders "Sign in / Sign up with Google" when the server has Google configured, nothing otherwise.
 * `onCredential(idToken)` receives Google's ID token; `text` is "signin_with" | "signup_with" | "continue_with".
 */
export default function GoogleSignIn({ onCredential, onError, text = "signin_with", divider = true }) {
  const container = useRef(null);
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };
  const [clientId, setClientId] = useState(null);
  const { theme } = useTheme();

  useEffect(() => {
    let alive = true;
    getAuthProviders().then((p) => alive && p.google?.enabled && setClientId(p.google.client_id));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!clientId) return undefined;
    let alive = true;
    loadGis().then((google) => {
      if (!alive || !container.current) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => handlers.current.onCredential(resp.credential),
        ux_mode: "popup",
        context: text === "signup_with" ? "signup" : "signin",
        cancel_on_tap_outside: true,
      });
      google.accounts.id.renderButton(container.current, {
        type: "standard", size: "large", shape: "rectangular", logo_alignment: "center", text,
        theme: theme === "dark" ? "filled_black" : "outline",
        width: Math.min(400, container.current.clientWidth || 320),
      });
    }).catch((err) => alive && handlers.current.onError?.(err));
    return () => { alive = false; };
  }, [clientId, theme, text]);

  if (!clientId) return null;
  return (
    <>
      {divider && (
        <div className="my-5 flex items-center gap-3 text-xs text-slate-400" aria-hidden>
          <span className="h-px flex-1 bg-slate-200 dark:bg-white/5" />or<span className="h-px flex-1 bg-slate-200 dark:bg-white/5" />
        </div>
      )}
      <div ref={container} className="flex min-h-11 w-full justify-center" data-testid="google-signin" />
    </>
  );
}
