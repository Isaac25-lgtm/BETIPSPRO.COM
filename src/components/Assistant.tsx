import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUp, MessageCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../app/auth";

type Msg = { role: "user" | "assistant"; content: string };

const SAMPLES = [
  "Give me 10 bets with a probability above 80% this week",
  "Which matches today are most likely to have over 2.5 goals?",
  "Home wins above 70% in the next 3 days",
  "Which Premier League matches are most likely to see both teams score?",
  "Summarise PSG vs Barcelona",
  "What does the model expect in Liverpool's next match?",
  "Which matches look tight, with no team above 45%?",
  "Matches with a goal before half-time above 85%",
  "Which Serie A matches lean towards under 2.5 goals?",
  "How accurate has the model been?",
];

/** Tiny safe renderer: paragraphs, numbered / bullet lists, **bold**, and internal links [text](/path). */
function renderInline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((\/[^)\s]*)\)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) { const k = `${key}-b${i++}`; out.push(<strong key={k}>{renderInline(m[1], k)}</strong>); }
    else out.push(<Link key={`${key}-l${i++}`} to={m[3]} className="asst-link">{m[2] === "link" ? "Open match" : m[2]}</Link>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split(/\r?\n/);
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, j) => <li key={j}>{renderInline(it, `li${blocks.length}-${j}`)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const ol = line.match(/^\d+[.)]\s+(.*)$/), ul = line.match(/^[-*•]\s+(.*)$/);
    if (ol || ul) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((ol ?? ul)![1]);
    } else if (line) {
      flush();
      blocks.push(<p key={blocks.length}>{renderInline(line.replace(/^#+\s*/, ""), `p${blocks.length}`)}</p>);
    } else flush();
  }
  flush();
  return <>{blocks}</>;
}

export function Assistant() {
  const { config } = useAuth();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { return JSON.parse(sessionStorage.getItem("asst-msgs") ?? "[]"); } catch { return []; }
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { try { sessionStorage.setItem("asst-msgs", JSON.stringify(msgs.slice(-20))); } catch { /* private mode */ } }, [msgs]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!config?.assistant_enabled) return null;

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const next = [...msgs, { role: "user" as const, content: question }];
    setMsgs(next);
    setDraft("");
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ answer: string }>("/assistant/chat", { method: "POST", json: { messages: next.slice(-10) } });
      setMsgs([...next, { role: "assistant", content: r.answer }]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // A link in an answer opens a page behind the chat: close the chat so the page is visible, and say so briefly.
  const onBodyClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a.asst-link")) {
      setOpen(false);
      setToast("Opening the match. Your chat is saved: tap Ask BetTipsPro AI to continue.");
    }
  };

  return (
    <>
      {toast && <div className="asst-toast" role="status">{toast}</div>}
      {!open && (
        <button className="asst-fab" onClick={() => setOpen(true)} aria-label="Ask BetTipsPro AI">
          <Sparkles size={18} aria-hidden="true" /> <span>Ask BetTipsPro AI</span>
        </button>
      )}
      {open && (
        <section className="asst-panel" role="dialog" aria-label="Ask BetTipsPro AI">
          <header className="asst-head">
            <span className="asst-avatar" aria-hidden="true"><Sparkles size={16} /></span>
            <div className="asst-title"><strong>Ask BetTipsPro AI</strong><span>Answers from today's model data</span></div>
            {msgs.length > 0 && <button className="asst-icon" onClick={() => { setMsgs([]); setErr(null); }} aria-label="New chat" title="New chat"><RotateCcw size={16} /></button>}
            <button className="asst-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
          </header>
          <div className="asst-body" onClick={onBodyClick}>
            {msgs.length === 0 && (
              <div className="asst-intro">
                <p>Ask about upcoming matches, probabilities and form. Try one of these:</p>
                <div className="asst-samples">
                  {SAMPLES.map((s) => <button key={s} className="asst-sample" onClick={() => void ask(s)}><MessageCircle size={14} aria-hidden="true" /> {s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`asst-msg ${m.role}`}>
                {m.role === "assistant" ? <div className="asst-md"><Markdown text={m.content} /></div> : <p>{m.content}</p>}
              </div>
            ))}
            {busy && <div className="asst-msg assistant"><span className="asst-typing" aria-label="Thinking"><i /><i /><i /></span></div>}
            {err && <p className="asst-err" role="alert">{err}</p>}
            <div ref={endRef} />
          </div>
          <form className="asst-input" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
            <textarea
              id="asst-q" ref={inputRef} rows={1} value={draft} maxLength={2000} placeholder="Ask about any upcoming match..."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(draft); } }}
              aria-label="Your question"
            />
            <button type="submit" className="asst-send" disabled={busy || !draft.trim()} aria-label="Send"><ArrowUp size={18} /></button>
          </form>
        </section>
      )}
    </>
  );
}
