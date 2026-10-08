import { createContext, useContext, useEffect, useRef, useState } from "react";
import { realtime } from "../lib/realtime.js";
import { useAuth } from "./AuthContext.jsx";

const RealtimeContext = createContext("idle");

/** Holds the live-updates socket open while signed in and exposes its connection status. */
export function RealtimeProvider({ children }) {
  const { status: authStatus } = useAuth();
  const [status, setStatus] = useState(realtime.status);

  useEffect(() => realtime.onStatus(setStatus), []);
  useEffect(() => {
    if (authStatus !== "authenticated") return undefined;
    realtime.start();
    return () => realtime.stop();
  }, [authStatus]);

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}

export const useRealtimeStatus = () => useContext(RealtimeContext);

/** Run `handler(message)` for every server event of `type` ("*" for all) while the component is mounted. */
export function useRealtimeEvent(type, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => realtime.subscribe(type, (msg) => ref.current(msg)), [type]);
}
