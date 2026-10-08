import { useState } from "react";
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { api, downloadFile } from "../lib/api.js";
import { money, shortDate } from "../lib/format.js";
import { useApi, useDebounced } from "../hooks/useApi.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Pagination, Spinner } from "../components/ui.jsx";
import TransactionForm from "../components/TransactionForm.jsx";

const INITIAL = { kind: "", category_id: "", date_from: "", date_to: "", sort: "date", order: "desc" };
const KINDS = [["", "All"], ["income", "Income"], ["expense", "Expenses"]];

function ImportDialog({ open, onClose, onDone }) {
  const { notify } = useToast();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setFile(null); setResult(null); onClose(); };

  const upload = async () => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify("File is larger than 5 MB", "error"); return; }
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      const r = await api("/transactions/import", { method: "POST", body: fd });
      setResult(r);
      notify(`Imported ${r.imported} transaction${r.imported === 1 ? "" : "s"}`);
      onDone();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Import transactions"
      footer={result ? <Button onClick={close}>Done</Button>
        : <><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={upload} loading={busy} disabled={!file}>Import</Button></>}>
      {result ? (
        <div className="space-y-3 text-sm">
          <p><Badge color="green">{result.imported} imported</Badge> {result.skipped > 0 && <Badge color="amber">{result.skipped} skipped</Badge>}</p>
          {result.errors.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-2xl bg-slate-50 p-3 text-xs dark:bg-white/5">
              {result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600 dark:text-slate-300">Upload a <b>.csv</b> or <b>.xlsx</b> file (max 5 MB) with columns
            <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-white/10">date, kind, amount, category, description, notes</code>.
            Negative amounts without a kind are treated as expenses.</p>
          <button type="button" className="link"
            onClick={() => downloadFile("/transactions/import/template", null, "fintrack-import-template.csv")}>Download template</button>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/50 p-6 text-center transition hover:border-brand-400 dark:border-brand-500/30 dark:bg-brand-500/5">
            <span className="grid size-12 place-items-center rounded-full bg-white shadow-soft dark:bg-white/10"><Upload className="size-5 text-brand-500" /></span>
            <span className="font-bold">{file ? file.name : "Choose a file"}</span>
            <input type="file" accept=".csv,.xlsx" className="sr-only" aria-label="Import file" onChange={(e) => setFile(e.target.files[0] || null)} />
          </label>
        </div>
      )}
    </Modal>
  );
}

export default function Transactions() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [filters, setFilters] = useState(INITIAL);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const search = useDebounced(q);
  const params = { ...filters, q: search, page, size: 20 };
  const { data, loading, error, reload } = useApi("/transactions", params, { live: true });
  const { data: categories } = useApi("/categories");
  const cur = user?.currency || "USD";

  const update = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const sortBy = (col) => { setFilters((f) => ({ ...f, sort: col, order: f.sort === col && f.order === "desc" ? "asc" : "desc" })); setPage(1); };
  const active = Object.entries(filters).some(([k, v]) => !["sort", "order"].includes(k) && v) || q;

  const remove = async () => {
    setBusyDelete(true);
    try {
      await api(`/transactions/${deleting.id}`, { method: "DELETE" });
      notify("Transaction deleted");
      setDeleting(null);
      reload();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyDelete(false);
    }
  };

  const exportAs = (format) => {
    const { kind, category_id, date_from, date_to, sort, order } = filters;
    downloadFile("/transactions/export", { format, q: search, kind, category_id, date_from, date_to, sort, order }, `fintrack.${format}`)
      .catch((err) => notify(err.message, "error"));
  };

  const SortHeader = ({ col, children, className = "" }) => (
    <th className={`px-4 py-3 font-bold ${className}`} aria-sort={filters.sort === col ? (filters.order === "asc" ? "ascending" : "descending") : "none"}>
      <button className={`inline-flex items-center gap-1 uppercase hover:text-brand-600 ${filters.sort === col ? "text-brand-600 dark:text-brand-400" : ""}`} onClick={() => sortBy(col)}>
        {children}{filters.sort === col && (filters.order === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader title="Transactions" subtitle="Search, filter and manage your income and expenses"
        actions={<>
          <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="size-4" /> Import</Button>
          <Button variant="secondary" onClick={() => exportAs("csv")}><Download className="size-4" /> CSV</Button>
          <Button variant="secondary" onClick={() => exportAs("xlsx")}><FileSpreadsheet className="size-4" /> Excel</Button>
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="size-4" /> Add</Button>
        </>} />

      <Card bodyClass="p-0">
        <div className="space-y-3 border-b border-dashed border-slate-200 p-4 dark:border-white/10">
          <div className="relative">
            <Search className="absolute top-3 left-3.5 size-4 text-slate-400" aria-hidden />
            <input className="input rounded-2xl bg-slate-50 pl-10 dark:bg-white/5" placeholder="Search description or notes" aria-label="Search transactions"
              value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto" role="radiogroup" aria-label="Filter by type">
            {KINDS.map(([value, label]) => (
              <button key={label} type="button" role="radio" aria-checked={filters.kind === value} className="chip"
                onClick={() => update("kind")({ target: { value } })}>{label}</button>
            ))}
            {active && <button className="link ml-auto shrink-0 px-2 text-sm" onClick={() => { setFilters(INITIAL); setQ(""); setPage(1); }}>Clear filters</button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
          <select className="input" aria-label="Filter by category" value={filters.category_id} onChange={update("category_id")}>
            <option value="">All categories</option>
            {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
          </select>
          <input type="date" className="input" aria-label="From date" value={filters.date_from} onChange={update("date_from")} />
          <input type="date" className="input" aria-label="To date" value={filters.date_to} onChange={update("date_to")} />
          </div>
        </div>

        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <Spinner />
            : data.items.length === 0 ? (
              <EmptyState title={active ? "No matching transactions" : "No transactions yet"}
                message={active ? "Try different filters or search terms." : "Add one manually or import a CSV/Excel file."}
                action={!active && <Button onClick={() => setFormOpen(true)}><Plus className="size-4" /> Add transaction</Button>} />
            ) : (
              <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] tracking-wide text-slate-500 uppercase">
                    <tr>
                      <SortHeader col="date" className="hidden sm:table-cell">Date</SortHeader>
                      <SortHeader col="description">Description</SortHeader>
                      <th className="hidden px-4 py-3 font-bold md:table-cell">Category</th>
                      <SortHeader col="amount" className="text-right">Amount</SortHeader>
                      <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dashed divide-slate-200 border-t border-dashed border-slate-200 dark:divide-white/10 dark:border-white/10">
                    {data.items.map((t) => (
                      <tr key={t.id} className="transition hover:bg-brand-50/40 dark:hover:bg-white/[0.03]">
                        <td className="hidden px-4 py-3 text-sm font-medium whitespace-nowrap text-slate-500 sm:table-cell">{shortDate(t.date)}</td>
                        <td className="max-w-[11rem] py-3 pr-2 pl-4 sm:max-w-xs sm:px-4">
                          <div className="flex items-center gap-3">
                            <span className="hidden sm:block"><Avatar name={t.category?.name || t.description} color={t.category?.color} size="sm" /></span>
                            <div className="min-w-0">
                              <p className="truncate font-bold text-ink-soft dark:text-slate-100">{t.description || "—"}</p>
                              <p className="truncate text-xs text-slate-500 md:hidden"><span className="sm:hidden">{shortDate(t.date)} · </span>{t.category?.name || "Uncategorized"}</p>
                              {t.recurring_id && <Badge color="brand">Recurring</Badge>}
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">{t.category ? <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold dark:bg-white/5">
                          <span className="size-2 rounded-full" style={{ background: t.category.color }} />{t.category.name}</span>
                          : <span className="text-xs text-slate-400">Uncategorized</span>}</td>
                        <td className={`px-2 py-3 text-right font-extrabold whitespace-nowrap tabular-nums sm:px-4 ${t.kind === "income" ? "text-fresh-600 dark:text-emerald-400" : ""}`}>
                          {t.kind === "income" ? "+" : "−"}{money(t.amount, cur)}</td>
                        <td className="py-3 pr-2 text-right whitespace-nowrap sm:px-4">
                          <button className="rounded-full p-1.5 text-slate-400 sm:p-2 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-white/5"
                            aria-label={`Edit ${t.description || "transaction"}`} onClick={() => { setEditing(t); setFormOpen(true); }}><Pencil className="size-4" /></button>
                          <button className="rounded-full p-1.5 text-slate-400 sm:p-2 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            aria-label={`Delete ${t.description || "transaction"}`} onClick={() => setDeleting(t)}><Trash2 className="size-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
      </Card>

      <TransactionForm open={formOpen} transaction={editing} onClose={() => setFormOpen(false)} onSaved={reload} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />
      <ConfirmDialog open={Boolean(deleting)} title="Delete transaction" loading={busyDelete} onClose={() => setDeleting(null)} onConfirm={remove}
        message={`Delete "${deleting?.description || "this transaction"}" (${deleting ? money(deleting.amount, cur) : ""})? This cannot be undone.`} />
    </>
  );
}
