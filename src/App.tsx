import { useEffect } from 'react';
import { SidePanel } from './components/SidePanel';
import { PlanCanvas } from './components/PlanCanvas';
import { ReportsView } from './components/ReportsView';
import { parseProjectJson } from './domain/projectIO';
import { useEditorStore } from './store/editorStore';
import './App.css';

const TABS = [
  ['editor', '1. Планировка', 'Рисуй стены, окна, двери'],
  ['frame', '2. Каркас', 'Узлы, развёртки, проекции'],
  ['cutting', '3. Раскрой', 'Как пилить хлысты'],
  ['estimate', '4. Смета', 'Что купить'],
  ['thermal', '5. Тепло', 'Теплопотери'],
] as const;

export default function App() {
  const tab = useEditorStore((s) => s.tab);
  const setTab = useEditorStore((s) => s.setTab);
  const name = useEditorStore((s) => s.project.name);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const loadProject = useEditorStore((s) => s.loadProject);

  const idx = TABS.findIndex(([id]) => id === tab);
  const next = TABS[idx + 1];
  const prev = TABS[idx - 1];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const onDropJson = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith('.json')) return;
    const text = await file.text();
    const result = parseProjectJson(text);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    loadProject(result.project);
  };

  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        void onDropJson(e);
      }}
    >
      <header className="topbar">
        <div className="topbar-brand">
          <span className="logo-mark">FP</span>
          <div>
            <div className="logo-title">FramePlan</div>
            <div className="logo-sub">{name || 'Проект каркасного дома'}</div>
          </div>
        </div>
        <nav className="tabs" aria-label="Этапы">
          {TABS.map(([id, label, desc]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}
              title={desc}
            >
              <span className="tab-label">{label}</span>
              <span className="tab-desc">{desc}</span>
            </button>
          ))}
        </nav>
        <div className="topbar-nav">
          <button
            type="button"
            className="nav-btn"
            disabled={!prev}
            onClick={() => prev && setTab(prev[0])}
          >
            ← Назад
          </button>
          <button
            type="button"
            className="nav-btn primary"
            disabled={!next}
            onClick={() => next && setTab(next[0])}
          >
            Далее →
          </button>
        </div>
      </header>
      <div className={`main ${tab === 'editor' ? 'main-editor' : 'main-report'}`}>
        {tab === 'editor' ? (
          <>
            <SidePanel />
            <div className="workspace">
              <PlanCanvas />
            </div>
          </>
        ) : (
          <div className="workspace workspace-report">
            <ReportsView />
          </div>
        )}
      </div>
    </div>
  );
}
