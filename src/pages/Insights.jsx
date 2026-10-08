import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CalendarClock, Lightbulb, LineChart, Receipt, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../lib/api.js";
import { money, shortDate } from "../lib/format.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Skeleton } from "../components/ui.jsx";
import { ProjectionChart } from "../components/charts.jsx";

const PRIORITY = { high: "red", medium: "amber", low: "slate" };
const RISK = { exceeded: "red", high: "red", medium: "amber" };

function HealthScore({ score, breakdown = [] }) {
  const color = score >= 70 ? "text-fresh-600 dark:text-emerald-400" : score >= 45 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  const label = score >= 70 ? "Healthy" : score >= 45 ? "Fair" : "Needs attention";
  return (
    <div className="w-full">
      <div className="text-center">
        <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">Financial health</p>
        <p className={`mt-1 text-6xl font-extrabold tracking-tight ${color}`}>{score}</p>
        <p className="mt-2 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-ink-soft dark:bg-white/5 dark:text-slate-200">{label}</p>
      </div>
      {breakdown.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-dashed border-slate-200 pt-3 text-xs dark:border-white/10" aria-label="How the score is calculated">
          {breakdown.map((f) => (
            <li key={f.label} className="flex justify-between gap-2">
              <span className="text-slate-500">{f.label}</span>
              <span className={`font-bold tabular-nums ${f.points > 0 && f.label !== "Starting point" ? "text-fresh-600 dark:text-emerald-400" : f.points < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                {f.label === "Starting point" ? f.points : `${f.points > 0 ? "+" : ""}${f.points}`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The shaded footer each section uses for its forward look. */
function ProjectionNote({ children }) {
  return (
    <div className="flex items-start gap-2 border-t border-slate-100 bg-brand-50/50 px-5 py-3 text-xs text-slate-600 dark:border-white/10 dark:bg-brand-500/5 dark:text-slate-300">
      <LineChart className="mt-0.5 size-3.5 shrink-0 text-brand-500" aria-hidden /><p>{children}</p>
    </div>
  );
}

function dueLabel(days) {
  if (days < 0) return `expected ${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "due today";
  return `due in ${days} day${days === 1 ? "" : "s"}`;
}

function RecurringList({ title, items, cur, empty }) {
  const total = items.reduce((a, s) => a + s.monthly_amount, 0);
  const due = items.filter((s) => s.due_this_month);
  const dueTotal = due.reduce((a, s) => a + s.monthly_amount, 0);
  return (
    <Card title={title} bodyClass="p-0"
      action={items.length > 0 && <span className="text-xs text-slate-500"><b className="text-ink dark:text-white">{money(total, cur)}</b>/mo · {money(total * 12, cur)}/yr</span>}>
      {items.length ? (
        <>
          <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
            {items.map((s) => (
              <li key={s.description} className="flex justify-between gap-3 px-5 py-3 text-sm">
                <span className="min-w-0"><span className="block truncate">{s.description}</span>
                  <span className="text-xs text-slate-500">{s.category} · last {shortDate(s.last_charged)}</span>
                  {s.next_expected && <span className={`block text-xs font-medium ${s.due_this_month ? "text-brand-600 dark:text-brand-400" : "text-slate-500"}`}>
                    Next {shortDate(s.next_expected)} · {dueLabel(s.due_in_days)}</span>}</span>
                <span className="text-right whitespace-nowrap"><b>{money(s.monthly_amount, cur)}</b><span className="block text-xs text-slate-500">{money(s.annual_cost, cur)}/yr</span></span>
              </li>
            ))}
          </ul>
          {items[0].next_expected && (
            <ProjectionNote>
              {due.length ? <><b>{money(dueTotal, cur)}</b> still to be charged this month ({due.length} of {items.length}). </> : "Nothing more due this month. "}
              Over the next 12 months these will cost about <b>{money(total * 12, cur)}</b>.
            </ProjectionNote>
          )}
        </>
      ) : <EmptyState title={empty} />}
    </Card>
  );
}

function WhereMoneyGoes({ items, cur }) {
  const projected = items.filter((c) => c.projected_month_end != null);
  return (
    <Card title="Where your money goes" action={<span className="text-xs text-slate-500">Avg month vs this month</span>} bodyClass="p-0">
      {items.length ? (
        <>
          <ul className="space-y-3 p-5 text-sm">
            {items.map((c) => {
              const avg = c.three_month_total / 3;
              const diff = c.projected_month_end != null && avg ? ((c.projected_month_end - avg) / avg) * 100 : null;
              return (
                <li key={c.category}>
                  <div className="mb-1 flex justify-between gap-2"><span className="font-medium">{c.category}</span>
                    <span className="tabular-nums"><b>{money(avg, cur)}</b><span className="text-xs text-slate-500">/mo · {c.share_pct}%</span></span></div>
                  <ProgressBar value={c.share_pct} />
                  {c.projected_month_end != null && (
                    <p className="mt-1 text-xs text-slate-500">This month: <b className="text-ink dark:text-white">{money(c.projected_month_end, cur)}</b> projected
                      {diff != null && Math.abs(diff) >= 5 && <span className={diff > 0 ? "text-red-600 dark:text-red-400" : "text-fresh-600 dark:text-emerald-400"}> ({diff > 0 ? "+" : ""}{Math.round(diff)}%)</span>}</p>
                  )}
                </li>
              );
            })}
          </ul>
          {projected.length > 0 && (
            <ProjectionNote>These categories are on track for <b>{money(projected.reduce((a, c) => a + c.projected_month_end, 0), cur)}</b> this month,
              against a usual <b>{money(projected.reduce((a, c) => a + c.three_month_total / 3, 0), cur)}</b>.</ProjectionNote>
          )}
        </>
      ) : <EmptyState title="No spending history yet" />}
    </Card>
  );
}

function Projection({ p, cur }) {
  const vs = p.expenses_vs_typical_pct;
  return (
    <Card className="mt-6" title={<span className="inline-flex items-center gap-2"><LineChart className="size-4 text-brand-500" /> Spending projection</span>}
      action={<span className="text-xs text-slate-500">{p.days_left} days left this month</span>}>
      <div className="grid grid-cols-2 gap-3 text-center text-sm md:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5"><p className="text-xs font-bold text-slate-500 uppercase">Month-end income</p>
          <p className="mt-1 font-extrabold">{money(p.projected_income, cur)}</p><p className="text-xs text-slate-500">{money(p.income_so_far, cur)} so far</p></div>
        <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5"><p className="text-xs font-bold text-slate-500 uppercase">Month-end expenses</p>
          <p className="mt-1 font-extrabold">{money(p.projected_expenses, cur)}</p>
          <p className={`text-xs ${vs > 0 ? "text-red-600 dark:text-red-400" : "text-slate-500"}`}>
            {vs == null ? `${money(p.expenses_so_far, cur)} so far` : `${vs > 0 ? "+" : ""}${Math.round(vs)}% vs typical`}</p></div>
        <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5"><p className="text-xs font-bold text-slate-500 uppercase">Month-end savings</p>
          <p className={`mt-1 font-extrabold ${p.projected_savings < 0 ? "text-red-600 dark:text-red-400" : "text-fresh-600 dark:text-emerald-400"}`}>{money(p.projected_savings, cur)}</p></div>
        <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5"><p className="text-xs font-bold text-slate-500 uppercase">Next 3 months</p>
          <p className={`mt-1 font-extrabold ${p.next_months_savings < 0 ? "text-red-600 dark:text-red-400" : "text-fresh-600 dark:text-emerald-400"}`}>{money(p.next_months_savings, cur)}</p>
          <p className="text-xs text-slate-500">projected savings</p></div>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2"><ProjectionChart data={p.months} currency={cur} /></div>
        <div>
          <p className="mb-2 text-xs font-bold tracking-wide text-slate-500 uppercase">Categories at month end</p>
          <ul className="space-y-2 text-sm">
            {p.categories.slice(0, 6).map((c) => (
              <li key={c.category} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{c.category}</span>
                {c.change_pct != null && <span className={`text-xs ${c.change_pct > 0 ? "text-red-600 dark:text-red-400" : "text-fresh-600 dark:text-emerald-400"}`}>{c.change_pct > 0 ? "+" : ""}{Math.round(c.change_pct)}%</span>}
                <span className="min-w-20 text-right font-bold tabular-nums">{money(c.projected_month_end, cur)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        * Projected. {p.based_on_months ? `Based on your last ${p.based_on_months} month${p.based_on_months > 1 ? "s" : ""}: what you've spent so far plus what you usually spend in the rest of the month.` : "Not enough history yet, so this extends your current pace."}
      </p>
    </Card>
  );
}

export default function Insights() {
  const { user } = useAuth();
  const { notify } = useToast();
  const { data, loading, error, reload, setData } = useApi("/insights");
  const [refreshing, setRefreshing] = useState(false);
  const cur = user?.currency || "USD";

  const refresh = async () => {
    setRefreshing(true);
    try { setData(await api("/insights/refresh", { method: "POST" })); notify("Insights refreshed"); }
    catch (err) { notify(err.message, "error"); }
    finally { setRefreshing(false); }
  };

  const header = (
    <PageHeader title="AI insights" subtitle={`Patterns, risks and opportunities detected in your transactions${data?.as_of ? ` · as of ${shortDate(data.as_of)}` : ""}`}
      actions={<Button variant="secondary" onClick={refresh} loading={refreshing}><RefreshCw className="size-4" /> Refresh</Button>} />
  );
  if (error) return <>{header}<Card><ErrorState error={error} onRetry={reload} /></Card></>;
  if (loading && !data) return <>{header}<div className="grid gap-4 lg:grid-cols-3" aria-busy="true"><Skeleton className="h-48 lg:col-span-2" /><Skeleton className="h-48" /><Skeleton className="h-64 lg:col-span-3" /></div></>;
  if (data.data_points === 0) return <>{header}<Card><EmptyState icon={Sparkles} title="Not enough data yet" message="Add or import a few weeks of transactions and FinTrack will start finding patterns." /></Card></>;

  const n = data.narrative;
  const p = data.spending_patterns;
  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-brand-500" /> Summary</span>}
          action={<Badge color={n.source === "ai" ? "brand" : "slate"}>{n.source === "ai" ? "AI-generated" : "Rule-based"}</Badge>}>
          <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{n.summary}</p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
            <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5"><p className="text-xs font-bold text-slate-500 uppercase">Avg income</p><p className="mt-1 font-extrabold">{money(data.avg_monthly_income, cur)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5"><p className="text-xs font-bold text-slate-500 uppercase">Avg expenses</p><p className="mt-1 font-extrabold">{money(data.avg_monthly_expenses, cur)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5"><p className="text-xs font-bold text-slate-500 uppercase">Savings rate</p><p className="mt-1 font-extrabold">{data.savings_rate_3m}%</p></div>
          </div>
        </Card>
        <Card bodyClass="p-5 flex h-full items-center justify-center"><HealthScore score={data.health_score} breakdown={data.health_breakdown} /></Card>
      </div>

      {data.projection && <Projection p={data.projection} cur={cur} />}

      <Card className="mt-6" title={<span className="inline-flex items-center gap-2"><Lightbulb className="size-4 text-amber-500" /> Recommendations</span>} bodyClass="p-0">
        <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
          {n.recommendations.map((r, i) => (
            <li key={i} className="flex gap-3 px-5 py-4">
              <Badge color={PRIORITY[r.priority]}>{r.priority}</Badge>
              <div className="flex-1"><p className="font-bold">{r.title}</p><p className="text-sm text-slate-600 dark:text-slate-400">{r.detail}</p></div>
              {r.estimated_monthly_saving > 0 && <p className="text-right text-sm font-medium whitespace-nowrap text-fresh-600 dark:text-emerald-400">≈ {money(r.estimated_monthly_saving, cur)}/mo</p>}
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-2"><AlertTriangle className="size-4 text-red-500" /> Budget risks</span>} bodyClass="p-0"
          action={<Link to="/budgets" className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline dark:text-brand-400">Manage budgets <ArrowRight className="size-3" /></Link>}>
          {data.budget_risks.length ? (
            <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
              {data.budget_risks.map((r) => (
                <li key={r.category} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="font-medium">{r.category}</p>
                      <p className="text-xs text-slate-500">{money(r.spent, cur)} spent · forecast {money(r.projected_month_end, cur)} of {money(r.limit, cur)}</p></div>
                    <Badge color={RISK[r.risk]}>{r.risk === "exceeded" ? "Exceeded" : `${Math.round(r.projected_pct)}% forecast`}</Badge>
                  </div>
                  <div className="mt-2"><ProgressBar value={r.used_pct} status={r.risk === "exceeded" ? "exceeded" : "warning"} /></div>
                  <p className="mt-1 text-xs text-slate-500">
                    {r.risk === "exceeded" ? `${money(r.over_by, cur)} over the limit` : `Keep to about ${money(r.daily_allowance_left, cur)}/day to stay within budget`}</p>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No budget risks" message="All budgets are on track for this month."
                action={<Link to="/budgets" className="text-sm font-bold text-brand-600 hover:underline dark:text-brand-400">Review budgets</Link>} />}
        </Card>
        <Card title="Unusual transactions" bodyClass="p-0">
          {data.unusual_transactions.length ? (
            <>
              <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
                {data.unusual_transactions.map((a) => (
                  <li key={a.transaction_id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0"><p className="truncate font-medium">{a.description || a.category}</p>
                      <p className="text-xs text-slate-500">{shortDate(a.date)} · {a.category} · usually ~{money(a.typical_amount, cur)}</p></div>
                    <div className="text-right"><p className="font-semibold">{money(a.amount, cur)}</p>
                      {a.excess != null ? <p className="text-xs text-amber-600">+{money(a.excess, cur)} above usual</p>
                        : a.times_typical && <p className="text-xs text-amber-600">{a.times_typical}× typical</p>}</div>
                  </li>
                ))}
              </ul>
              {data.projection?.unusual_excess_this_month != null && (
                <ProjectionNote>
                  {data.projection.unusual_excess_this_month > 0
                    ? <>This month&apos;s unusual charges add <b>{money(data.projection.unusual_excess_this_month, cur)}</b> to your projected spending. Without them you&apos;d end the month at about <b>{money(data.projection.expenses_without_unusual, cur)}</b> instead of {money(data.projection.projected_expenses, cur)}.</>
                    : <>None of these fall in this month, so they don&apos;t affect this month&apos;s projection of <b>{money(data.projection.projected_expenses, cur)}</b>.</>}
                </ProjectionNote>
              )}
            </>
          ) : <EmptyState title="Nothing unusual" message="No outlier transactions in the last 45 days." />}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <WhereMoneyGoes items={p.top_categories} cur={cur} />
        <Card title="Spending trends (month to date)" bodyClass="p-0">
          {p.trends.length ? (
            <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
              {p.trends.map((t) => (
                <li key={t.category} className="flex items-start gap-3 px-5 py-3 text-sm">
                  {t.direction === "up" ? <TrendingUp className="mt-0.5 size-4 text-red-500" /> : <TrendingDown className="mt-0.5 size-4 text-emerald-500" />}
                  <span className="min-w-0 flex-1">{t.category}
                    <span className="block text-xs text-slate-500">{money(t.month_to_date, cur)} so far vs {money(t.typical_by_this_date, cur)} usual by now</span>
                    {t.projected_month_end != null && <span className="block text-xs text-slate-500">Month end ≈ <b className="text-ink dark:text-white">{money(t.projected_month_end, cur)}</b> (usual {money(t.typical_month, cur)})</span>}</span>
                  <span className={t.direction === "up" ? "text-red-600 dark:text-red-400" : "text-fresh-600 dark:text-emerald-400"}>{t.change_pct > 0 ? "+" : ""}{Math.round(t.change_pct)}%</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Spending is steady" />}
          {p.trends.some((t) => t.projected_month_end != null) && (() => {
            const net = p.trends.reduce((a, t) => a + (t.projected_month_end - t.typical_month), 0);
            return <ProjectionNote>If these trends hold, these categories will end the month <b>{money(Math.abs(net), cur)} {net >= 0 ? "above" : "below"}</b> a usual month.</ProjectionNote>;
          })()}
          {p.busiest_weekday && <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-white/10">You spend the most on {p.busiest_weekday}s.</p>}
        </Card>
        <Card title="Savings opportunities" bodyClass="p-0">
          {data.savings_opportunities.length ? (
            <>
              <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
                {data.savings_opportunities.map((o, i) => (
                  <li key={i} className="px-5 py-3 text-sm"><p>{o.detail}</p>
                    <p className="mt-0.5 text-xs font-medium text-fresh-600 dark:text-emerald-400">Potential: {money(o.monthly_saving, cur)}/month · {money(o.monthly_saving * 12, cur)}/year</p></li>
                ))}
              </ul>
              {(() => {
                // Two opportunities can target the same category (e.g. a rising trend and a 15% trim), so count only the larger one.
                const best = {};
                // The savings-rate item is a target, not an extra saving, so it's left out of the total.
                for (const o of data.savings_opportunities.filter((x) => x.type !== "savings_rate")) best[o.category] = Math.max(best[o.category] || 0, o.monthly_saving);
                const monthly = Object.values(best).reduce((a, v) => a + v, 0);
                const base = data.projection?.next_months_savings;
                return (
                  <ProjectionNote>Acting on these could save up to <b>{money(monthly, cur)}/month</b> ({money(monthly * 12, cur)}/year).
                    {base != null && <> Your projected savings for the next 3 months would rise from {money(base, cur)} to <b>{money(base + monthly * 3, cur)}</b>.</>}</ProjectionNote>
                );
              })()}
            </>
          ) : <EmptyState title="No obvious savings found" />}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <RecurringList title={<span className="inline-flex items-center gap-2"><CalendarClock className="size-4" /> Subscriptions</span>}
          items={data.subscriptions} cur={cur} empty="No subscriptions detected" />
        <RecurringList title={<span className="inline-flex items-center gap-2"><Receipt className="size-4" /> Recurring bills</span>}
          items={data.recurring_bills || []} cur={cur} empty="No recurring bills detected" />
      </div>
      <p className="mt-6 text-xs text-slate-500">Insights are generated from your own transaction data for budgeting purposes only and are not professional financial advice.</p>
    </>
  );
}
