import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, KeyRound, Plus, Power, RotateCcw, Send, Trash2, Webhook } from "lucide-react";
import { api } from "../lib/api.js";
import { relativeTime } from "../lib/format.js";
import { useApi } from "../hooks/useApi.js";
import { useToast } from "../context/ToastContext.jsx";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, Spinner } from "../components/ui.jsx";

const STATUS_COLOR = { success: "green", failed: "red", retrying: "amber", pending: "slate" };

function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy} aria-label={label}>
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : label}
    </Button>
  );
}

function SecretModal({ secret, onClose }) {
  return (
    <Modal open={Boolean(secret)} onClose={onClose} title="Signing secret"
      footer={<Button onClick={onClose}>I've saved it</Button>}>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        Copy this secret now. It won't be shown again. Use it to verify the <code className="text-xs">X-FinTrack-Signature</code> header on every request.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs dark:bg-white/5">{secret}</code>
        <CopyButton value={secret || ""} />
      </div>
    </Modal>
  );
}

function EndpointForm({ open, onClose, onCreated, eventTypes }) {
  const [form, setForm] = useState({ url: "", description: "", events: ["*"] });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const all = form.events.includes("*");
  const toggle = (type) => setForm((f) => {
    const without = f.events.filter((e) => e !== "*");
    return { ...f, events: without.includes(type) ? without.filter((e) => e !== type) : [...without, type] };
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.events.length) return setError("Pick at least one event");
    setSaving(true);
    setError(null);
    try {
      const created = await api("/webhooks", { method: "POST", body: form });
      setForm({ url: "", description: "", events: ["*"] });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err.details?.[0]?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add webhook endpoint" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="webhook-form" loading={saving}>Add endpoint</Button></>}>
      <form id="webhook-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Endpoint URL" type="url" placeholder="https://example.com/webhooks/fintrack" required value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })} hint="Must be publicly reachable over HTTPS. We POST JSON to it." />
        <Input label="Description (optional)" maxLength={120} placeholder="e.g. Zapier, my budgeting sheet" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <fieldset>
          <legend className="label">Events to send</legend>
          <label className="mb-2 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={all} onChange={() => setForm({ ...form, events: all ? [] : ["*"] })} /> All events (including future ones)
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {eventTypes.map((t) => (
              <label key={t.type} className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm dark:border-white/10 ${all ? "opacity-50" : ""}`}>
                <input type="checkbox" className="mt-0.5" disabled={all} checked={all || form.events.includes(t.type)} onChange={() => toggle(t.type)} />
                <span><code className="text-xs font-semibold">{t.type}</code><span className="block text-xs text-slate-500">{t.description}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      </form>
    </Modal>
  );
}

function Deliveries({ endpointId }) {
  const { notify } = useToast();
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const { data, loading, error, reload } = useApi(`/webhooks/${endpointId}/deliveries`, { page, size: 10 });

  const redeliver = async (d) => {
    try {
      const r = await api(`/webhooks/${endpointId}/deliveries/${d.id}/redeliver`, { method: "POST" });
      notify(r.status === "success" ? "Redelivered successfully" : "Redelivery queued");
      setTimeout(reload, 800);
    } catch (err) { notify(err.message, "error"); }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data.items.length) return <p className="px-5 py-6 text-center text-sm text-slate-500">No deliveries yet. Send a test event to try it out.</p>;
  return (
    <>
      <ul className="divide-y divide-dashed divide-slate-200 dark:divide-white/10">
        {data.items.map((d) => (
          <li key={d.id} className="text-sm">
            <div className="flex items-center gap-3 px-5 py-2.5">
              <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                aria-expanded={expanded === d.id}>
                {expanded === d.id ? <ChevronDown className="size-4 text-slate-400" /> : <ChevronRight className="size-4 text-slate-400" />}
                <Badge color={STATUS_COLOR[d.status]}>{d.status}</Badge>
                <code className="text-xs">{d.event_type}</code>
                <span className="hidden text-xs text-slate-500 sm:inline">{d.response_status ? `HTTP ${d.response_status}` : d.error ? "no response" : ""}</span>
                <span className="ml-auto text-xs whitespace-nowrap text-slate-400">{relativeTime(d.created_at)}</span>
              </button>
              {d.status !== "pending" && <Button variant="ghost" size="sm" onClick={() => redeliver(d)} aria-label="Redeliver"><RotateCcw className="size-3.5" /></Button>}
            </div>
            {expanded === d.id && (
              <div className="space-y-2 bg-slate-50 px-5 py-3 text-xs dark:bg-white/[0.03]">
                <p className="text-slate-500">
                  Attempts: {d.attempts}{d.duration_ms != null && ` · ${d.duration_ms} ms`}
                  {d.next_attempt_at && d.status === "retrying" && ` · next retry ${relativeTime(d.next_attempt_at)}`} · Event ID <code>{d.event_id}</code>
                </p>
                {d.error && <p className="text-red-600 dark:text-red-400">{d.error}</p>}
                <div><p className="mb-1 font-medium">Payload</p><pre className="max-h-48 overflow-auto rounded bg-white p-2 dark:bg-[#16171c]">{JSON.stringify(d.payload, null, 2)}</pre></div>
                {d.response_body && <div><p className="mb-1 font-medium">Response</p><pre className="max-h-32 overflow-auto rounded bg-white p-2 whitespace-pre-wrap dark:bg-[#16171c]">{d.response_body}</pre></div>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <Pagination page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
    </>
  );
}

function EndpointCard({ endpoint, onChanged, onSecret, onDelete }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (err) { notify(err.message, "error"); } finally { setBusy(null); }
  };
  const test = () => run("test", async () => {
    const d = await api(`/webhooks/${endpoint.id}/test`, { method: "POST" });
    notify(d.status === "success" ? "Test event delivered" : d.status === "failed" ? `Test failed: ${d.error}` : "Test event queued",
      d.status === "failed" ? "error" : "success");
    setOpen(true);
    setTimeout(() => setRefreshKey((k) => k + 1), d.status === "pending" ? 1500 : 0);
  });
  const toggle = () => run("toggle", async () => {
    await api(`/webhooks/${endpoint.id}`, { method: "PATCH", body: { is_active: !endpoint.is_active } });
    onChanged();
  });
  const rotate = () => run("rotate", async () => {
    const r = await api(`/webhooks/${endpoint.id}/rotate-secret`, { method: "POST" });
    onSecret(r.secret);
    onChanged();
  });

  return (
    <Card bodyClass="p-0">
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={endpoint.is_active ? "green" : "red"}>{endpoint.is_active ? "Active" : "Disabled"}</Badge>
            <p className="truncate font-mono text-sm font-medium" title={endpoint.url}>{endpoint.url}</p>
          </div>
          {endpoint.description && <p className="text-sm text-slate-500">{endpoint.description}</p>}
          {endpoint.disabled_reason && <p className="text-xs text-red-600 dark:text-red-400">{endpoint.disabled_reason}</p>}
          <div className="flex flex-wrap gap-1">
            {endpoint.events.map((e) => <Badge key={e} color="brand">{e === "*" ? "all events" : e}</Badge>)}
          </div>
          <p className="text-xs text-slate-400">Secret <code>{endpoint.secret_hint}</code></p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={busy === "test"} onClick={test}><Send className="size-3.5" /> Send test</Button>
          <Button variant="secondary" size="sm" loading={busy === "toggle"} onClick={toggle}><Power className="size-3.5" /> {endpoint.is_active ? "Disable" : "Enable"}</Button>
          <Button variant="secondary" size="sm" loading={busy === "rotate"} onClick={rotate}><KeyRound className="size-3.5" /> Rotate secret</Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(endpoint)} aria-label={`Delete ${endpoint.url}`}><Trash2 className="size-3.5 text-red-500" /></Button>
        </div>
      </div>
      <div className="border-t border-slate-100 dark:border-white/10">
        <button className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase"
          onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} Recent deliveries
        </button>
        {open && <Deliveries key={refreshKey} endpointId={endpoint.id} />}
      </div>
    </Card>
  );
}

const VERIFY_SNIPPET = `import hmac, hashlib, time

def verify(secret: str, raw_body: bytes, header: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    ts, sig = int(parts["t"]), parts["v1"]
    if abs(time.time() - ts) > 300:          # reject replays
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body,
                        hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)`;

export default function Webhooks() {
  const { notify } = useToast();
  const { data, loading, error, reload } = useApi("/webhooks");
  const { data: eventTypes } = useApi("/webhooks/events");
  const [formOpen, setFormOpen] = useState(false);
  const [secret, setSecret] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try { await api(`/webhooks/${toDelete.id}`, { method: "DELETE" }); notify("Endpoint deleted"); setToDelete(null); reload(); }
    catch (err) { notify(err.message, "error"); } finally { setDeleting(false); }
  };

  return (
    <>
      <PageHeader title="Webhooks" subtitle="Send signed, real-time events to your own apps, Zapier, or automations"
        actions={<Button onClick={() => setFormOpen(true)}><Plus className="size-4" /> Add endpoint</Button>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {error ? <Card><ErrorState error={error} onRetry={reload} /></Card>
            : loading && !data ? <Card><Spinner /></Card>
              : !data.length ? (
                <Card><EmptyState icon={Webhook} title="No webhook endpoints yet"
                  message="Get an HTTP POST whenever a transaction is added, a budget is exceeded, or a goal is reached."
                  action={<Button onClick={() => setFormOpen(true)}><Plus className="size-4" /> Add your first endpoint</Button>} /></Card>
              ) : data.map((ep) => <EndpointCard key={ep.id} endpoint={ep} onChanged={reload} onSecret={setSecret} onDelete={setToDelete} />)}
        </div>
        <Card title="Verifying requests" className="self-start">
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p>Every request carries these headers:</p>
            <ul className="space-y-1 text-xs">
              <li><code>X-FinTrack-Event</code>: the event type</li>
              <li><code>X-FinTrack-Event-Id</code>: stays the same across retries, so you can skip duplicates</li>
              <li><code>X-FinTrack-Signature</code>: <code>t=&lt;timestamp&gt;,v1=&lt;hmac&gt;</code></li>
            </ul>
            <p>Respond with any 2xx within 10 seconds. Failed deliveries are retried for several hours with backoff, and an endpoint is disabled after repeated failures.</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{VERIFY_SNIPPET}</pre>
          </div>
        </Card>
      </div>
      <EndpointForm open={formOpen} onClose={() => setFormOpen(false)} eventTypes={eventTypes || []}
        onCreated={(ep) => { setSecret(ep.secret); reload(); notify("Endpoint added"); }} />
      <SecretModal secret={secret} onClose={() => setSecret(null)} />
      <ConfirmDialog open={Boolean(toDelete)} title="Delete endpoint" loading={deleting} onConfirm={remove} onClose={() => setToDelete(null)}
        message={`Stop sending events to ${toDelete?.url}? Its delivery history will be deleted too.`} />
    </>
  );
}
