"use client";

import { FormEvent, KeyboardEvent, type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { CaretRight, CircleNotch, Sparkle, X } from "@phosphor-icons/react";
import { MessageResponse } from "@/src/components/ai-elements/message";
import { SignalIcon } from "@/src/components/incoming-signal-queue";
import { sendChat } from "@/src/lib/chat-core";
import type { ChatContext, ChatMessage, ChatReference } from "@/src/lib/server/chat";
import { FloatingPanel } from "@/src/components/floating-panel";

type AgentSheetProps = {
  onClose: () => void;
  /** Retained for caller compatibility; opening the sheet never auto-submits it. */
  initialCommand?: string;
  entityIds: string[];
  context?: ChatContext;
  references?: ChatReference[];
  onRemoveReference?: (referenceId: string) => void;
  onFocusReference?: (reference: ChatReference) => void;
  variant?: "drawer" | "map";
};

type DragState = { startX: number; startY: number; baseX: number; baseY: number; minX: number; maxX: number; minY: number; maxY: number };

const defaultPrompt = "Ask about the current map…";
const chatThreadStorageKey = "terracdm:analyst-thread:default";
const presets = [
  ["MAP BRIEF", "Give me a concise brief of the current map state"],
  ["HIGH RISK", "Which high-risk signals deserve attention, and why?"],
  ["CORRELATE", "What relationships or clusters are visible in the current context?"],
] as const;

export function AgentSheet({ onClose, initialCommand, entityIds, context, references = [], onRemoveReference, onFocusReference, variant = "drawer" }: AgentSheetProps) {
  const [input, setInput] = useState(initialCommand && initialCommand !== "Open the analyst chat" ? initialCommand : "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [showHints, setShowHints] = useState(true);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (variant !== "map" || event.button !== 0 || !(event.target instanceof Element) || event.target.closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: dragOffset.x,
      baseY: dragOffset.y,
      minX: 8 - rect.left,
      maxX: window.innerWidth - 8 - rect.right,
      minY: 8 - rect.top,
      maxY: window.innerHeight - 8 - rect.bottom,
    };
    setDragging(true);
    event.preventDefault();
  };

  useEffect(() => {
    if (!dragging) return;
    const handleDragMove = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = Math.min(Math.max(event.clientX - drag.startX, drag.minX), drag.maxX);
      const deltaY = Math.min(Math.max(event.clientY - drag.startY, drag.minY), drag.maxY);
      setDragOffset({ x: drag.baseX + deltaX, y: drag.baseY + deltaY });
    };
    const handleDragEnd = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
    window.addEventListener("pointercancel", handleDragEnd);
    return () => {
      window.removeEventListener("pointermove", handleDragMove);
      window.removeEventListener("pointerup", handleDragEnd);
      window.removeEventListener("pointercancel", handleDragEnd);
    };
  }, [dragging]);

  const ask = async (value: string, showPrompt = true) => {
    const content = value.trim();
    if (!content || running || !chatLoaded) return;
    const nextMessages = [...messages, { role: "user" as const, content }];
    setShowHints(false);
    if (showPrompt) setMessages(nextMessages);
    setInput("");
    setRunning(true);
    try {
      const reply = await sendChat(nextMessages, { ...context, selectedEntityIds: context?.selectedEntityIds ?? entityIds, references }, threadId);
      const message = reply.message.trim();
      if (!message) throw new Error("The analyst could not produce a response. Please try again.");
      setThreadId(reply.threadId);
      window.localStorage.setItem(chatThreadStorageKey, reply.threadId);
      setMessages([...(showPrompt ? nextMessages : messages), { role: "assistant", content: message }]);
    } catch (error) {
      setMessages([...(showPrompt ? nextMessages : messages), { role: "assistant", content: error instanceof Error ? error.message : "AI chat failed" }]);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    let active = true;
    const savedThreadId = window.localStorage.getItem(chatThreadStorageKey);
    if (!savedThreadId) {
      setChatLoaded(true);
      return () => { active = false; };
    }

    void fetch(`/api/chat?threadId=${encodeURIComponent(savedThreadId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { messages?: ChatMessage[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Chat history read failed");
        if (!active) return;
        setThreadId(savedThreadId);
        setMessages(Array.isArray(payload.messages) ? payload.messages : []);
        setShowHints(!payload.messages?.length);
      })
      .catch(() => {
        window.localStorage.removeItem(chatThreadStorageKey);
      })
      .finally(() => {
        if (active) setChatLoaded(true);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, running]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 108)}px`;
  }, [input]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void ask(input);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const panelStyle = variant === "map" ? { "--agent-drag-x": `${dragOffset.x}px`, "--agent-drag-y": `${dragOffset.y}px` } as CSSProperties : undefined;

  return <FloatingPanel ref={panelRef} style={panelStyle} className={`agent-sheet agent-sheet-${variant}`} role="complementary" aria-label="Map intelligence workspace">
    <header className={`agent-sheet-head${variant === "map" ? " agent-sheet-head-draggable" : ""}`} onPointerDown={handleDragStart} aria-grabbed={variant === "map" ? dragging : undefined} data-dragging={variant === "map" && dragging ? "true" : undefined}><div><span className="eyebrow"><Sparkle size={14} weight="fill" /> AI / MAP ANALYST</span></div><button type="button" onClick={onClose} aria-label="Close analyst"><X size={17} /></button></header>
    <section className="agent-chat">
      <div className="agent-chat-thread" ref={threadRef} aria-live="polite">
        {!messages.length && !running && <div className="agent-chat-empty"><p>Ask about visible entities, incoming signals, layers, or risk.</p></div>}
        {messages.map((message, index) => <article className={`agent-chat-message agent-chat-message-${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "user" ? "YOU" : "ANALYST"}</span><MessageResponse>{message.content}</MessageResponse></article>)}
        {running && <div className="agent-chat-pending"><CircleNotch className="spin" size={15} /> Working...</div>}
      </div>
      {showHints && !running && <nav className="agent-query-strip" aria-label="Suggested analyst prompts"><div>{presets.map(([, value]) => value).map((query) => <button key={query} type="button" onClick={() => void ask(query)} disabled={running}>{query}</button>)}</div></nav>}
      <form className={`agent-chat-composer${references.length > 0 ? " has-references" : ""}`} onSubmit={submit}>
        {references.length > 0 && <div className="agent-reference-strip" aria-label="Attached references"><div className="agent-reference-list">{references.map((reference) => <div className="agent-reference-chip" key={`${reference.kind}:${reference.id}`} style={{ "--reference-accent": reference.accent } as CSSProperties}>
          {onRemoveReference && <button type="button" className="agent-reference-remove" onClick={() => onRemoveReference(reference.id)} aria-label={`Remove ${reference.name} reference`}><X size={9} weight="bold" /></button>}
          <button type="button" className="agent-reference-focus" onClick={() => onFocusReference?.(reference)} title={`Center on ${reference.name}`}><span className="agent-reference-icon"><SignalIcon domain={reference.type} /></span><span className="agent-reference-name">{reference.name}</span></button>
        </div>)}</div></div>}
        <div className="agent-chat-composer-main"><textarea ref={composerRef} id="agent-chat-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleInputKeyDown} placeholder={defaultPrompt} rows={1} aria-label="Chat message" /><button type="submit" disabled={!chatLoaded || running || !input.trim()} aria-label="Send chat message">{running ? <CircleNotch className="spin" size={17} /> : <CaretRight size={18} weight="bold" />}</button></div>
      </form>
    </section>
  </FloatingPanel>;
}
