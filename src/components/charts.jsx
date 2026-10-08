import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "../context/ThemeContext.jsx";
import { money, monthLabel } from "../lib/format.js";

const INCOME = "#1ba672";
const EXPENSE = "#f15b5d";
const SAVINGS = "#fc8019";

function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    grid: dark ? "#26272e" : "#eceef2",
    axis: dark ? "#93959f" : "#686b78",
    tooltip: {
      contentStyle: { background: dark ? "#1d1e24" : "#fff", border: "none", borderRadius: 14, fontSize: 12, fontWeight: 600, boxShadow: "0 12px 32px -12px rgb(40 44 63 / 0.35)" },
      labelStyle: { color: dark ? "#fff" : "#02060c", fontWeight: 800 },
    },
  };
}

export function TrendChart({ data, currency }) {
  const t = useChartTheme();
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month), income: +d.income, expense: +d.expense, savings: +d.savings }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {[["inc", INCOME], ["exp", EXPENSE]].map(([id, c]) => (
            <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={c} stopOpacity={0.3} /><stop offset="95%" stopColor={c} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" stroke={t.axis} fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke={t.axis} fontSize={12} tickLine={false} axisLine={false} width={60}
          tickFormatter={(v) => money(v, currency, { compact: true })} />
        <Tooltip {...t.tooltip} formatter={(v) => money(v, currency)} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
        <Area type="monotone" dataKey="income" name="Income" stroke={INCOME} fill="url(#inc)" strokeWidth={2.5} />
        <Area type="monotone" dataKey="expense" name="Expenses" stroke={EXPENSE} fill="url(#exp)" strokeWidth={2.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ProjectionChart({ data, currency }) {
  const t = useChartTheme();
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month) + (d.projected ? "*" : "") }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" stroke={t.axis} fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke={t.axis} fontSize={12} tickLine={false} axisLine={false} width={60}
          tickFormatter={(v) => money(v, currency, { compact: true })} />
        <Tooltip {...t.tooltip} formatter={(v) => money(v, currency)} cursor={{ fill: t.grid, opacity: 0.4 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
        {[["income", "Income", INCOME], ["expenses", "Expenses", EXPENSE], ["savings", "Savings", SAVINGS]].map(([key, name, color]) => (
          <Bar key={key} dataKey={key} name={name} fill={color} radius={[6, 6, 0, 0]} maxBarSize={22}>
            {rows.map((r) => <Cell key={r.month} fill={color} fillOpacity={r.projected ? 0.45 : 1} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryDonut({ data, currency }) {
  const t = useChartTheme();
  const rows = data.map((d) => ({ ...d, amount: +d.amount }));
  return (
    <div className="flex flex-col items-center gap-4 2xl:flex-row">
      <div className="h-52 w-full 2xl:w-1/2">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey="amount" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={3} cornerRadius={6} stroke="none">
              {rows.map((r) => <Cell key={r.name} fill={r.color} />)}
            </Pie>
            <Tooltip {...t.tooltip} formatter={(v) => money(v, currency)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-2 text-sm 2xl:w-1/2">
        {rows.slice(0, 7).map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
            <span className="font-medium text-slate-500 tabular-nums">{r.pct}%</span>
            <span className="min-w-20 text-right font-bold tabular-nums">{money(r.amount, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SavingsBars({ data, currency, xKey = "label" }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} stroke={t.axis} fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke={t.axis} fontSize={12} tickLine={false} axisLine={false} width={60}
          tickFormatter={(v) => money(v, currency, { compact: true })} />
        <Tooltip {...t.tooltip} formatter={(v) => money(v, currency)} cursor={{ fill: t.grid, opacity: 0.4 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 600 }} />
        <Bar dataKey="income" name="Income" fill={INCOME} radius={[6, 6, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expense" name="Expenses" fill={EXPENSE} radius={[6, 6, 0, 0]} maxBarSize={28} />
        <Bar dataKey="savings" name="Savings" fill={SAVINGS} radius={[6, 6, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
