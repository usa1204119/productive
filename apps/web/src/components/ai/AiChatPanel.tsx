import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { Check, Copy, Image as ImageIcon, Send, Sparkles, Square, X } from "lucide-react";
import type { AiChatMessage } from "@plane-and-curves/shared";
import { streamAiChat } from "../../lib/aiChat.js";

interface AiChatPanelProps {
  workspaceId: string;
  workspaceName: string;
  /** Data URL of the selected region the AI reasons about. */
  snapshot: string;
  onClose: () => void;
}

type Msg = AiChatMessage & { id: string; streaming?: boolean };

const QUICK_PROMPTS = ["Explain this", "Find bugs or improvements", "Summarize it", "Turn this into notes"];

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());

export function AiChatPanel({ workspaceId, workspaceName, snapshot, onClose }: AiChatPanelProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const close = () => {
    abortRef.current?.abort();
    setEntered(false);
    setTimeout(onClose, 200);
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || streaming) return;
    setError(null);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    const userMsg: Msg = { id: uid(), role: "user", content: q };
    const aiMsg: Msg = { id: uid(), role: "assistant", content: "", streaming: true };
    const history = [...messages, userMsg];
    setMessages([...history, aiMsg]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAiChat({
        workspaceId,
        imageDataUrl: snapshot, // the server attaches it to the first user turn
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        signal: controller.signal,
        onDelta: (delta) =>
          setMessages((prev) => prev.map((m) => (m.id === aiMsg.id ? { ...m, content: m.content + delta } : m))),
      });
      setMessages((prev) => prev.map((m) => (m.id === aiMsg.id ? { ...m, streaming: false } : m)));
    } catch (e) {
      if (controller.signal.aborted) {
        setMessages((prev) => prev.map((m) => (m.id === aiMsg.id ? { ...m, streaming: false } : m)));
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== aiMsg.id));
        setError(e instanceof Error ? e.message : "The AI request failed.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/10" aria-hidden />
      <aside
        role="dialog"
        aria-label="Ask AI about your selection"
        className={`relative flex h-full w-full max-w-[420px] flex-col bg-white shadow-2xl transition-transform duration-200 ease-out ${
          entered ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-slate-800">Ask AI</h2>
            <p className="truncate text-xs text-slate-400">about your selection · {workspaceName}</p>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              New chat
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close AI chat"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="group block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left"
          >
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-1.5 text-[11px] font-medium text-slate-500">
              <ImageIcon className="h-3.5 w-3.5" /> Selection snapshot
              <span className="ml-auto text-slate-300 transition group-hover:text-slate-400">click to zoom</span>
            </div>
            <img src={snapshot} alt="Selected whiteboard region" className="max-h-44 w-full bg-white object-contain" />
          </button>

          {messages.length === 0 && (
            <div className="space-y-3 pt-1">
              <p className="text-sm text-slate-500">Ask anything about the selected region.</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void send(p)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          )}
        </div>

        <div className="border-t border-slate-100 p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 transition focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10"
          >
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask about this selection…"
              className="max-h-32 flex-1 resize-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop generating"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-800 text-white transition hover:bg-slate-700"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </form>
          <p className="mt-1.5 px-1 text-[10px] leading-tight text-slate-300">
            Snapshots are sent to the AI provider to answer. Enter to send · Shift+Enter for a new line.
          </p>
        </div>
      </aside>

      {zoomed && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/70 p-8"
          onClick={() => setZoomed(false)}
        >
          <img src={snapshot} alt="Selected whiteboard region" className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Msg }) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="group min-w-0 flex-1">
        <div className="ai-markdown min-w-0 break-words rounded-2xl rounded-tl-md bg-slate-50 px-3.5 py-2 text-sm text-slate-700">
          {message.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
              {message.content}
            </ReactMarkdown>
          ) : (
            <TypingDots />
          )}
          {message.streaming && message.content && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-slate-400 align-middle" />
          )}
        </div>
        {message.content && !message.streaming && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(message.content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400 opacity-0 transition hover:text-slate-600 group-hover:opacity-100"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}

function InlineCode({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const isBlock = /language-|hljs/.test(className ?? "");
  if (isBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  return (
    <code className="rounded bg-slate-200/70 px-1 py-0.5 text-[0.85em] text-slate-800" {...props}>
      {children}
    </code>
  );
}

const markdownComponents: Components = {
  p: (p) => <p className="mb-2 leading-relaxed last:mb-0" {...p} />,
  ul: (p) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...p} />,
  ol: (p) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  h1: (p) => <h3 className="mb-1.5 mt-1 text-base font-semibold text-slate-800" {...p} />,
  h2: (p) => <h3 className="mb-1.5 mt-1 text-sm font-semibold text-slate-800" {...p} />,
  h3: (p) => <h4 className="mb-1 mt-1 text-sm font-semibold text-slate-800" {...p} />,
  a: (p) => <a className="text-accent underline" target="_blank" rel="noreferrer" {...p} />,
  strong: (p) => <strong className="font-semibold text-slate-800" {...p} />,
  code: InlineCode,
  pre: (p) => <pre className="my-2 overflow-x-auto rounded-lg bg-[#0d1117] p-3 text-xs leading-relaxed" {...p} />,
  blockquote: (p) => <blockquote className="my-2 border-l-2 border-slate-300 pl-3 text-slate-500" {...p} />,
  table: (p) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...p} />
    </div>
  ),
  th: (p) => <th className="border border-slate-200 bg-slate-100 px-2 py-1 text-left font-semibold" {...p} />,
  td: (p) => <td className="border border-slate-200 px-2 py-1" {...p} />,
  hr: () => <hr className="my-3 border-slate-200" />,
};
