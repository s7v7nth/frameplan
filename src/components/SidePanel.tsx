import {
  CLIMATE_PRESETS,
  EXTERIOR_CLADDING,
  FLOOR_FINISH,
  INSULATION_OPTIONS,
  INTERIOR_FINISH,
} from '../domain/materials';
import type { ExteriorCladding, FloorFinish, InteriorFinish, RoofType } from '../domain/types';
import { useEditorStore } from '../store/editorStore';
import { wallLength } from '../domain/geometry';

export function SidePanel() {
  const {
    project,
    selectedId,
    tool,
    wallKind,
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
    checkpoint,
  } = useEditorStore();

  const selectedOpening = project.openings.find((o) => o.id === selectedId);
  const selectedWall = project.walls.find((w) => w.id === selectedId);

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'project'}.frameplan.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="side-panel">
      <div className="brand-block">
        <div className="brand">FramePlan</div>
        <p className="brand-sub">Каркас по СП 31-105-2002</p>
      </div>

      <label className="field">
        <span>Проект</span>
        <input value={project.name} onChange={(e) => setProjectName(e.target.value)} />
      </label>

      <section className="panel-section">
        <h3>Стены</h3>
        <p className="muted" style={{ marginBottom: 8 }}>
          Инструменты на чертеже: V выбор, W стена, O окно, D дверь, M рулетка. Delete — удалить.
        </p>
        {(tool === 'wall' || selectedWall) && (
          <div className="seg">
            <button
              type="button"
              className={(selectedWall?.kind ?? wallKind) === 'exterior' ? 'active' : ''}
              onClick={() => {
                setWallKind('exterior');
                if (selectedWall) {
                  checkpoint();
                  updateWall(selectedWall.id, { kind: 'exterior', thickness: 200 });
                }
              }}
            >
              Наружная
            </button>
            <button
              type="button"
              className={(selectedWall?.kind ?? wallKind) === 'interior' ? 'active' : ''}
              onClick={() => {
                setWallKind('interior');
                if (selectedWall) {
                  checkpoint();
                  updateWall(selectedWall.id, { kind: 'interior', thickness: 120 });
                }
              }}
            >
              Внутренняя
            </button>
          </div>
        )}
      </section>

      <section className="panel-section">
        <h3>Этажи</h3>
        <div className="seg">
          <button
            type="button"
            className={project.settings.floors === 1 ? 'active' : ''}
            onClick={() => updateSettings({ floors: 1 })}
          >
            1 этаж
          </button>
          <button
            type="button"
            className={project.settings.floors === 2 ? 'active' : ''}
            onClick={() => updateSettings({ floors: 2 })}
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
            onChange={(e) => updateSettings({ roofPitchDeg: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Шаг стоек, мм</span>
          <select
            value={project.settings.studSpacingMm}
            onChange={(e) =>
              updateSettings({ studSpacingMm: Number(e.target.value) as 400 | 600 })
            }
          >
            <option value={400}>400</option>
            <option value={600}>600</option>
          </select>
        </label>
        <label className="field">
          <span>Шаг балок, мм</span>
          <select
            value={project.settings.joistSpacingMm}
            onChange={(e) =>
              updateSettings({ joistSpacingMm: Number(e.target.value) as 400 | 600 })
            }
          >
            <option value={400}>400</option>
            <option value={600}>600</option>
          </select>
        </label>
        <label className="field">
          <span>Сечение балок, мм</span>
          <select
            value={`${project.settings.joistSectionMm.width}x${project.settings.joistSectionMm.depth}`}
            onChange={(e) => {
              const [w, d] = e.target.value.split('x').map(Number);
              updateSettings({ joistSectionMm: { width: w, depth: d } });
            }}
          >
            <option value="50x150">50×150</option>
            <option value="50x200">50×200</option>
            <option value="50x250">50×250</option>
            <option value="50x300">50×300</option>
          </select>
        </label>
        <label className="field">
          <span>Высота этажа, мм</span>
          <input
            type="number"
            step={50}
            value={project.settings.floorHeightMm}
            onChange={(e) => updateSettings({ floorHeightMm: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="panel-section">
        <h3>Материалы</h3>
        <label className="field">
          <span>Наружная обшивка</span>
          <select
            value={project.settings.exteriorCladding}
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
            onChange={(e) => updateInsulation({ wallThicknessMm: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Толщина пола, мм</span>
          <input
            type="number"
            step={10}
            value={project.settings.insulation.floorThicknessMm}
            onChange={(e) => updateInsulation({ floorThicknessMm: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Толщина потолка, мм</span>
          <input
            type="number"
            step={10}
            value={project.settings.insulation.ceilingThicknessMm}
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
            onChange={(e) => updateClimate({ designIndoorC: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Кратность воздухообмена, 1/ч</span>
          <input
            type="number"
            step={0.1}
            value={project.settings.climate.airExchangeRate}
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
              onFocus={() => checkpoint()}
              onChange={(e) => updateOpening(selectedOpening.id, { width: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Высота, мм</span>
            <input
              type="number"
              value={selectedOpening.height}
              onFocus={() => checkpoint()}
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
                onFocus={() => checkpoint()}
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
              onFocus={() => checkpoint()}
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
              onFocus={() => checkpoint()}
              onChange={(e) => updateWall(selectedWall.id, { thickness: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Тип</span>
            <select
              value={selectedWall.kind}
              onFocus={() => checkpoint()}
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
        <button type="button" className="tool ghost" onClick={resetDemo}>
          Демо 6×8
        </button>
      </div>
    </aside>
  );
}
