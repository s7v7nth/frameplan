import { useMemo, useRef } from 'react';
import {
  CLIMATE_PRESETS,
  EXTERIOR_CLADDING,
  FLOOR_FINISH,
  INSULATION_OPTIONS,
  INTERIOR_FINISH,
} from '../domain/materials';
import type {
  ExteriorCladding,
  FloorFinish,
  FoundationType,
  InteriorFinish,
  RoofType,
} from '../domain/types';
import { useEditorStore } from '../store/editorStore';
import { wallLength } from '../domain/geometry';
import { parseProjectJson } from '../domain/projectIO';
import { detectRooms } from '../domain/rooms';
import { validateProject } from '../domain/validate';

export function SidePanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    project,
    selectedId,
    tool,
    wallKind,
    past,
    future,
    setTool,
    setWallKind,
    setActiveFloor,
    updateSettings,
    updateInsulation,
    updateClimate,
    updateOpening,
    updateWall,
    addFurniture,
    setProjectName,
    resetDemo,
    copyFloorPlan,
    exportJson,
    loadProject,
    captureHistory,
    undo,
    redo,
  } = useEditorStore();

  const selectedOpening = project.openings.find((o) => o.id === selectedId);
  const selectedWall = project.walls.find((w) => w.id === selectedId);
  const issues = useMemo(() => validateProject(project), [project]);
  const rooms = useMemo(
    () => detectRooms(project, project.activeFloor),
    [project],
  );

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'project'}.frameplan.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseProjectJson(text);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      loadProject(result.project);
    } catch {
      window.alert('Не удалось прочитать файл.');
    }
  };

  const withHistory = () => captureHistory();

  return (
    <aside className="side-panel">
      <div className="brand-block">
        <div className="brand">FramePlan</div>
        <p className="brand-sub">Каркас по СП 31-105-2002</p>
      </div>

      <label className="field">
        <span>Проект</span>
        <input
          value={project.name}
          onFocus={withHistory}
          onChange={(e) => setProjectName(e.target.value)}
        />
      </label>

      <section className="panel-section">
        <h3>История</h3>
        <div className="seg">
          <button type="button" disabled={!past.length} onClick={() => undo()}>
            Отменить
          </button>
          <button type="button" disabled={!future.length} onClick={() => redo()}>
            Повторить
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h3>Инструменты</h3>
        <p className="muted" style={{ marginBottom: 8 }}>
          Панель также на чертеже сверху. V выбор, W стена, O окно, D дверь, M рулетка.
        </p>
        <div className="tool-grid">
          {(
            [
              ['select', 'Выбор'],
              ['wall', 'Стена'],
              ['window', 'Окно'],
              ['door', 'Дверь'],
              ['measure', 'Рулетка'],
              ['delete', 'Удалить'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={tool === id ? 'tool active' : 'tool'}
              onClick={() => setTool(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {tool === 'wall' && (
          <div className="seg">
            <button
              type="button"
              className={wallKind === 'exterior' ? 'active' : ''}
              onClick={() => setWallKind('exterior')}
            >
              Наружная
            </button>
            <button
              type="button"
              className={wallKind === 'interior' ? 'active' : ''}
              onClick={() => setWallKind('interior')}
            >
              Внутренняя
            </button>
          </div>
        )}
      </section>

      {issues.length > 0 && (
        <section className="panel-section highlight">
          <h3>Проверки планировки</h3>
          <ul className="issue-list">
            {issues.map((issue, i) => (
              <li key={i} className={issue.level === 'error' ? 'issue-error' : 'issue-warn'}>
                {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {rooms.length > 0 && (
        <section className="panel-section">
          <h3>Помещения ({project.activeFloor + 1} эт.)</h3>
          <ul className="room-list">
            {rooms.map((r) => (
              <li key={r.id}>
                {r.label}: <strong>{r.areaM2.toFixed(1)} м²</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel-section">
        <h3>Этажи</h3>
        <div className="seg">
          <button
            type="button"
            className={project.settings.floors === 1 ? 'active' : ''}
            onClick={() => {
              withHistory();
              updateSettings({ floors: 1 });
            }}
          >
            1 этаж
          </button>
          <button
            type="button"
            className={project.settings.floors === 2 ? 'active' : ''}
            onClick={() => {
              withHistory();
              updateSettings({ floors: 2 });
            }}
          >
            2 этажа
          </button>
        </div>
        <div className="seg" style={{ marginTop: 8 }}>
          <button
            type="button"
            className={project.activeFloor === 0 ? 'active' : ''}
            onClick={() => setActiveFloor(0)}
          >
            План 1 эт.
          </button>
          <button
            type="button"
            className={project.activeFloor === 1 ? 'active' : ''}
            onClick={() => setActiveFloor(1)}
            disabled={project.settings.floors < 2}
          >
            План 2 эт.
          </button>
        </div>
        {project.settings.floors === 2 && (
          <button
            type="button"
            className="tool"
            style={{ marginTop: 8, width: '100%' }}
            onClick={() => copyFloorPlan(0, 1)}
          >
            Копировать 1 эт. → 2 эт.
          </button>
        )}
      </section>

      <section className="panel-section">
        <h3>Кровля и каркас</h3>
        <label className="field">
          <span>Тип кровли</span>
          <select
            value={project.settings.roofType}
            onFocus={withHistory}
            onChange={(e) => updateSettings({ roofType: e.target.value as RoofType })}
          >
            <option value="gable">Двускатная</option>
            <option value="hip">Вальмовая</option>
            <option value="shed">Односкатная</option>
            <option value="flat">Плоская</option>
          </select>
        </label>
        <label className="field">
          <span>Уклон, °</span>
          <input
            type="number"
            min={0}
            max={60}
            value={project.settings.roofPitchDeg}
            onFocus={withHistory}
            onChange={(e) => updateSettings({ roofPitchDeg: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Свес кровли, мм</span>
          <input
            type="number"
            min={0}
            step={50}
            value={project.settings.overhangMm}
            onFocus={withHistory}
            onChange={(e) => updateSettings({ overhangMm: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Шаг стоек, мм</span>
          <select
            value={project.settings.studSpacingMm}
            onFocus={withHistory}
            onChange={(e) =>
              updateSettings({ studSpacingMm: Number(e.target.value) as 400 | 600 })
            }
          >
            <option value={400}>400</option>
            <option value={600}>600</option>
          </select>
        </label>
        <label className="field">
          <span>Шаг балок/стропил, мм</span>
          <select
            value={project.settings.joistSpacingMm}
            onFocus={withHistory}
            onChange={(e) =>
              updateSettings({ joistSpacingMm: Number(e.target.value) as 400 | 600 })
            }
          >
            <option value={400}>400</option>
            <option value={600}>600</option>
          </select>
        </label>
        <label className="field">
          <span>Высота этажа, мм</span>
          <input
            type="number"
            step={50}
            value={project.settings.floorHeightMm}
            onFocus={withHistory}
            onChange={(e) => updateSettings({ floorHeightMm: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Фундамент</span>
          <select
            value={project.settings.foundationType}
            onFocus={withHistory}
            onChange={(e) =>
              updateSettings({ foundationType: e.target.value as FoundationType })
            }
          >
            <option value="pile">Свайный</option>
            <option value="strip">Ленточный</option>
            <option value="slab">Плита</option>
          </select>
        </label>
      </section>

      <section className="panel-section">
        <h3>Материалы</h3>
        <label className="field">
          <span>Наружная обшивка</span>
          <select
            value={project.settings.exteriorCladding}
            onFocus={withHistory}
            onChange={(e) =>
              updateSettings({ exteriorCladding: e.target.value as ExteriorCladding })
            }
          >
            {Object.values(EXTERIOR_CLADDING).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Внутренние стены</span>
          <select
            value={project.settings.interiorFinish}
            onFocus={withHistory}
            onChange={(e) =>
              updateSettings({ interiorFinish: e.target.value as InteriorFinish })
            }
          >
            {Object.values(INTERIOR_FINISH).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Пол</span>
          <select
            value={project.settings.floorFinish}
            onFocus={withHistory}
            onChange={(e) => updateSettings({ floorFinish: e.target.value as FloorFinish })}
          >
            {Object.values(FLOOR_FINISH).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel-section">
        <h3>Утеплитель</h3>
        <label className="field">
          <span>Тип (λ)</span>
          <select
            onFocus={withHistory}
            onChange={(e) => {
              const opt = INSULATION_OPTIONS.find((x) => x.id === e.target.value);
              if (!opt) return;
              updateInsulation({
                wallLambda: opt.lambda,
                floorLambda: opt.lambda,
                ceilingLambda: opt.lambda,
              });
              updateSettings({ insulationPriceRubPerM3: opt.priceRubPerM3 });
            }}
            defaultValue="rockwool"
          >
            {INSULATION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} (λ={o.lambda})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Толщина стен, мм</span>
          <input
            type="number"
            step={10}
            value={project.settings.insulation.wallThicknessMm}
            onFocus={withHistory}
            onChange={(e) => updateInsulation({ wallThicknessMm: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Толщина пола, мм</span>
          <input
            type="number"
            step={10}
            value={project.settings.insulation.floorThicknessMm}
            onFocus={withHistory}
            onChange={(e) => updateInsulation({ floorThicknessMm: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Толщина потолка, мм</span>
          <input
            type="number"
            step={10}
            value={project.settings.insulation.ceilingThicknessMm}
            onFocus={withHistory}
            onChange={(e) => updateInsulation({ ceilingThicknessMm: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="panel-section">
        <h3>Климат (теплопотери)</h3>
        <label className="field">
          <span>Регион</span>
          <select
            value={project.settings.climate.regionName}
            onFocus={withHistory}
            onChange={(e) => {
              const p = CLIMATE_PRESETS.find((x) => x.regionName === e.target.value);
              if (p) updateClimate({ regionName: p.regionName, designOutdoorC: p.designOutdoorC });
            }}
          >
            {CLIMATE_PRESETS.map((p) => (
              <option key={p.regionName} value={p.regionName}>
                {p.regionName} ({p.designOutdoorC}°C)
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>T внутри, °C</span>
          <input
            type="number"
            value={project.settings.climate.designIndoorC}
            onFocus={withHistory}
            onChange={(e) => updateClimate({ designIndoorC: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Кратность воздухообмена, 1/ч</span>
          <input
            type="number"
            step={0.1}
            value={project.settings.climate.airExchangeRate}
            onFocus={withHistory}
            onChange={(e) => updateClimate({ airExchangeRate: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="panel-section">
        <h3>Мебель</h3>
        <div className="tool-grid">
          {[
            ['sofa', 'Диван'],
            ['bed', 'Кровать'],
            ['table', 'Стол'],
            ['wardrobe', 'Шкаф'],
          ].map(([id, label]) => (
            <button key={id} type="button" className="tool" onClick={() => addFurniture(id)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {selectedOpening && (
        <section className="panel-section highlight">
          <h3>{selectedOpening.type === 'window' ? 'Окно' : 'Дверь'}</h3>
          <label className="field">
            <span>Ширина, мм</span>
            <input
              type="number"
              value={selectedOpening.width}
              onFocus={withHistory}
              onChange={(e) => updateOpening(selectedOpening.id, { width: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Высота, мм</span>
            <input
              type="number"
              value={selectedOpening.height}
              onFocus={withHistory}
              onChange={(e) =>
                updateOpening(selectedOpening.id, { height: Number(e.target.value) })
              }
            />
          </label>
          {selectedOpening.type === 'window' && (
            <label className="field">
              <span>Высота установки (подоконник), мм</span>
              <input
                type="number"
                value={selectedOpening.sillHeight}
                onFocus={withHistory}
                onChange={(e) =>
                  updateOpening(selectedOpening.id, { sillHeight: Number(e.target.value) })
                }
              />
            </label>
          )}
          <label className="field">
            <span>Смещение вдоль стены, мм</span>
            <input
              type="number"
              value={selectedOpening.offset}
              onFocus={withHistory}
              onChange={(e) =>
                updateOpening(selectedOpening.id, { offset: Number(e.target.value) })
              }
            />
          </label>
        </section>
      )}

      {selectedWall && (
        <section className="panel-section highlight">
          <h3>Стена</h3>
          <p className="muted">
            Длина {(wallLength(selectedWall) / 1000).toFixed(2)} м ·{' '}
            {selectedWall.kind === 'exterior' ? 'наружная' : 'внутренняя'}
          </p>
          <label className="field">
            <span>Толщина, мм</span>
            <input
              type="number"
              value={selectedWall.thickness}
              onFocus={withHistory}
              onChange={(e) => updateWall(selectedWall.id, { thickness: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Тип</span>
            <select
              value={selectedWall.kind}
              onFocus={withHistory}
              onChange={(e) =>
                updateWall(selectedWall.id, {
                  kind: e.target.value as 'exterior' | 'interior',
                })
              }
            >
              <option value="exterior">Наружная</option>
              <option value="interior">Внутренняя</option>
            </select>
          </label>
        </section>
      )}

      <div className="panel-actions">
        <button type="button" className="tool" onClick={download}>
          Экспорт JSON
        </button>
        <button type="button" className="tool" onClick={() => fileRef.current?.click()}>
          Открыть JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void onImportFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <button type="button" className="tool ghost" onClick={resetDemo}>
          Демо 6×8
        </button>
      </div>
    </aside>
  );
}
