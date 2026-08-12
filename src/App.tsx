import { SidePanel } from './components/SidePanel';
import { PlanCanvas } from './components/PlanCanvas';
import { ReportsView } from './components/ReportsView';
import { useEditorStore } from './store/editorStore';
import { APP_BUILD } from './version';
import './App.css';

const TABS = [
  ['editor', '1. Планировка', 'Рисуй стены, окна, двери'],
  ['frame', '2. Каркас', 'Узлы, развёртки, проекции'],
  ['structural', '3. Прочность', 'Пролёты, нагрузки, прогибы'],
  ['cutting', '4. Раскрой', 'Как пилить хлысты'],
  ['estimate', '5. Смета', 'Что купить'],
  ['thermal', '6. Тепло', 'Теплопотери'],
] as const;

export default function App() {
  const tab = useEditorStore((s) => s.tab);
  const setTab = useEditorStore((s) => s.setTab);
  const name = useEditorStore((s) => s.project.name);

  const idx = TABS.findIndex(([id]) => id === tab);
  const next = TABS[idx + 1];
  const prev = TABS[idx - 1];

  return (
    <div className="app-shell">
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
      <div className="build-badge" title="Номер сборки — сверяй с актуальной версией">
        build {APP_BUILD}
      </div>
    </div>
  );
}
