import { useEffect, useRef, useState } from 'react';
import { PANELS, PanelPicker, PanelStrip, type PanelId, type PanelInstance } from './PanelPicker';
import { PanelWorkspace } from './PanelWorkspace';
import { SelectionContext, newPanel, type Selection } from './state';
import { DataSources } from './Controls';
import { EventDetail } from './RecordPanels';
import { askAgent, type AgentAnswer } from './api.ts';
import { CHART_DATASETS, DATASETS, utilityLabel, type EventRecord } from './data.ts';

interface Message { id: string; role: 'user' | 'assistant'; content: string; error?: boolean }
const STORAGE_KEY = 'wildfire-workspace-v1';
function initialPanels(): PanelInstance[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.every(p => Number.isInteger(p.id) && PANELS.some(t => t.id === p.type) && (!p.name || typeof p.name === 'string') && p.settings
      && DATASETS.some(d => d.id === p.settings.dataset) && p.settings.filters && ['start','end','county','utility'].every(k => typeof p.settings.filters[k] === 'string')
      && ['daily','weekly','monthly','quarterly'].includes(p.settings.interval) && ['cause','county','utility'].includes(p.settings.groupBy)
      && ['count','share'].includes(p.settings.measure) && ['events','acres','counties','customers'].includes(p.settings.metric)
      && Array.isArray(p.settings.datasets) && p.settings.datasets.every((id: string) => DATASETS.some(d => d.id === id))
      && Array.isArray(p.settings.overlays) && p.settings.overlays.every((id: string) => ['hftd','territories'].includes(id))
      && !p.settings.answerStat) && new Set(saved.map(p => p.id)).size === saved.length) return saved;
  } catch { /* Storage is optional; unavailable or old state opens the default workspace. */ }
  return PANELS.map((p, index) => newPanel(index + 1, p.id));
}
function Markdown({ text }: { text: string }) {
  return <>{text.split('\n').map((line, index) => <p key={index} className={line ? '' : 'paragraph-gap'}>{line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}</p>)}</>;
}
export default function App() {
  const [panels, setPanels] = useState<PanelInstance[]>(initialPanels);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [selected, select] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<EventRecord | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [showBack, setShowBack] = useState(false);
  const nextId = useRef(Math.max(0, ...panels.map(p => p.id)) + 1);
  const controller = useRef<AbortController | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(panels.filter(p => !p.settings.answerStat))); setStorageError(false); }
    catch { setStorageError(true); }
  }, [panels]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages, busy, progress]);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setShowBack(entry.isIntersecting), { rootMargin: '0px 0px -80px 0px' });
    observer.observe(workspaceRef.current!); return () => observer.disconnect();
  }, []);
  function removePanel(id: number) { setPanels(current => current.filter(p => p.id !== id)); if (activeId === id) setActiveId(null); }
  function addPanels(types: PanelId[]) { setPanels(current => [...current, ...types.map(type => newPanel(nextId.current++, type))]); }
  function locatePanel(id: number) {
    setActiveId(id); const element = document.getElementById(`panel-${id}`);
    element?.focus({ preventScroll: true }); element?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
  function applyAnswer(answer: AgentAnswer) {
    const added: PanelInstance[] = [];
    for (const view of answer.views ?? []) {
      const p = view.params;
      if (view.type === 'stat_card' && typeof p.value === 'number' && ['label','scope','period'].every(k => typeof p[k] === 'string')) {
        const panel = newPanel(nextId.current++, 'stat_card');
        panel.name = String(p.label); panel.settings.answerStat = { value: p.value, label: String(p.label), scope: String(p.scope), period: String(p.period), unit: typeof p.unit === 'string' ? p.unit : '' }; added.push(panel);
      }
      // Only represent view contracts this workspace can reproduce without dropping filters.
      if (!['map','time_series','record_table'].includes(view.type) || (p.incident_type_mode && p.incident_type_mode !== 'wildfire_default')) continue;
      const ids = view.type === 'map' ? p.datasets : [p.dataset];
      if (!Array.isArray(ids) || ids.length !== 1) continue;
      const dataset = DATASETS.find(d => d.api === ids[0] || d.id === ids[0]);
      if (!dataset) continue;
      if (view.type === 'time_series' && !CHART_DATASETS.some(d => d.id === dataset.id)) continue;
      const panel = newPanel(nextId.current++, view.type as PanelId);
      panel.settings.dataset = dataset.id; panel.settings.datasets = [dataset.id];
      const start = typeof p.start_date === 'string' ? p.start_date : p.year ? `${p.year}-01-01` : null;
      const end = typeof p.end_date === 'string' ? p.end_date : p.year ? `${p.year}-12-31` : null;
      if (!start || !end) continue;
      panel.settings.filters = { start, end, utility: utilityLabel(p.utility) ?? '', county: typeof p.county === 'string' ? p.county : '' };
      if (['daily','weekly','monthly'].includes(String(p.interval))) panel.settings.interval = p.interval as 'daily' | 'weekly' | 'monthly';
      if (p.show_hftd) panel.settings.overlays.push('hftd');
      if (p.show_territory) panel.settings.overlays.push('territories');
      panel.name = `${dataset.name} · ${start.slice(0, 4)}`; added.push(panel);
    }
    if (added.length) setPanels(current => [...current, ...added]);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!query.trim() || busy) return;
    const question = query.trim(); setQuery(''); setBusy(true); setProgress('Connecting to the agent…');
    setMessages(current => [...current, { id: crypto.randomUUID(), role: 'user', content: question }]);
    requestAnimationFrame(() => stageRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }));
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(new Error('The agent did not respond within 45 seconds. You can still use the data panels.')), 45_000);
    try {
      const answer = await askAgent(question, abort.signal, setProgress);
      const qualifications = (answer.qualifications ?? []).map(q => q.text).filter(t => !answer.answer_text.includes(t));
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', content: [answer.answer_text, ...qualifications].join('\n\n'), error: answer.status === 'error' }]);
      if (answer.status !== 'error') applyAnswer(answer);
    } catch (error) {
      const reason = abort.signal.aborted ? abort.signal.reason : error;
      setMessages(current => [...current, { id: crypto.randomUUID(), role: 'assistant', content: reason instanceof Error ? reason.message : 'Agent unavailable. You can still use the data panels.', error: true }]);
    } finally { clearTimeout(timeout); setBusy(false); controller.current = null; }
  }
  return <SelectionContext.Provider value={{ selected, select, inspect: record => { select({ record }); setDetail(record); } }}>
    <main className={`demo-app ${panels.length ? 'has-panels' : ''} ${messages.length ? 'has-chat' : ''}`}>
      <div className="site-brand">Wildfire <span>Analysis workspace</span></div>
      <section id="workspace-top" className="workspace-intro" aria-label="Ask and choose panels">
        <div ref={stageRef} className="conversation-stage">
          {messages.length > 0 && <div ref={chatRef} className="chat-messages" aria-label="Conversation" aria-live="polite">{messages.map(message => <div key={message.id} className={`chat-message ${message.role} ${message.error ? 'message-error' : ''}`}><Markdown text={message.content} /></div>)}{busy && <p className="panel-note">{progress}</p>}</div>}
          <form onSubmit={submit} className="search-form"><input aria-label="Ask a question" value={query} onChange={e => setQuery(e.target.value)} placeholder="What do you want to know today~" />
            {busy ? <button type="button" aria-label="Cancel request" onClick={() => controller.current?.abort(new Error('Request cancelled.'))}>■</button> : query.trim() && <button type="submit" aria-label="Send message">↑</button>}
          </form>
          <div className="shortcut-section"><PanelStrip panels={panels} activeId={activeId} onRemove={removePanel} onLocate={locatePanel} onOpen={() => setShowPicker(true)} /></div>
          {storageError && <p className="panel-note">Browser storage is unavailable. This workspace will reset when you refresh.</p>}
        </div>
      </section>
      <div ref={workspaceRef}><PanelWorkspace panels={panels} activeId={activeId} onRemove={removePanel} onRename={(id, name) => setPanels(current => current.map(p => p.id === id ? { ...p, name } : p))}
        onUpdate={(id, patch) => setPanels(current => current.map(p => p.id === id ? { ...p, settings: { ...p.settings, ...patch } } : p))} /></div>
      <DataSources />
      {panels.length > 0 && showBack && <a href="#workspace-top" className="back-to-panels" aria-label="Back to top">↑</a>}
      {showPicker && <PanelPicker onSave={addPanels} onClose={() => setShowPicker(false)} />}
      {detail && <EventDetail record={detail} onClose={() => setDetail(null)} />}
    </main>
  </SelectionContext.Provider>;
}
