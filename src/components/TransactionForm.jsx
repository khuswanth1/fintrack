import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { todayISO } from "../lib/format.js";
import { useToast } from "../context/ToastContext.jsx";
import { useApi } from "../hooks/useApi.js";
import { Button, Input, Modal, Select } from "./ui.jsx";

const EMPTY = { kind: "expense", amount: "", date: "", description: "", notes: "", category_id: "" };

export function validateTransaction(f) {
  const errors = {};
  if (!f.amount || !/^\d+(\.\d{1,2})?$/.test(String(f.amount)) || Number(f.amount) <= 0) errors.amount = "Enter a positive amount (max 2 decimals)";
  if (!f.date) errors.date = "Date is required";
  if (f.description.length > 255) errors.description = "Max 255 characters";
  return errors;
}

export default function TransactionForm({ open, onClose, onSaved, transaction }) {
  const { notify } = useToast();
  const { data: categories } = useApi(open ? "/categories" : null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(transaction ? {
      kind: transaction.kind, amount: transaction.amount, date: transaction.date, description: transaction.description,
      notes: transaction.notes || "", category_id: transaction.category?.id ?? "",
    } : { ...EMPTY, date: todayISO() });
  }, [open, transaction]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === "kind" ? { category_id: "" } : {}) }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = validateTransaction(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const body = { ...form, category_id: form.category_id ? Number(form.category_id) : null };
    try {
      await api(transaction ? `/transactions/${transaction.id}` : "/transactions", { method: transaction ? "PATCH" : "POST", body });
      notify(transaction ? "Transaction updated" : "Transaction added");
      onSaved?.();
      onClose();
    } catch (err) {
      setErrors(Object.fromEntries((err.details || []).map((d) => [d.field, d.message])));
      notify(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const options = (categories || []).filter((c) => c.kind === form.kind);
  return (
    <Modal open={open} onClose={onClose} title={transaction ? "Edit transaction" : "New transaction"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="tx-form" loading={saving}>Save</Button></>}>
      <form id="tx-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-white/5" role="radiogroup" aria-label="Type">
          {["expense", "income"].map((k) => (
            <button type="button" key={k} role="radio" aria-checked={form.kind === k} onClick={() => set("kind")({ target: { value: k } })}
              className={`rounded-xl py-2 text-sm font-bold capitalize transition ${form.kind !== k ? "text-slate-500"
                : k === "income" ? "bg-white text-fresh-600 shadow-soft dark:bg-white/10 dark:text-emerald-400"
                  : "bg-white text-brand-600 shadow-soft dark:bg-white/10 dark:text-brand-400"}`}>{k}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Amount" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={set("amount")} error={errors.amount} />
          <Input label="Date" type="date" value={form.date} onChange={set("date")} error={errors.date} />
        </div>
        <Select label="Category" value={form.category_id} onChange={set("category_id")}>
          <option value="">Uncategorized</option>
          {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input label="Description" maxLength={255} value={form.description} onChange={set("description")} error={errors.description} />
        <Input label="Notes" maxLength={2000} value={form.notes} onChange={set("notes")} />
      </form>
    </Modal>
  );
}
