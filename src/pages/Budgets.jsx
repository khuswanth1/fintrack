import { useState } from "react";
import { ChevronLeft, ChevronRight, Lightbulb, Pencil, PiggyBank, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { money, pct } from "../lib/format.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, ProgressBar, Select, Spinner } from "../components/ui.jsx";

const STATUS = { ok: ["green", "On track"], warning: ["amber", "Near limit"], exceeded: ["red", "Over budget"] };

const thisMonth = () => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1 }; };
const shift = ({ year, month }, by) => { const d = new Date(year, month - 1 + by, 1); return { year: d.getFullYear(), month: d.getMonth() + 1 }; };
const longMonth = ({ year, month }) => new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

function BudgetForm({ open, budget, initial, categories, suggestions, cur, onClose, onSaved }) {
  const { notify } = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const defaults = budget ? { category_id: budget.category.id, amount: budget.amount, alert_threshold: budget.alert_threshold }
    : { category_id: initial?.category.id ?? "", amount: initial?.suggested_amount ?? "", alert_threshold: 80 };
  const current = open ? { ...defaults, ...form } : {};
  const suggestion = suggestions.find((s) => String(s.category.id) === String(current.category_id));
  const average = budget ? +budget.avg_spent_3m : suggestion ? +suggestion.avg_spent_3m : 0;

  const close = () => { setForm({}); setError(null); onClose(); };
  const pickCategory = (id) => {
    const s = suggestions.find((x) => String(x.category.id) === id);
    // Pre-fill with the suggested limit unless the user already typed an amount.
    setForm({ ...form, category_id: id, ...(s && !form.amount ? { amount: s.suggested_amount } : {}) });
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!budget && !current.category_id) { setError("Choose a category"); return; }
    if (!(Number(current.amount) > 0)) { setError("Enter a positive monthly limit"); return; }
    setSaving(true);
    try {
      const body = { amount: String(current.amount), alert_threshold: Number(current.alert_threshold) };
      if (budget) await api(`/budgets/${budget.id}`, { method: "PATCH", body });
      else await api("/budgets", { method: "POST", body: { ...body, category_id: Number(current.category_id) } });
      notify(budget ? "Budget updated" : "Budget created");
      onSaved();
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={budget ? `Edit ${budget.category.name} budget` : "New budget"}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit" form="budget-form" loading={saving}>Save</Button></>}>
      <form id="budget-form" onSubmit={submit} className="space-y-4" noValidate>
        {!budget && (
          <Select label="Category" value={current.category_id} onChange={(e) => pickCategory(e.target.value)}>
            <option value="">Select a category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
        <Input label="Monthly limit" inputMode="decimal" value={current.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
          hint={average > 0 ? `You usually spend about ${money(average, cur)} a month here (last 3 months).` : undefined} />
        {average > 0 && (
          <div className="flex flex-wrap gap-2">
            {[["Tight", 0.9], ["Average", 1], ["Relaxed", 1.15]].map(([label, f]) => {
              const v = (Math.ceil((average * f) / 10) * 10).toFixed(2);
              return (
                <button key={label} type="button" onClick={() => setForm({ ...form, amount: v })}
                  className={`rounded-full px-3 py-1 text-xs font-bold ring-1 transition ${Number(current.amount) === Number(v) ? "bg-brand-500 text-white ring-brand-500" : "ring-slate-200 hover:bg-brand-50 dark:ring-white/10 dark:hover:bg-white/5"}`}>
                  {label} · {money(v, cur)}
                </button>
              );
            })}
          </div>
        )}
        <Input label={`Alert at ${current.alert_threshold}% used`} type="range" min="50" max="100" step="5" value={current.alert_threshold}
          onChange={(e) => setForm({ ...form, alert_threshold: e.target.value })} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

function ForecastBar({ b }) {
  return (
    <div className="relative my-3">
      <ProgressBar value={b.used_pct} status={b.status} />
      {+b.projected > +b.spent && (
        <span className="absolute -top-1 h-4 w-0.5 rounded bg-slate-400 dark:bg-slate-300" title={`Forecast ${Math.round(b.projected_pct)}%`}
          style={{ left: `${Math.min(100, b.projected_pct)}%` }} aria-hidden />
      )}
    </div>
  );
}

function BudgetCard({ b, cur, isCurrent, onEdit, onDelete }) {
  const [color, label] = STATUS[b.status];
  const likelyOver = isCurrent && b.status !== "exceeded" && b.projected_status === "exceeded";
  return (
    <article className="card p-5 transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3"><Avatar name={b.category.name} color={b.category.color} />
          <div className="min-w-0"><h3 className="truncate font-extrabold">{b.category.name}</h3>
            <p className="text-xs font-medium text-slate-500">Alert at {b.alert_threshold}%</p></div></div>
        {likelyOver ? <Badge color="amber">Likely over</Badge> : <Badge color={color}>{label}</Badge>}
      </div>
      <p className="text-sm text-slate-500"><span className="text-2xl font-extrabold text-ink tabular-nums dark:text-white">{money(b.spent, cur)}</span> of {money(b.amount, cur)}</p>
      <ForecastBar b={b} />
      <dl className="grid grid-cols-3 gap-2 text-xs">
        {isCurrent && <div><dt className="text-slate-500">Forecast</dt><dd className={`font-bold tabular-nums ${b.projected_status === "exceeded" ? "text-red-600 dark:text-red-400" : ""}`}>{money(b.projected, cur)}</dd></div>}
        <div><dt className="text-slate-500">Last month</dt><dd className="font-bold tabular-nums">{money(b.last_month_spent, cur)}</dd></div>
        <div><dt className="text-slate-500">3-mo avg</dt><dd className="font-bold tabular-nums">{money(b.avg_spent_3m, cur)}</dd></div>
      </dl>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-slate-200 pt-3 text-xs dark:border-white/10">
        <span>
          <span className={+b.remaining >= 0 ? "font-bold text-fresh-600 dark:text-emerald-400" : "font-bold text-red-600 dark:text-red-400"}>
            {+b.remaining >= 0 ? `${money(b.remaining, cur)} left` : `${money(-b.remaining, cur)} over`}</span>
          {isCurrent && +b.remaining > 0 && <span className="text-slate-500"> · ≈ {money(b.safe_daily, cur)}/day</span>}
        </span>
        <span className="flex gap-1 text-slate-400">
          <button aria-label={`Edit ${b.category.name} budget`} className="rounded-full p-2 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-white/5" onClick={onEdit}><Pencil className="size-4" /></button>
          <button aria-label={`Delete ${b.category.name} budget`} className="rounded-full p-2 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" onClick={onDelete}><Trash2 className="size-4" /></button>
        </span>
      </div>
    </article>
  );
}

function Suggestions({ items, cur, onAdd, onCustomize }) {
  const [adding, setAdding] = useState(null);
  if (!items.length) return null;
  const add = async (s) => { setAdding(s.category.id); try { await onAdd(s); } finally { setAdding(null); } };
  return (
    <Card className="mt-6" title={<span className="inline-flex items-center gap-2"><Lightbulb className="size-4 text-amber-500" /> Suggested budgets</span>}
      action={<span className="text-xs text-slate-500">Based on your last 3 months</span>} bodyClass="p-0">
      <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
        {items.map((s) => (
          <li key={s.category.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <Avatar name={s.category.name} color={s.category.color} />
            <div className="min-w-0 flex-1"><p className="font-bold">{s.category.name}</p>
              <p className="text-xs text-slate-500">Avg {money(s.avg_spent_3m, cur)}/month · {money(s.spent, cur)} this month</p></div>
            <Button size="sm" variant="secondary" onClick={() => onCustomize(s)}>Customize</Button>
            <Button size="sm" loading={adding === s.category.id} onClick={() => add(s)}><Plus className="size-3.5" /> Add {money(s.suggested_amount, cur)}</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function Budgets() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [period, setPeriod] = useState(thisMonth);
  const { data, loading, error, reload } = useApi("/budgets/overview", period, { live: true });
  const { data: categories } = useApi("/categories", { kind: "expense" });
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const cur = user?.currency || "USD";

  const budgets = data?.budgets || [];
  const isCurrent = data?.is_current ?? true;
  const atCurrent = period.year === thisMonth().year && period.month === thisMonth().month;
  const available = (categories || []).filter((c) => !budgets.some((b) => b.category.id === c.id));
  const totals = budgets.reduce((a, b) => ({ limit: a.limit + +b.amount, spent: a.spent + +b.spent, projected: a.projected + +b.projected,
    safe: a.safe + +(b.safe_daily || 0) }), { limit: 0, spent: 0, projected: 0, safe: 0 });

  const openNew = (s = null) => { setEditing(null); setPreset(s); setOpen(true); };
  const quickAdd = async (s) => {
    try {
      await api("/budgets", { method: "POST", body: { category_id: s.category.id, amount: String(s.suggested_amount), alert_threshold: 80 } });
      notify(`${s.category.name} budget created`);
      reload();
    } catch (err) { notify(err.message, "error"); }
  };
  const remove = async () => {
    try {
      await api(`/budgets/${deleting.id}`, { method: "DELETE" });
      notify("Budget deleted");
      setDeleting(null);
      reload();
    } catch (err) { notify(err.message, "error"); }
  };

  const monthNav = (
    <div className="flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
      <button aria-label="Previous month" className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-white/10" onClick={() => setPeriod((p) => shift(p, -1))}><ChevronLeft className="size-4" /></button>
      <span className="min-w-32 text-center text-sm font-bold">{longMonth(period)}</span>
      <button aria-label="Next month" className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-white/10" disabled={atCurrent} onClick={() => setPeriod((p) => shift(p, 1))}><ChevronRight className="size-4" /></button>
    </div>
  );

  return (
    <>
      <PageHeader title="Budgets" subtitle="Monthly spending limits per category, with alerts as you approach them"
        actions={<>{monthNav}<Button onClick={() => openNew()} disabled={!available.length}><Plus className="size-4" /> New budget</Button></>} />
      {error ? <Card><ErrorState error={error} onRetry={reload} /></Card>
        : loading && !data ? <Spinner />
          : !budgets.length ? (
            <>
              <Card><EmptyState icon={PiggyBank} title="No budgets yet" message="Set a monthly limit for categories like Dining or Shopping to get alerts before you overspend."
                action={<Button onClick={() => openNew()}><Plus className="size-4" /> Create your first budget</Button>} /></Card>
              <Suggestions items={data.suggestions} cur={cur} onAdd={quickAdd} onCustomize={openNew} />
            </>
          ) : (
            <>
              <section className="mb-6 rounded-3xl bg-gradient-to-r from-brand-50 to-white p-5 ring-1 ring-brand-100 dark:from-brand-500/10 dark:to-transparent dark:ring-brand-500/20">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div><p className="text-xs font-bold tracking-wide text-brand-700 uppercase dark:text-brand-300">{isCurrent ? "Spent this month" : `Spent in ${longMonth(period)}`} across budgets</p>
                    <p className="mt-1 text-3xl font-extrabold tracking-tight text-ink tabular-nums dark:text-white">{money(totals.spent, cur)} <span className="text-base font-semibold text-slate-500">of {money(totals.limit, cur)}</span></p></div>
                  <p className="rounded-full bg-white px-3 py-1 text-sm font-extrabold text-ink shadow-soft dark:bg-white/10 dark:text-white">{pct(totals.limit ? (totals.spent / totals.limit) * 100 : 0, 0)} used</p>
                </div>
                <div className="mt-4"><ProgressBar value={totals.limit ? (totals.spent / totals.limit) * 100 : 0} status={totals.spent > totals.limit ? "exceeded" : "ok"} /></div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  {isCurrent && <div><dt className="text-xs text-slate-500">Forecast at month end</dt>
                    <dd className={`font-extrabold tabular-nums ${totals.projected > totals.limit ? "text-red-600 dark:text-red-400" : ""}`}>{money(totals.projected, cur)}</dd></div>}
                  {isCurrent && <div><dt className="text-xs text-slate-500">Safe to spend</dt><dd className="font-extrabold tabular-nums">{money(totals.safe, cur)}/day</dd></div>}
                  {isCurrent && <div><dt className="text-xs text-slate-500">Days left</dt><dd className="font-extrabold tabular-nums">{data.days_left}</dd></div>}
                  <div><dt className="text-xs text-slate-500">Spent outside budgets</dt><dd className="font-extrabold tabular-nums">{money(data.unbudgeted_spent, cur)}</dd></div>
                </dl>
              </section>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {budgets.map((b) => (
                  <BudgetCard key={b.id} b={b} cur={cur} isCurrent={isCurrent}
                    onEdit={() => { setEditing(b); setPreset(null); setOpen(true); }} onDelete={() => setDeleting(b)} />
                ))}
              </div>
              {isCurrent && <p className="mt-3 text-xs text-slate-500">The grey tick on each bar marks the month-end forecast: what you've spent so far plus what you usually spend in the rest of the month.</p>}
              <Suggestions items={data.suggestions} cur={cur} onAdd={quickAdd} onCustomize={openNew} />
            </>
          )}
      <BudgetForm key={preset?.category.id ?? editing?.id ?? "new"} open={open} budget={editing} categories={available} suggestions={data?.suggestions || []} cur={cur}
        initial={preset} onClose={() => setOpen(false)} onSaved={reload} />
      <ConfirmDialog open={Boolean(deleting)} title="Delete budget" onClose={() => setDeleting(null)} onConfirm={remove}
        message={`Remove the ${deleting?.category.name} budget? Your transactions are not affected.`} />
    </>
  );
}
