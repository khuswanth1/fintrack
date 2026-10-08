import { createContext, useCallback, useContext, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, X } from "lucide-react";

const STYLES = {
  // Dark "snackbar" toasts, as in food-delivery apps; the icon carries the colour.
  success: "bg-ink-soft text-white [&>svg:first-child]:text-emerald-400 dark:bg-[#1d1e24]",
  error: "bg-red-600 text-white",
  info: "bg-ink-soft text-white [&>svg:first-child]:text-brand-400 dark:bg-[#1d1e24]",
};
const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Bell };

const ToastContext = createContext({ notify: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((message, type = "success") => {
    const id = crypto.randomUUID?.() ?? String(Math.random());
    setToasts((t) => [...t.slice(-3), { id, message, type }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end lg:bottom-6" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || CheckCircle2;
          return (
            <div key={t.id} role="status"
              className={`pointer-events-auto flex w-full max-w-sm animate-sheet items-start gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lift dark:ring-1 dark:ring-white/10 ${STYLES[t.type] || STYLES.success}`}>
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="opacity-70 hover:opacity-100"><X className="size-4" /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
