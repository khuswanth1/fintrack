import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, PiggyBank, Plus, Target } from "lucide-react";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { money, pct, shortDate } from "../lib/format.js";
import { Avatar, Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Skeleton, cx } from "../components/ui.jsx";
import { CategoryDonut, SavingsBars, TrendChart } from "../components/charts.jsx";
import TransactionForm from "../components/TransactionForm.jsx";

function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = (name || "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-56 lg:col-span-2" /><Skeleton className="h-56" /></div>
      <div className="flex gap-4 overflow-hidden">{[...Array(6)].map((_, i) => <Skeleton key={i} className="size-24 shrink-0 rounded-full" />)}</div>
      <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-80 lg:col-span-2" /><Skeleton className="h-80" /></div>
    </div>
  );
}

function Delta({ value, goodWhenUp = true }) {
  if (value === null || value === undefined) return <span className="text-white/70">—</span>;
  const good = (value >= 0) === goodWhenUp;
  return (
    <span className={cx("rounded-full px-1.5 py-0.5 text-[10px] font-extrabold", good ? "bg-white/25 text-white" : "bg-ink/25 text-white")}>
      {value >= 0 ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/** The orange "Swiggy One"-style banner: balance up top, this month's flows in frosted tiles below. */
function BalanceHero({ data, cur, label }) {
  const tiles = [
    { name: "Income", value: data.income, icon: ArrowDownLeft, delta: <Delta value={data.changes.income_pct} /> },
    { name: "Spent", value: data.expenses, icon: ArrowUpRight, delta: <Delta value={data.changes.expenses_pct} goodWhenUp={false} /> },
    { name: "Saved", value: data.savings, icon: PiggyBank, delta: <span className="text-[10px] font-bold text-white/80">{pct(data.savings_rate, 0)} rate</span> },
  ];
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-400 via-brand-500 to-[#f2541b] p-6 text-white shadow-cta lg:col-span-2" aria-label="Balance">
      <span className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/10" aria-hidden />
      <span className="pointer-events-none absolute -right-20 -bottom-24 size-72 rounded-full bg-white/10" aria-hidden />
      <div className="relative">
        <p className="text-xs font-bold tracking-widest text-white/80 uppercase">Total balance</p>
        <p className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">{money(data.balance, cur)}</p>
        <p className="mt-1 text-sm font-medium text-white/80">All-time income minus expenses</p>
        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
          {tiles.map(({ name, value, icon: Icon, delta }) => (
            <div key={name} className="rounded-2xl bg-white/15 p-3 ring-1 ring-white/20 backdrop-blur-sm">
              <p className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-white/85 uppercase"><Icon className="size-3.5" aria-hidden />{name}</p>
              <p className="mt-1 truncate text-base font-extrabold tabular-nums sm:text-lg">
                <span className="sm:hidden">{money(value, cur, { compact: true })}</span>
                <span className="hidden sm:inline">{money(value, cur)}</span>
              </p>
              <div className="mt-1">{delta}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs font-semibold text-white/75">{label}</p>
      </div>
    </section>
  );
}

function SavingsRing({ rate }) {
  const clamped = Math.max(0, Math.min(100, rate));
  return (
    <Card title="Savings rate" bodyClass="flex flex-col items-center justify-center px-5 pt-3 pb-6">
      <div className="relative grid size-40 place-items-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15.9" fill="none" className="stroke-brand-50 dark:stroke-white/10" strokeWidth="3.2" />
          <circle cx="18" cy="18" r="15.9" fill="none" className="stroke-brand-500" strokeWidth="3.2" strokeLinecap="round"
            strokeDasharray={`${clamped} 100`} />
        </svg>
        <div className="text-center"><p className="text-3xl font-extrabold text-ink dark:text-white">{pct(rate, 0)}</p><p className="text-xs font-medium text-slate-500">of income saved</p></div>
      </div>
      <p className={cx("mt-4 rounded-full px-3 py-1 text-center text-xs font-bold",
        rate >= 20 ? "bg-emerald-50 text-fresh-600 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300")}>
        {rate >= 20 ? "Great job! You're above the 20% guideline" : "Aim to save 20% or more each month"}
      </p>
    </Card>
  );
}

function CategoryBubbles({ items, cur }) {
  return (
    <section className="mt-8" aria-labelledby="where-heading">
      <div className="mb-3 flex items-end justify-between">
        <h2 id="where-heading" className="text-xl font-extrabold tracking-tight">Where your money went</h2>
        <Link to="/transactions" className="link text-sm">See all</Link>
      </div>
      <ul className="no-scrollbar -mx-4 flex snap-x gap-5 overflow-x-auto px-4 pt-1 pb-2 sm:mx-0 sm:px-0">
        {items.map((c) => (
          <li key={c.name} className="flex w-24 shrink-0 snap-start flex-col items-center text-center">
            <span className="grid size-20 place-items-center rounded-full text-2xl font-extrabold shadow-soft transition hover:scale-105"
              style={{ background: `${c.color}1f`, color: c.color, boxShadow: `inset 0 0 0 2px ${c.color}33` }} aria-hidden>
              {c.name.charAt(0).toUpperCase()}
            </span>
            <span className="mt-2 w-full truncate text-sm font-bold text-ink-soft dark:text-slate-200">{c.name}</span>
            <span className="text-xs font-semibold text-slate-500 tabular-nums">{money(c.amount, cur)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useApi("/dashboard/summary", period, { live: true });

  const shift = (delta) => setPeriod(({ year, month }) => {
    const d = new Date(year, month - 1 + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const isCurrent = period.year === now.getFullYear() && period.month === now.getMonth() + 1;
  const label = new Date(period.year, period.month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const header = (
    <PageHeader eyebrow={greeting(user?.full_name)} title="Dashboard" subtitle="Your money at a glance"
      actions={<>
        <div className="flex items-center rounded-full bg-white p-1 shadow-soft dark:bg-white/5">
          <button className="grid size-8 place-items-center rounded-full hover:bg-slate-100 dark:hover:bg-white/10" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="size-4" /></button>
          <span className="min-w-32 text-center text-sm font-bold">{label}</span>
          <button className="grid size-8 place-items-center rounded-full hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-white/10" onClick={() => shift(1)} disabled={isCurrent} aria-label="Next month"><ChevronRight className="size-4" /></button>
        </div>
        <span className="hidden sm:block"><Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add transaction</Button></span>
      </>} />
  );

  const form = <TransactionForm open={adding} onClose={() => setAdding(false)} onSaved={reload} />;
  if (error) return <>{header}<Card><ErrorState error={error} onRetry={reload} /></Card>{form}</>;
  if (loading && !data) return <>{header}<DashboardSkeleton /></>;

  const cur = data.currency;
  const hasData = data.monthly_trend.some((m) => +m.income || +m.expense);
  const yearly = data.yearly_trend.map((y) => ({ ...y, label: String(y.year), income: +y.income, expense: +y.expense, savings: +y.savings }));

  return (
    <>
      {header}
      {!hasData && (
        <Card className="mb-6"><EmptyState title="No transactions yet" message="Add your first income or expense, or import a CSV/Excel file from the Transactions page."
          action={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add transaction</Button>} /></Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <BalanceHero data={data} cur={cur} label={`Showing ${label}`} />
        <SavingsRing rate={data.savings_rate} />
      </div>

      {data.category_breakdown.length > 0 && <CategoryBubbles items={data.category_breakdown} cur={cur} />}

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        <Card title="Income vs expenses · last 12 months" className="lg:col-span-2">
          <TrendChart data={data.monthly_trend} currency={cur} />
        </Card>
        <Card title="Spending by category">
          {data.category_breakdown.length ? <CategoryDonut data={data.category_breakdown} currency={cur} />
            : <EmptyState title="No expenses this month" />}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Budget usage" action={<Link to="/budgets" className="link text-sm">Manage</Link>}>
          {data.budget_usage.items.length ? (
            <>
              <div className="mb-4 flex items-baseline justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-white/5">
                <span className="font-medium text-slate-500">{money(data.budget_usage.total_spent, cur)} of {money(data.budget_usage.total_budget, cur)}</span>
                <span className="font-extrabold text-ink dark:text-white">{pct(data.budget_usage.used_pct, 0)} used</span>
              </div>
              <ul className="space-y-4">
                {data.budget_usage.items.slice(0, 6).map((b) => (
                  <li key={b.id} className="flex items-center gap-3">
                    <Avatar name={b.category.name} color={b.category.color} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex justify-between gap-2 text-sm"><span className="truncate font-bold">{b.category.name}</span>
                        <span className="font-medium text-slate-500 tabular-nums">{money(b.spent, cur)} / {money(b.amount, cur)}</span></div>
                      <ProgressBar value={b.used_pct} status={b.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : <EmptyState icon={PiggyBank} title="No budgets yet" message="Set monthly limits to track your spending."
            action={<Link to="/budgets"><Button variant="secondary">Create a budget</Button></Link>} />}
        </Card>
        <Card title="Recent transactions" bodyClass="pt-2 pb-1"
          action={<Link to="/transactions" className="link text-sm">View all</Link>}>
          {data.recent_transactions.length ? (
            <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
              {data.recent_transactions.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Avatar name={t.category?.name || t.description} color={t.category?.color} />
                  <div className="min-w-0 flex-1"><p className="truncate font-bold text-ink-soft dark:text-slate-100">{t.description || t.category?.name || "Transaction"}</p>
                    <p className="text-xs text-slate-500">{shortDate(t.date)} · {t.category?.name || "Uncategorized"}</p></div>
                  <span className={`font-extrabold tabular-nums ${t.kind === "income" ? "text-fresh-600 dark:text-emerald-400" : "text-ink-soft dark:text-slate-100"}`}>
                    {t.kind === "income" ? "+" : "−"}{money(t.amount, cur)}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No transactions yet" />}
          {data.goals.active > 0 && (
            <Link to="/goals" className="mx-5 mt-2 mb-4 flex items-center gap-3 rounded-2xl bg-brand-50 px-4 py-3 text-sm transition hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/15">
              <Target className="size-5 text-brand-600 dark:text-brand-400" aria-hidden />
              <span className="flex-1"><b className="text-ink dark:text-white">{data.goals.active} active goal{data.goals.active > 1 ? "s" : ""}</b>
                <span className="text-slate-600 dark:text-slate-300"> · {money(data.goals.saved, cur)} saved of {money(data.goals.target, cur)}</span></span>
              <ChevronRight className="size-4 text-brand-600" aria-hidden />
            </Link>
          )}
        </Card>
      </div>

      <Card title="Yearly overview" className="mt-5">
        {yearly.length ? <SavingsBars data={yearly} currency={cur} /> : <EmptyState title="No data yet" />}
      </Card>
      {form}
    </>
  );
}
