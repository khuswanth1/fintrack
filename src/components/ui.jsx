import { useEffect, useId, useRef } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from "lucide-react";

const cx = (...c) => c.filter(Boolean).join(" ");

const BUTTON = {
  primary: "bg-brand-500 text-white shadow-cta hover:bg-brand-600 active:bg-brand-700",
  secondary: "bg-white text-ink-soft ring-1 ring-slate-200 ring-inset hover:bg-slate-50 hover:ring-slate-300 dark:bg-white/5 dark:text-slate-100 dark:ring-white/10 dark:hover:bg-white/10",
  ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-500",
};

export function Button({ variant = "primary", size = "md", loading, className, children, ...props }) {
  return (
    <button
      className={cx("inline-flex items-center justify-center gap-2 rounded-xl font-bold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100",
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4.5 py-2.5 text-sm", BUTTON[variant], className)}
      disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, id }) {
  return (
    <div>
      {label && <label htmlFor={id} className="label">{label}</label>}
      {children}
      {error ? <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400" role="alert">{error}</p>
        : hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Input({ label, error, hint, className, ...props }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} id={id}>
      <input id={id} className={cx("input", error && "border-red-500 focus:border-red-500 focus:ring-red-500/15", className)} aria-invalid={Boolean(error)} {...props} />
    </Field>
  );
}

export function Select({ label, error, children, className, ...props }) {
  const id = useId();
  return (
    <Field label={label} error={error} id={id}>
      <select id={id} className={cx("input", className)} {...props}>{children}</select>
    </Field>
  );
}

export function Card({ title, action, className, children, bodyClass = "p-5" }) {
  return (
    <section className={cx("card", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-1">
          <h2 className="text-base font-extrabold tracking-tight">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

const BADGE = {
  green: "bg-emerald-50 text-fresh-600 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300",
  red: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  brand: "bg-brand-50 text-brand-700 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-300",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/10 dark:bg-white/5 dark:text-slate-300",
};

export function Badge({ color = "slate", children }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center self-start rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide whitespace-nowrap capitalize ring-1 ring-inset",
      BADGE[color] || BADGE.slate)}>{children}</span>
  );
}

/** Round category avatar, like the cuisine bubbles in a food-delivery app. */
export function Avatar({ name, color = "#94a3b8", size = "md" }) {
  const dims = size === "lg" ? "size-16 text-xl" : size === "sm" ? "size-8 text-xs" : "size-10 text-sm";
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-full font-extrabold", dims)}
      style={{ background: `${color}22`, color, boxShadow: `inset 0 0 0 1.5px ${color}40` }} aria-hidden>
      {(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm font-medium text-slate-500" role="status">
      <Loader2 className="size-5 animate-spin text-brand-500" aria-hidden /> {label}
    </div>
  );
}

export function Skeleton({ className }) {
  return (
    <div className={cx("animate-shimmer rounded-3xl bg-[length:200%_100%] bg-gradient-to-r from-slate-200/70 via-slate-100 to-slate-200/70 dark:from-white/5 dark:via-white/10 dark:to-white/5", className)} />
  );
}

export function EmptyState({ title = "Nothing here yet", message, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 grid size-16 place-items-center rounded-full bg-brand-50 dark:bg-brand-500/10">
        <Icon className="size-7 text-brand-500" aria-hidden />
      </div>
      <p className="text-base font-extrabold text-ink dark:text-white">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center" role="alert">
      <div className="mb-3 grid size-14 place-items-center rounded-full bg-red-50 dark:bg-red-500/10"><AlertCircle className="size-7 text-red-500" aria-hidden /></div>
      <p className="font-extrabold text-ink dark:text-white">Something went wrong</p>
      <p className="mt-1 text-sm text-slate-500">{error?.message || "Please try again."}</p>
      {onRetry && <Button variant="secondary" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function ProgressBar({ value, status }) {
  const color = status === "exceeded" ? "bg-red-500" : status === "warning" ? "bg-amber-400"
    : status === "ok" ? "bg-fresh-500" : "bg-gradient-to-r from-brand-400 to-brand-600";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10" role="progressbar"
      aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = "md" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector("input,select,textarea,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  // A bottom sheet on phones, a centred dialog from `sm` up.
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/55 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={cx("max-h-[92vh] w-full animate-sheet overflow-y-auto rounded-t-3xl bg-white shadow-lift sm:rounded-3xl dark:bg-[#16171c] dark:ring-1 dark:ring-white/10",
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200 sm:hidden dark:bg-white/15" aria-hidden />
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10"><X className="size-4" /></button>
        </div>
        <div className="px-5 pb-5">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-dashed border-slate-200 bg-white px-5 py-4 dark:border-white/10 dark:bg-[#16171c]">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Delete", onConfirm, onClose, loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
    </Modal>
  );
}

export function Pagination({ page, pages, total, onChange }) {
  if (!pages || pages <= 1) return <p className="px-5 py-3.5 text-xs font-medium text-slate-500">{total ?? 0} result{total === 1 ? "" : "s"}</p>;
  return (
    <nav className="flex items-center justify-between px-5 py-3 text-sm" aria-label="Pagination">
      <span className="text-xs font-medium text-slate-500">Page {page} of {pages} · {total} results</span>
      <div className="flex gap-1.5">
        <Button variant="secondary" size="sm" className="rounded-full" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
        <Button variant="secondary" size="sm" className="rounded-full" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
      </div>
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-sm font-bold text-brand-600 dark:text-brand-400">{eyebrow}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STAT_TINT = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400",
  green: "bg-emerald-50 text-fresh-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  red: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300",
};

export function StatCard({ label, value, delta, deltaGoodWhenUp = true, icon: Icon, hint, tint = "brand" }) {
  const hasDelta = delta !== null && delta !== undefined;
  const good = hasDelta && (delta >= 0) === deltaGoodWhenUp;
  return (
    <div className="card p-5 transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex items-center gap-3">
        {Icon && <span className={cx("grid size-10 place-items-center rounded-2xl", STAT_TINT[tint] || STAT_TINT.brand)}><Icon className="size-5" aria-hidden /></span>}
        <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">{label}</p>
      </div>
      <p className="mt-3 truncate text-2xl font-extrabold tracking-tight text-ink tabular-nums dark:text-white">{value}</p>
      <p className="mt-1.5 h-5 text-xs">
        {hasDelta ? <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold",
          good ? "bg-emerald-50 text-fresh-600 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400")}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs last month</span>
          : <span className="font-medium text-slate-400">{hint}</span>}
      </p>
    </div>
  );
}

export { cx };
