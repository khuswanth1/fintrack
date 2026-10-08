import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageCircle, RotateCcw, Send, X } from "lucide-react";
import { api } from "../lib/api.js";
import { cx } from "./ui.jsx";

const SUGGESTIONS = [
  "How much did I spend this month?",
  "Which budgets am I close to exceeding?",
  "What are my biggest expense categories?",
  "How are my savings goals going?",
];

// Renders **bold** inside plain text without injecting HTML.
function RichText({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}

function Bubble({ role, content }) {
  const mine = role === "user";
  return (
    <div className={cx("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
        mine ? "rounded-br-sm bg-brand-500 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800 dark:bg-white/5 dark:text-slate-100")}>
        <RichText text={content} />
      </div>
    </div>
  );
}

export default function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, sending]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const send = async (text) => {
    const content = text.trim();
    if (!content || sending) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      // Only the most recent turns are sent; the API caps history at 40 messages.
      const res = await api("/assistant/chat", { method: "POST", body: { messages: next.slice(-20) } });
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: `Sorry, something went wrong: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
    if (e.key === "Escape") setOpen(false);
  };

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Open AI assistant"
          className="fixed right-4 bottom-24 z-30 grid size-13 place-items-center rounded-full bg-ink-soft text-white shadow-lift transition hover:scale-105 hover:bg-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 lg:right-6 lg:bottom-6 lg:size-14 dark:bg-brand-500 dark:hover:bg-brand-600">
          <MessageCircle className="size-6" />
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="AI assistant"
          className="fixed inset-x-3 bottom-3 z-50 flex h-[min(620px,calc(100dvh-1.5rem))] animate-sheet flex-col overflow-hidden rounded-3xl bg-white shadow-lift ring-1 ring-black/5 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96 dark:bg-[#16171c] dark:ring-white/10">
          <header className="flex items-center gap-2.5 bg-gradient-to-r from-brand-500 to-[#f2541b] px-4 py-3.5 text-white">
            <div className="grid size-9 place-items-center rounded-full bg-white/20 ring-1 ring-white/30"><Bot className="size-5" /></div>
            <div className="flex-1">
              <p className="text-sm font-extrabold">FinTrack Assistant</p>
              <p className="text-xs text-white/80">Ask about your spending, budgets and goals</p>
            </div>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} aria-label="New conversation" title="New conversation"
                className="rounded-full p-1.5 text-white/90 hover:bg-white/15"><RotateCcw className="size-4" /></button>
            )}
            <button onClick={() => setOpen(false)} aria-label="Close assistant"
              className="rounded-full p-1.5 text-white/90 hover:bg-white/15"><X className="size-4" /></button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-slate-600 dark:text-slate-400">Hi! I can look up your FinTrack data and answer questions. Try:</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="block w-full rounded-2xl border border-slate-200 px-3.5 py-2.5 text-left text-sm font-semibold text-ink-soft transition hover:border-brand-300 hover:bg-brand-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5">{s}</button>
                ))}
              </div>
            )}
            {messages.map((m, i) => <Bubble key={i} {...m} />)}
            {sending && (
              <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Thinking…</div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="flex items-end gap-2 border-t border-dashed border-slate-200 p-3 dark:border-white/10">
            <textarea ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
              maxLength={4000} placeholder="Ask a question…" aria-label="Message"
              className="input max-h-32 min-h-11 flex-1 resize-none rounded-2xl" />
            <button type="submit" disabled={sending || !input.trim()} aria-label="Send"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-500 text-white shadow-cta hover:bg-brand-600 disabled:opacity-40 disabled:shadow-none">
              <Send className="size-4" />
            </button>
          </form>
          <p className="px-3 pb-2 text-center text-[11px] text-slate-400">AI answers can be wrong. Not financial advice.</p>
        </section>
      )}
    </>
  );
}
