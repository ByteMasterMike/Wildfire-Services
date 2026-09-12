import { useState, useRef, useEffect } from "react";

import { PanelPicker, PanelStrip, type PanelId, type PanelInstance } from "./PanelPicker";

import { PanelWorkspace } from "./PanelWorkspace";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const MOCK_RESPONSE = `Here's what I found for you.

**Key points:**

1. Break the problem into smaller, manageable parts.
2. Look for patterns and connections between concepts.
3. Consider multiple perspectives before drawing conclusions.

> The most important thing is to stay curious and keep asking questions.

Feel free to ask follow-up questions — I'm here to help you explore further.`;

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("> ")) {
      out.push(<blockquote key={i} className="border-l-2 border-white/30 pl-3 my-2 text-white/60 italic text-sm">{line.slice(2)}</blockquote>);
    } else if (/^\d+\./.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\./.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s*/, "")); i++; }
      out.push(<ol key={`ol${i}`} className="list-decimal list-inside space-y-1 my-2 text-white/80 text-sm">{items.map((it, j) => <li key={j}>{inl(it)}</li>)}</ol>);
      continue;
    } else if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
      out.push(<p key={i} className="font-semibold text-white text-sm my-2">{line.slice(2, -2)}</p>);
    } else if (line === "") {
      out.push(<div key={i} className="h-2" />);
    } else {
      out.push(<p key={i} className="text-white/80 text-sm leading-relaxed">{inl(line)}</p>);
    }
    i++;
  }
  return out;
}

function inl(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>
      : p
  );
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [panels, setPanels] = useState<PanelInstance[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const nextId = useRef(1);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [showBackToPanels, setShowBackToPanels] = useState(false);
  const chat = messages.length > 0;

  useEffect(() => () => { if (replyTimer.current) clearTimeout(replyTimer.current); }, []);
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, isTyping]);
  useEffect(() => {
    if (messages.at(-1)?.role === "user") {
      stageRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [messages]);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setShowBackToPanels(entry.isIntersecting);
    }, { rootMargin: "0px 0px -80px 0px" });
    observer.observe(workspaceRef.current!);
    return () => observer.disconnect();
  }, []);

  const submitMessage = (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim() || isTyping) return;
    setMessages(current => [...current, { id: crypto.randomUUID(), role: "user", content: query.trim() }]);
    setQuery("");
    setIsTyping(true);
    replyTimer.current = setTimeout(() => {
      setMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", content: MOCK_RESPONSE }]);
      setIsTyping(false);
    }, 1200);
  };

  const addPanels = (types: PanelId[]) => {
    const added = types.map(type => ({ id: nextId.current++, type }));
    setPanels(current => [...current, ...added]);
  };
  const removePanel = (id: number) => {
    setPanels(current => current.filter(panel => panel.id !== id));
    if (activeId === id) setActiveId(null);
  };
  const renamePanel = (id: number, name: string) => {
    setPanels(current => current.map(panel => panel.id === id ? { ...panel, name } : panel));
  };
  const locatePanel = (id: number) => {
    const element = document.getElementById(`panel-${id}`);
    if (!element) return;
    setActiveId(id);
    element.focus({ preventScroll: true });
    element.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  };

  return <main className={`demo-app ${panels.length ? "has-panels" : ""} ${chat ? "has-chat" : ""}`}>
    <section id="workspace-top" className="workspace-intro" aria-label="Ask and choose panels">
      <div ref={stageRef} className="conversation-stage">
      {chat && <div ref={chatRef} className="chat-messages" aria-label="Conversation" aria-live="polite">
        {messages.map(message => <div key={message.id} className={`chat-message ${message.role}`}>
          {message.role === "user" ? message.content : <><span className="demo-label">Demo reply</span>{renderMarkdown(message.content)}</>}
        </div>)}
        {isTyping && <p className="text-sm text-white/50">Thinking…</p>}
      </div>}
      <form onSubmit={submitMessage} className="search-form">
        <input autoFocus aria-label="Ask a question" value={query} onChange={event => setQuery(event.target.value)} placeholder="What do you want to know today~" />
        {query.trim() && <button type="submit" disabled={isTyping} aria-label="Send message">↑</button>}
      </form>
      <div id="panel-shortcuts" className="shortcut-section">
        <PanelStrip panels={panels} activeId={activeId} onRemove={removePanel} onLocate={locatePanel} onOpen={() => setShowModal(true)} />
      </div>
      </div>
    </section>
    <div ref={workspaceRef}>
      <PanelWorkspace panels={panels} activeId={activeId} onRemove={removePanel} onRename={renamePanel} />
    </div>
    {panels.length > 0 && showBackToPanels && <a href="#workspace-top" className="back-to-panels" aria-label="Back to top" title="Back to top">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
    </a>}
    {showModal && <PanelPicker onSave={addPanels} onClose={() => setShowModal(false)} />}
  </main>;
}
