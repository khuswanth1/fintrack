const formatters = new Map();

export function money(value, currency = "USD", { compact = false } = {}) {
  const n = Number(value ?? 0);
  const key = `${currency}-${compact}`;
  if (!formatters.has(key)) {
    try {
      formatters.set(key, new Intl.NumberFormat(undefined, {
        style: "currency", currency, maximumFractionDigits: compact ? 1 : 2,
        notation: compact ? "compact" : "standard",
      }));
    } catch {
      formatters.set(key, { format: (x) => `${currency} ${x.toFixed(2)}` });
    }
  }
  return formatters.get(key).format(Number.isFinite(n) ? n : 0);
}

export function pct(value, digits = 1) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(digits)}%`;
}

export function shortDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function relativeTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
