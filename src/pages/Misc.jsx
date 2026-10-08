import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck, Download, FileSpreadsheet, FileText } from "lucide-react";
import { api, downloadFile } from "../lib/api.js";
import { relativeTime } from "../lib/format.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { useRealtimeEvent } from "../context/RealtimeContext.jsx";
import GoogleSignIn, { getAuthProviders } from "../components/GoogleSignIn.jsx";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Spinner } from "../components/ui.jsx";

export function Reports() {
  const { notify } = useToast();
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [busy, setBusy] = useState(null);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (err) { notify(err.message, "error"); } finally { setBusy(null); }
  };
  const [year, month] = period.split("-").map(Number);
  return (
    <>
      <PageHeader title="Reports" subtitle="Download statements and exports of your data" />
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Monthly PDF report">
          <p className="mb-4 text-sm text-slate-500">Summary, category breakdown, budgets, insights and largest expenses for a month.</p>
          <div className="flex items-end gap-3">
            <div className="flex-1"><Input label="Month" type="month" value={period} max={`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`}
              onChange={(e) => setPeriod(e.target.value)} /></div>
            <Button loading={busy === "pdf"} disabled={!period}
              onClick={() => run("pdf", () => downloadFile("/reports/monthly", { year, month }, `fintrack-${period}.pdf`))}>
              <FileText className="size-4" /> Download PDF</Button>
          </div>
        </Card>
        <Card title="Export all transactions">
          <p className="mb-4 text-sm text-slate-500">Full history as a spreadsheet. Use the Transactions page to export a filtered subset.</p>
          <div className="flex gap-3">
            <Button variant="secondary" loading={busy === "csv"} onClick={() => run("csv", () => downloadFile("/transactions/export", { format: "csv" }, "fintrack.csv"))}>
              <Download className="size-4" /> CSV</Button>
            <Button variant="secondary" loading={busy === "xlsx"} onClick={() => run("xlsx", () => downloadFile("/transactions/export", { format: "xlsx" }, "fintrack.xlsx"))}>
              <FileSpreadsheet className="size-4" /> Excel</Button>
          </div>
        </Card>
      </div>
    </>
  );
}

export function Notifications() {
  const { notify } = useToast();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, loading, error, reload } = useApi("/notifications", { page, size: 20, unread_only: unreadOnly || undefined });
  useRealtimeEvent("notification.created", reload);

  const markAll = async () => {
    try { await api("/notifications/read-all", { method: "POST" }); reload(); notify("All notifications marked as read"); }
    catch (err) { notify(err.message, "error"); }
  };
  const markOne = async (n) => {
    if (n.is_read) return;
    try { await api(`/notifications/${n.id}/read`, { method: "POST" }); reload(); } catch { /* non-critical */ }
  };

  return (
    <>
      <PageHeader title="Notifications" subtitle="Budget alerts, goal milestones and account activity"
        actions={<>
          <Button variant="secondary" onClick={() => { setUnreadOnly(!unreadOnly); setPage(1); }}>{unreadOnly ? "Show all" : "Unread only"}</Button>
          <Button variant="secondary" onClick={markAll}><CheckCheck className="size-4" /> Mark all read</Button>
        </>} />
      <Card bodyClass="p-0">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <Spinner />
          : !data.items.length ? <EmptyState icon={Bell} title="You're all caught up" />
            : (
              <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
                {data.items.map((n) => (
                  <li key={n.id}>
                    <button onClick={() => markOne(n)} className={`flex w-full gap-3 px-5 py-4 text-left text-sm ${n.is_read ? "" : "bg-brand-50/50 dark:bg-brand-500/5"}`}>
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.is_read ? "bg-transparent" : "bg-brand-500"}`} aria-hidden />
                      <span className="flex-1"><span className="block font-medium">{n.title}</span><span className="text-slate-600 dark:text-slate-400">{n.message}</span></span>
                      <span className="text-xs whitespace-nowrap text-slate-400">{relativeTime(n.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
      </Card>
    </>
  );
}

export function Settings() {
  const { user, setUser, logout } = useAuth();
  const { notify } = useToast();
  const [profile, setProfile] = useState({ full_name: user?.full_name || "", currency: user?.currency || "USD" });
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm: "" });
  const [busy, setBusy] = useState(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    getAuthProviders().then((p) => alive && setGoogleEnabled(Boolean(p.google?.enabled)));
    return () => { alive = false; };
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy("profile");
    try { setUser(await api("/users/me", { method: "PATCH", body: profile })); notify("Profile saved"); }
    catch (err) { notify(err.message, "error"); } finally { setBusy(null); }
  };
  const hasPassword = user?.has_password !== false;
  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) return notify("New passwords do not match", "error");
    setBusy("pw");
    try {
      await api("/users/me/password", { method: "POST",
        body: { current_password: hasPassword ? pw.current_password : null, new_password: pw.new_password } });
      notify(hasPassword ? "Password changed. Please sign in again." : "Password set. Please sign in again.");
      await logout();
    } catch (err) { notify(err.details?.[0]?.message || err.message, "error"); } finally { setBusy(null); }
  };
  const linkGoogle = async (credential) => {
    setBusy("google");
    try { setUser(await api("/users/me/google", { method: "POST", body: { credential } })); notify("Google account connected"); }
    catch (err) { notify(err.message, "error"); } finally { setBusy(null); }
  };
  const unlinkGoogle = async () => {
    setBusy("google");
    try { setUser(await api("/users/me/google", { method: "DELETE" })); notify("Google account disconnected"); }
    catch (err) { notify(err.message, "error"); } finally { setBusy(null); }
  };
  const signOutEverywhere = async () => {
    try { await api("/auth/logout-all", { method: "POST" }); await logout(); } catch (err) { notify(err.message, "error"); }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your profile and security" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <form onSubmit={saveProfile} className="space-y-4">
            <Input label="Email" value={user?.email || ""} disabled />
            <Input label="Full name" maxLength={120} value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
            <Select label="Currency" value={profile.currency} onChange={(e) => setProfile({ ...profile, currency: e.target.value })}>
              {["INR", "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "SGD"].map((c) => <option key={c}>{c}</option>)}
            </Select>
            <div className="flex items-center justify-between"><Badge color="brand">Role: {user?.role}</Badge><Button type="submit" loading={busy === "profile"}>Save profile</Button></div>
          </form>
        </Card>
        <Card title="Security">
          <form onSubmit={changePassword} className="space-y-4">
            {hasPassword
              ? <Input label="Current password" type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
              : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">You sign in with Google. Set a password to also sign in with your email.</p>}
            <Input label="New password" type="password" autoComplete="new-password" hint="At least 8 characters with a letter and a number"
              value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="ghost" onClick={signOutEverywhere}>Sign out of all devices</Button>
              <Button type="submit" loading={busy === "pw"} disabled={(hasPassword && !pw.current_password) || !pw.new_password}>
                {hasPassword ? "Change password" : "Set password"}</Button>
            </div>
          </form>
        </Card>
        {(googleEnabled || user?.google_linked) && <Card title="Connected accounts" className="lg:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-slate-100 text-lg font-extrabold dark:bg-white/5" aria-hidden>
                <span className="bg-gradient-to-br from-[#4285f4] via-[#ea4335] to-[#fbbc05] bg-clip-text text-transparent">G</span>
              </span>
              <div>
                <p className="font-bold">Google</p>
                <p className="text-sm text-slate-500">{user?.google_linked ? "Connected. You can sign in with Google." : "Sign in with your Google account instead of a password."}</p>
              </div>
            </div>
            {user?.google_linked ? (
              <Button variant="secondary" loading={busy === "google"} disabled={!hasPassword} onClick={unlinkGoogle}
                title={hasPassword ? undefined : "Set a password first so you can still sign in"}>Disconnect</Button>
            ) : (
              <div className="w-full sm:w-72"><GoogleSignIn text="continue_with" divider={false} onCredential={linkGoogle} onError={(err) => notify(err.message, "error")} /></div>
            )}
          </div>
          {user?.google_linked && !hasPassword && <p className="mt-3 text-xs text-slate-500">Set a password above before disconnecting Google, so you can still sign in.</p>}
        </Card>}
      </div>
    </>
  );
}

export function NotFound() {
  return (
    <EmptyState title="Page not found" message="The page you're looking for doesn't exist."
      action={<Link to="/"><Button>Back to dashboard</Button></Link>} />
  );
}
