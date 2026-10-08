import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { useToast } from "../context/ToastContext.jsx";
import { Button, Card, ConfirmDialog, ErrorState, PageHeader, Spinner } from "../components/ui.jsx";

export default function Categories() {
  const { notify } = useToast();
  const { data, loading, error, reload } = useApi("/categories");
  const [form, setForm] = useState({ name: "", kind: "expense", color: "#6366f1" });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api("/categories", { method: "POST", body: { ...form, name: form.name.trim() } });
      notify("Category added");
      setForm({ ...form, name: "" });
      reload();
    } catch (err) { notify(err.message, "error"); } finally { setSaving(false); }
  };
  const recolor = async (c, color) => {
    try { await api(`/categories/${c.id}`, { method: "PATCH", body: { color } }); reload(); } catch (err) { notify(err.message, "error"); }
  };
  const remove = async () => {
    try { await api(`/categories/${deleting.id}`, { method: "DELETE" }); notify("Category deleted"); setDeleting(null); reload(); }
    catch (err) { notify(err.message, "error"); }
  };

  const group = (kind) => (data || []).filter((c) => c.kind === kind);
  return (
    <>
      <PageHeader title="Categories" subtitle="Organise transactions the way you think about money" />
      <Card className="mb-6">
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1"><label className="label" htmlFor="cat-name">Name</label>
            <input id="cat-name" className="input" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pets" /></div>
          <div><label className="label" htmlFor="cat-kind">Type</label>
            <select id="cat-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="expense">Expense</option><option value="income">Income</option></select></div>
          <div><label className="label" htmlFor="cat-color">Color</label>
            <input id="cat-color" type="color" className="h-9 w-14 cursor-pointer rounded-lg border border-slate-300 dark:border-white/10" value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
          <Button type="submit" loading={saving}><Plus className="size-4" /> Add</Button>
        </form>
      </Card>
      {error ? <Card><ErrorState error={error} onRetry={reload} /></Card> : loading && !data ? <Spinner /> : (
        <div className="grid gap-6 md:grid-cols-2">
          {["expense", "income"].map((kind) => (
            <Card key={kind} title={kind === "expense" ? "Expense categories" : "Income categories"} bodyClass="p-0">
              <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
                {group(kind).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <input type="color" aria-label={`Color for ${c.name}`} className="size-6 cursor-pointer rounded border-0 bg-transparent" defaultValue={c.color}
                      onBlur={(e) => e.target.value !== c.color && recolor(c, e.target.value)} />
                    <span className="flex-1">{c.name}</span>
                    <button className="rounded p-1 text-slate-400 hover:text-red-600" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2 className="size-4" /></button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog open={Boolean(deleting)} title="Delete category" onClose={() => setDeleting(null)} onConfirm={remove}
        message={`Delete "${deleting?.name}"? Its transactions become uncategorized and any budget on it is removed.`} />
    </>
  );
}
