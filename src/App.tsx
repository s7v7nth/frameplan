import { SidePanel } from './components/SidePanel';
import { PlanCanvas } from './components/PlanCanvas';
import { ReportsView } from './components/ReportsView';
import { useEditorStore } from './store/editorStore';
import './App.css';

const TABS = [
  ['editor', 'Планировка'],
  ['frame', 'Каркас и проекции'],
  ['cutting', 'Раскрой'],
  ['estimate', 'Смета'],
  ['thermal', 'Теплопотери'],
] as const;

export default function App() {
  const tab = useEditorStore((s) => s.tab);
  const setTab = useEditorStore((s) => s.setTab);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="logo-mark">FP</span>
          <div>
            <div className="logo-title">FramePlan</div>
            <div className="logo-sub">Редактор планировок и каркаса</div>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'tab active' : 'tab'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="main">
        <SidePanel />
        <div className="workspace">
          {tab === 'editor' ? <PlanCanvas /> : <ReportsView />}
        </div>
      </div>
    </div>
  );
}
