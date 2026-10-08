import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowLeftRight, Bell, ChevronDown, FileText, Goal, Home, LayoutGrid, LogOut, Moon, PiggyBank, Plus, Repeat,
  Settings, Shield, Sparkles, Sun, Tags, Webhook, X } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useRealtimeEvent, useRealtimeStatus } from "../context/RealtimeContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { api } from "../lib/api.js";
import { realtime } from "../lib/realtime.js";
import { cx } from "./ui.jsx";
import AssistantChat from "./AssistantChat.jsx";
import TransactionForm from "./TransactionForm.jsx";

// Primary destinations live in the header (desktop) and the bottom tab bar (mobile); the rest sit under "More".
const PRIMARY = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/budgets", label: "Budgets", icon: PiggyBank },
  { to: "/goals", label: "Goals", icon: Goal, tint: "#fc8019" },
  { to: "/insights", label: "AI Insights", icon: Sparkles, tint: "#1ba672" },
];
const SECONDARY = [
  { to: "/recurring", label: "Recurring", icon: Repeat, tint: "#8b5cf6" },
  { to: "/reports", label: "Reports", icon: FileText, tint: "#0ea5e9" },
  { to: "/categories", label: "Categories", icon: Tags, tint: "#ec4899" },
  { to: "/webhooks", label: "Webhooks", icon: Webhook, tint: "#14b8a6" },
];
const ADMIN = { to: "/admin", label: "Administration", icon: Shield, tint: "#ef4444" };
const SETTINGS = { to: "/settings", label: "Settings", icon: Settings, tint: "#64748b" };

const LIVE = {
  open: { dot: "bg-fresh-500", label: "Live updates on" },
  connecting: { dot: "bg-amber-400 animate-pulse", label: "Connecting to live updates…" },
  reconnecting: { dot: "bg-amber-400 animate-pulse", label: "Reconnecting to live updates…" },
};

function LiveIndicator() {
  const status = useRealtimeStatus();
  const info = LIVE[status] || { dot: "bg-slate-300 dark:bg-slate-600", label: "Live updates off" };
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:bg-white/5" title={info.label} role="status">
      <span className={cx("size-2 rounded-full", info.dot)} aria-hidden />
      <span className="sr-only sm:not-sr-only">{status === "open" ? "Live" : "Offline"}</span>
      <span className="sr-only">{info.label}</span>
    </span>
  );
}

const ICON_BTN = "grid size-10 place-items-center rounded-full text-ink-soft transition hover:bg-slate-100 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-white/5";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} className={ICON_BTN}>
      {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

export function Logo({ compact = false }) {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="FinTrack home">
      <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-cta">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 16l5-5 4 3 7-8" />
        </svg>
      </span>
      {!compact && <span className="text-xl font-extrabold tracking-tight text-ink dark:text-white">Fin<span className="text-brand-500">Track</span></span>}
    </Link>
  );
}

/** Closes a popover on outside click and Escape. */
function useDismiss(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);
  return ref;
}

function TopNavLink({ to, label, icon: Icon, end }) {
  return (
    <NavLink to={to} end={end} title={label}
      className={({ isActive }) => cx("group relative flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition",
        isActive ? "text-brand-600 dark:text-brand-400" : "text-ink-soft hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400")}>
      {({ isActive }) => <>
        <Icon className="size-[18px] shrink-0" aria-hidden />
        <span className="hidden xl:inline">{label}</span>
        <span className="sr-only xl:hidden">{label}</span>
        <span className={cx("absolute inset-x-3 -bottom-[22px] h-[3px] rounded-full bg-brand-500 transition-opacity", isActive ? "opacity-100" : "opacity-0")} aria-hidden />
      </>}
    </NavLink>
  );
}

function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const activeChild = items.some((i) => location.pathname.startsWith(i.to));
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true"
        className={cx("flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold transition hover:text-brand-600 dark:hover:text-brand-400",
          activeChild ? "text-brand-600 dark:text-brand-400" : "text-ink-soft dark:text-slate-300")}>
        <LayoutGrid className="size-[18px]" aria-hidden /> More <ChevronDown className={cx("size-4 transition", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-3 w-60 origin-top-right animate-pop rounded-2xl bg-white p-2 shadow-lift ring-1 ring-black/5 dark:bg-[#1d1e24] dark:ring-white/10">
          {items.map(({ to, label, icon: Icon, tint }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                isActive ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "text-ink-soft hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5")}>
              <span className="grid size-8 place-items-center rounded-full" style={{ background: `${tint}1f`, color: tint }}><Icon className="size-4" aria-hidden /></span>
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const initial = (user?.full_name || user?.email || "?").charAt(0).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label="Account menu"
        className="flex items-center gap-2 rounded-full p-0.5 pr-0.5 transition hover:bg-slate-100 sm:pr-2 dark:hover:bg-white/5">
        <span className="grid size-9 place-items-center rounded-full bg-ink-soft text-sm font-extrabold text-white dark:bg-brand-500">{initial}</span>
        <ChevronDown className="hidden size-4 text-slate-500 sm:block" aria-hidden />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-3 w-64 origin-top-right animate-pop rounded-2xl bg-white p-2 shadow-lift ring-1 ring-black/5 dark:bg-[#1d1e24] dark:ring-white/10">
          <div className="border-b border-dashed border-slate-200 px-3 pt-2 pb-3 dark:border-white/10">
            <p className="truncate font-extrabold text-ink dark:text-white">{user?.full_name || "Account"}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          <NavLink to="/settings" className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-white/5">
            <Settings className="size-4" aria-hidden /> Settings
          </NavLink>
          <button onClick={onLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function TabLink({ to, label, icon: Icon, end }) {
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) => cx("flex flex-1 flex-col items-center gap-1 pt-2 pb-1 text-[11px] font-bold transition",
        isActive ? "text-brand-600 dark:text-brand-400" : "text-slate-500 dark:text-slate-400")}>
      <Icon className="size-[22px]" aria-hidden />{label}
    </NavLink>
  );
}

/** Mobile "More" bottom sheet: a grid of round tiles, like a food app's "What's on your mind?" row. */
function MoreSheet({ open, onClose, items, onLogout }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/55 backdrop-blur-[2px] lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="More" className="w-full animate-sheet rounded-t-3xl bg-white px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] dark:bg-[#16171c]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 dark:bg-white/15" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Explore FinTrack</h2>
          <button onClick={onClose} aria-label="Close menu" className="grid size-8 place-items-center rounded-full bg-slate-100 dark:bg-white/5"><X className="size-4" /></button>
        </div>
        <div className="grid grid-cols-4 gap-x-2 gap-y-5">
          {items.map(({ to, label, icon: Icon, tint }) => (
            <NavLink key={to} to={to} className="flex flex-col items-center gap-2 text-center text-xs font-bold text-ink-soft dark:text-slate-200">
              <span className="grid size-14 place-items-center rounded-full" style={{ background: `${tint}1f`, color: tint }}><Icon className="size-6" aria-hidden /></span>
              {label}
            </NavLink>
          ))}
        </div>
        <button onClick={onLogout} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-red-200 py-3 text-sm font-bold text-red-600 dark:border-red-500/30 dark:text-red-400">
          <LogOut className="size-4" aria-hidden /> Sign out
        </button>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const { notify } = useToast();
  const live = useRealtimeStatus();

  const loadUnread = useCallback(() => api("/notifications/unread-count").then((r) => setUnread(r.count)).catch(() => {}), []);
  useEffect(() => setSheetOpen(false), [location.pathname]);
  useEffect(() => { loadUnread(); }, [location.pathname, loadUnread]);
  // Pushed over the WebSocket; polling is only a fallback while the socket is down.
  useEffect(() => {
    if (live === "open") return undefined;
    const id = setInterval(loadUnread, 60_000);
    return () => clearInterval(id);
  }, [live, loadUnread]);
  useRealtimeEvent("ready", loadUnread); // resync anything missed while disconnected
  useRealtimeEvent("notification.created", (msg) => {
    setUnread((n) => n + 1);
    notify(msg.data.title, "info");
  });

  const more = [...SECONDARY, ...(isAdmin ? [ADMIN] : [])];
  const sheetItems = [PRIMARY[3], PRIMARY[4], ...more, SETTINGS];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-white/95 shadow-header backdrop-blur dark:bg-[#111216]/95 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:h-20 lg:px-8">
          <Logo />
          <nav className="ml-auto hidden items-center gap-0.5 lg:flex" aria-label="Main">
            {PRIMARY.map((n) => <TopNavLink key={n.to} {...n} />)}
            <MoreMenu items={more} />
          </nav>
          <div className="ml-auto flex items-center gap-1 lg:ml-3 lg:border-l lg:border-slate-200 lg:pl-3 dark:lg:border-white/10">
            <LiveIndicator />
            <ThemeToggle />
            <NavLink to="/notifications" aria-label={`Notifications (${unread} unread)`} className={cx(ICON_BTN, "relative")}>
              <Bell className="size-5" />
              {unread > 0 && <span className="absolute top-1 right-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-extrabold text-white ring-2 ring-white dark:ring-[#111216]">{unread > 9 ? "9+" : unread}</span>}
            </NavLink>
            <AccountMenu user={user} onLogout={logout} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-6 pb-32 sm:px-6 lg:px-8 lg:pt-8 lg:pb-16"><Outlet /></main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-100 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_-12px_rgb(40_44_63/0.2)] backdrop-blur lg:hidden dark:border-white/5 dark:bg-[#111216]/95"
        aria-label="Primary">
        <div className="mx-auto flex max-w-lg items-end px-2">
          <TabLink {...PRIMARY[0]} />
          <TabLink {...PRIMARY[1]} label="Activity" />
          <div className="flex flex-1 justify-center">
            <button onClick={() => setAdding(true)} aria-label="Add transaction"
              className="-mt-6 grid size-14 place-items-center rounded-full bg-brand-500 text-white shadow-cta ring-4 ring-white transition active:scale-95 dark:ring-[#111216]">
              <Plus className="size-7" strokeWidth={2.5} />
            </button>
          </div>
          <TabLink {...PRIMARY[2]} />
          <button onClick={() => setSheetOpen(true)} aria-expanded={sheetOpen}
            className={cx("flex flex-1 flex-col items-center gap-1 pt-2 pb-1 text-[11px] font-bold",
              sheetItems.some((i) => location.pathname.startsWith(i.to)) ? "text-brand-600 dark:text-brand-400" : "text-slate-500 dark:text-slate-400")}>
            <LayoutGrid className="size-[22px]" aria-hidden />More
          </button>
        </div>
      </nav>
      <MoreSheet open={sheetOpen} onClose={() => setSheetOpen(false)} items={sheetItems} onLogout={logout} />

      <TransactionForm open={adding} onClose={() => setAdding(false)}
        onSaved={() => realtime.emit({ type: "data.changed", data: { source: "local" } })} />
      <AssistantChat />
    </div>
  );
}
