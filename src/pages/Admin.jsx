import { useState } from "react";
import { Search } from "lucide-react";
import { api } from "../lib/api.js";
import { shortDate } from "../lib/format.js";
import { useApi, useDebounced } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { Badge, Card, ErrorState, PageHeader, Pagination, Spinner, StatCard } from "../components/ui.jsx";

function UsersTable() {
  const { user: me } = useAuth();
  const { notify } = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(q);
  const { data, error, reload } = useApi("/admin/users", { q: search, page, size: 20 });

  const update = async (u, body) => {
    try { await api(`/admin/users/${u.id}`, { method: "PATCH", body }); notify(`Updated ${u.email}`); reload(); }
    catch (err) { notify(err.message, "error"); }
  };

  return (
    <Card title="Users" bodyClass="p-0">
      <div className="relative border-b border-slate-100 p-4 dark:border-white/10">
        <Search className="absolute top-[29px] left-7 size-4 text-slate-400" aria-hidden />
        <input className="input pl-9" placeholder="Search by email or name" aria-label="Search users" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] tracking-wide text-slate-500 uppercase">
              <tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
              {data.items.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3"><p className="font-medium">{u.full_name || "—"}</p><p className="text-xs text-slate-500">{u.email}</p></td>
                  <td className="px-4 py-3"><Badge color={u.role === "admin" ? "brand" : "slate"}>{u.role}</Badge></td>
                  <td className="px-4 py-3"><Badge color={u.is_active ? "green" : "red"}>{u.is_active ? "Active" : "Disabled"}</Badge></td>
                  <td className="px-4 py-3 text-slate-500">{shortDate(u.created_at)}</td>
                  <td className="space-x-3 px-4 py-3 text-xs whitespace-nowrap">
                    {u.id === me.id ? <span className="text-slate-400">You</span> : <>
                      <button className="link" onClick={() => update(u, { role: u.role === "admin" ? "user" : "admin" })}>
                        {u.role === "admin" ? "Make user" : "Make admin"}</button>
                      <button className="text-red-600 hover:underline" onClick={() => update(u, { is_active: !u.is_active })}>{u.is_active ? "Disable" : "Enable"}</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
        </div>
      )}
    </Card>
  );
}

function AuditLog() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(action);
  const { data, error, reload } = useApi("/admin/audit-logs", { action: debounced, page, size: 25 });
  return (
    <Card title="Audit log" bodyClass="p-0"
      action={<input className="input w-48" placeholder="Filter action, e.g. auth" aria-label="Filter audit actions" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />}>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] tracking-wide text-slate-500 uppercase">
              <tr><th className="px-4 py-2">Time</th><th className="px-4 py-2">User</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Entity</th><th className="px-4 py-2">IP</th><th className="px-4 py-2">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-dashed divide-slate-200 font-mono dark:divide-white/10">
              {data.items.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2">{l.user_id ?? "—"}</td>
                  <td className="px-4 py-2">{l.action}</td>
                  <td className="px-4 py-2">{l.entity_type ? `${l.entity_type}#${l.entity_id}` : "—"}</td>
                  <td className="px-4 py-2">{l.ip_address || "—"}</td>
                  <td className="max-w-xs truncate px-4 py-2" title={JSON.stringify(l.details)}>{l.details ? JSON.stringify(l.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
        </div>
      )}
    </Card>
  );
}

export default function Admin() {
  const { data: stats } = useApi("/admin/stats");
  return (
    <>
      <PageHeader title="Administration" subtitle="Users, roles and the security audit trail" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Users" value={stats?.users ?? "—"} />
        <StatCard label="Active users" value={stats?.active_users ?? "—"} />
        <StatCard label="Transactions" value={stats?.transactions ?? "—"} />
      </div>
      <div className="space-y-6"><UsersTable /><AuditLog /></div>
    </>
  );
}
