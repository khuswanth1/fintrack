import { useState } from "react";
import { Pause, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { money, shortDate, todayISO } from "../lib/format.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Spinner } from "../components/ui.jsx";

function RecurringForm({ open, onClose, onSaved }) {
  const { notify } = useToast();
  const { data: categories } = useApi(open ? "/categories" : null);
  const blank = { kind: "expense", amount: "", description: "", category_id: "", frequency: "monthly", start_date: todayISO(), end_date: "" };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value, ...(k === "kind" ? { category_id: "" } : {}) });

  const submit = async (e) => {
    e.preventDefault();
    if (!(Number(form.amount) > 0)) return setError("Enter a positive amount");
    if (form.end_date && form.end_date < form.start_date) return setError("End date must be after the start date");
    setSaving(true);
    try {
      await api("/recurring", { method: "POST", body: { ...form, category_id: form.category_id ? Number(form.category_id) : null, end_date: form.end_date || null } });
      notify("Recurring transaction scheduled");
      setForm(blank);
      setError(null);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New recurring transaction"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="rec-form" loading={saving}>Schedule</Button></>}>
      <form id="rec-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" value={form.kind} onChange={set("kind")}><option value="expense">Expense</option><option value="income">Income</option></Select>
          <Input label="Amount" inputMode="decimal" value={form.amount} onChange={set("amount")} />
        </div>
        <Input label="Description" value={form.description} onChange={set("description")} placeholder="e.g. Rent, Salary" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" value={form.category_id} onChange={set("category_id")}>
            <option value="">Uncategorized</option>
            {(categories || []).filter((c) => c.kind === form.kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select label="Frequency" value={form.frequency} onChange={set("frequency")}>
            {["daily", "weekly", "monthly", "yearly"].map((f) => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start date" type="date" value={form.start_date} onChange={set("start_date")} />
          <Input label="End date (optional)" type="date" value={form.end_date} onChange={set("end_date")} />
        </div>
        <p className="text-xs text-slate-500">Past occurrences since the start date are added immediately; future ones are created automatically each day.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

export default function Recurring() {
  const { user } = useAuth();
  const { notify } = useToast();
  const { data, loading, error, reload } = useApi("/recurring", undefined, { live: true });
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const cur = user?.currency || "USD";

  const toggle = async (r) => {
    try { await api(`/recurring/${r.id}`, { method: "PATCH", body: { is_active: !r.is_active } }); reload(); }
    catch (err) { notify(err.message, "error"); }
  };
  const remove = async () => {
    try { await api(`/recurring/${deleting.id}`, { method: "DELETE" }); notify("Schedule deleted"); setDeleting(null); reload(); }
    catch (err) { notify(err.message, "error"); }
  };

  return (
    <>
      <PageHeader title="Recurring transactions" subtitle="Salary, rent, subscriptions — recorded automatically on schedule"
        actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" /> New schedule</Button>} />
      <Card bodyClass="p-0">
        {error ? <ErrorState error={error} onRetry={reload} />
          : loading && !data ? <Spinner />
            : !data.length ? <EmptyState icon={Repeat} title="No recurring transactions" message="Schedule regular income or bills so you never have to enter them by hand." />
              : (
                <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
                  {data.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
                      <span className="size-2.5 rounded-full" style={{ background: r.category?.color || "#94a3b8" }} />
                      <div className="min-w-40 flex-1">
                        <p className="font-medium">{r.description || r.category?.name || "Recurring"}</p>
                        <p className="text-xs text-slate-500 capitalize">{r.frequency} · {r.category?.name || "Uncategorized"}
                          {r.end_date && ` · until ${shortDate(r.end_date)}`}</p>
                      </div>
                      <div className="text-right text-xs text-slate-500">{r.is_active ? <>Next: {shortDate(r.next_run_date)}</> : <Badge>Paused</Badge>}</div>
                      <span className={`w-28 text-right font-semibold tabular-nums ${r.kind === "income" ? "text-fresh-600 dark:text-emerald-400" : ""}`}>
                        {r.kind === "income" ? "+" : "−"}{money(r.amount, cur)}</span>
                      <div className="flex gap-1">
                        <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5" onClick={() => toggle(r)}
                          aria-label={r.is_active ? `Pause ${r.description}` : `Resume ${r.description}`}>{r.is_active ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
                        <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" onClick={() => setDeleting(r)}
                          aria-label={`Delete ${r.description}`}><Trash2 className="size-4" /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
      </Card>
      <RecurringForm open={open} onClose={() => setOpen(false)} onSaved={reload} />
      <ConfirmDialog open={Boolean(deleting)} title="Delete schedule" onClose={() => setDeleting(null)} onConfirm={remove}
        message="Stop this schedule? Transactions it already created are kept." />
    </>
  );
}
