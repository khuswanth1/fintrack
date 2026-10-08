import { useState } from "react";
import { Goal as GoalIcon, Plus, Trash2, Trophy } from "lucide-react";
import { api } from "../lib/api.js";
import { money, shortDate } from "../lib/format.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, ProgressBar, Spinner } from "../components/ui.jsx";

function GoalForm({ open, onClose, onSaved }) {
  const { notify } = useToast();
  const [form, setForm] = useState({ name: "", target_amount: "", current_amount: "", target_date: "" });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Name is required");
    if (!(Number(form.target_amount) > 0)) return setError("Target must be positive");
    setSaving(true);
    try {
      await api("/goals", { method: "POST", body: { name: form.name, target_amount: form.target_amount,
        current_amount: form.current_amount || "0", target_date: form.target_date || null } });
      notify("Goal created");
      setForm({ name: "", target_amount: "", current_amount: "", target_date: "" });
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
    <Modal open={open} onClose={onClose} title="New savings goal"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="goal-form" loading={saving}>Create</Button></>}>
      <form id="goal-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Goal name" placeholder="e.g. Emergency fund" value={form.name} onChange={set("name")} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Target amount" inputMode="decimal" value={form.target_amount} onChange={set("target_amount")} />
          <Input label="Already saved" inputMode="decimal" value={form.current_amount} onChange={set("current_amount")} />
        </div>
        <Input label="Target date (optional)" type="date" value={form.target_date} onChange={set("target_date")} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

function Contribute({ goal, onDone, currency }) {
  const { notify } = useToast();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (sign) => {
    if (!(Number(amount) > 0)) return;
    setBusy(true);
    try {
      const g = await api(`/goals/${goal.id}/contributions`, { method: "POST", body: { amount: String(sign * Number(amount)) } });
      notify(g.status === "completed" ? `🎉 Goal "${g.name}" reached!` : `${sign > 0 ? "Added" : "Withdrew"} ${money(amount, currency)}`);
      setAmount("");
      onDone();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex gap-2 border-t border-dashed border-slate-200 pt-4 dark:border-white/10">
      <input className="input min-w-0" inputMode="decimal" placeholder="Amount" aria-label={`Amount for ${goal.name}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button size="sm" loading={busy} onClick={() => send(1)}>Add</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => send(-1)}>Withdraw</Button>
    </div>
  );
}

export default function Goals() {
  const { user } = useAuth();
  const { notify } = useToast();
  const { data, loading, error, reload } = useApi("/goals", undefined, { live: true });
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const cur = user?.currency || "USD";

  const remove = async () => {
    try { await api(`/goals/${deleting.id}`, { method: "DELETE" }); notify("Goal deleted"); setDeleting(null); reload(); }
    catch (err) { notify(err.message, "error"); }
  };

  return (
    <>
      <PageHeader title="Financial goals" subtitle="Save towards what matters, one contribution at a time"
        actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" /> New goal</Button>} />
      {error ? <Card><ErrorState error={error} onRetry={reload} /></Card>
        : loading && !data ? <Spinner />
          : !data.length ? <Card><EmptyState icon={GoalIcon} title="No goals yet" message="Create a goal like an emergency fund or a trip, then track your progress."
            action={<Button onClick={() => setOpen(true)}><Plus className="size-4" /> Create a goal</Button>} /></Card>
            : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.map((g) => {
                  const done = g.status === "completed";
                  return (
                    <article key={g.id} className="card relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-lift">
                      <span className={`absolute inset-x-0 top-0 h-1.5 ${done ? "bg-fresh-500" : "bg-gradient-to-r from-brand-400 to-brand-600"}`} aria-hidden />
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${done ? "bg-emerald-50 text-fresh-600 dark:bg-emerald-500/10" : "bg-brand-50 text-brand-600 dark:bg-brand-500/10"}`}>
                            {done ? <Trophy className="size-5" aria-hidden /> : <GoalIcon className="size-5" aria-hidden />}
                          </span>
                          <div className="min-w-0"><h3 className="truncate font-extrabold">{g.name}</h3>
                            <p className="text-xs font-medium text-slate-500">{g.target_date ? `Target ${shortDate(g.target_date)}` : "No deadline"}</p></div>
                        </div>
                        <div className="flex items-center gap-1">
                          {done ? <Badge color="green">Completed</Badge> : <Badge color="brand">Active</Badge>}
                          <button aria-label={`Delete goal ${g.name}`} className="rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" onClick={() => setDeleting(g)}><Trash2 className="size-4" /></button>
                        </div>
                      </div>
                      <p className="mt-4 text-sm text-slate-500"><span className="text-2xl font-extrabold text-ink tabular-nums dark:text-white">{money(g.current_amount, cur)}</span> of {money(g.target_amount, cur)}</p>
                      <div className="my-3"><ProgressBar value={g.progress_pct} status={done ? "ok" : undefined} /></div>
                      <p className="text-xs font-medium text-slate-500">
                        <b className="text-ink-soft dark:text-slate-200">{g.progress_pct}% complete</b>
                        {g.monthly_needed && ` · save ${money(g.monthly_needed, cur)}/month`}
                      </p>
                      {g.status === "active" && <Contribute goal={g} onDone={reload} currency={cur} />}
                    </article>
                  );
                })}
              </div>
            )}
      <GoalForm open={open} onClose={() => setOpen(false)} onSaved={reload} />
      <ConfirmDialog open={Boolean(deleting)} title="Delete goal" onClose={() => setDeleting(null)} onConfirm={remove}
        message={`Delete the goal "${deleting?.name}"? This cannot be undone.`} />
    </>
  );
}
