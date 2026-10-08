import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { realtime } from "../lib/realtime.js";
import { FakeWebSocket } from "./utils.jsx";

afterEach(() => {
  cleanup();
  realtime.stop();
  FakeWebSocket.instances = [];
  vi.restoreAllMocks();
});

// jsdom lacks these browser APIs used by charts and theme detection.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.WebSocket = FakeWebSocket; // never open real sockets from tests
