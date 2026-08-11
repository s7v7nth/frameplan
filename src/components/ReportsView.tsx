import { useMemo } from 'react';
import { useEditorStore, useFrameModel } from '../store/editorStore';

function money(n: number) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(n);
}

const KIND_RU: Record<string, string> = {
  sill: 'лежень',
  bottom_plate: 'нижняя обвязка',
  top_plate: 'верхняя обвязка',
  stud: 'стойка',
  king_stud: 'королевская стойка',
  jack_stud: 'джек',
  header: 'перемычка',
  cripple: 'коротыш',
  joist: 'балка',
  rim_joist: 'обвязочная балка',
  rafter: 'стропило',
  ridge: 'конёк',
  blocking: 'блокировка',
};

export function ReportsView() {
  const tab = useEditorStore((s) => s.tab);
  const model = useFrameModel();

  const bomTotal = useMemo(() => model.bom.reduce((s, l) => s + l.total, 0), [model.bom]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of model.members) {
      map.set(m.kind, (map.get(m.kind) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [model.members]);

  if (tab === 'editor') return null;

  return (
    <div className="reports">
      <div className="summary-bar">
        <div>
          <span className="k">Площадь</span>
          <strong>{model.summary.footprintM2.toFixed(1)} м²</strong>
        </div>
        <div>
          <span className="k">Отапливаемая</span>
          <strong>{model.summary.heatedAreaM2.toFixed(1)} м²</strong>
        </div>
        <div>
          <span className="k">Стойки/джеки</span>
          <strong>{model.summary.studCount}</strong>
        </div>
        <div>
          <span className="k">Пиломатериал</span>
          <strong>{model.summary.lumberVolumeM3.toFixed(2)} м³</strong>
        </div>
        <div>
          <span className="k">Теплопотери</span>
          <strong>{(model.heatLoss.totalW / 1000).toFixed(1)} кВт</strong>
        </div>
        <div>
          <span className="k">Смета</span>
          <strong>{money(bomTotal)}</strong>
        </div>
      </div>

      {tab === 'frame' && (
        <div className="report-grid">
          <section className="card-plain wide">
            <h3>План каркаса (стойки, джеки, хедеры, балки)</h3>
            <div
              className="svg-frame tall"
              dangerouslySetInnerHTML={{ __html: model.projections.planSvg }}
            />
            <div className="kind-chips">
              {counts.map(([kind, n]) => (
                <span key={kind} className="chip">
                  {KIND_RU[kind] ?? kind}: <b>{n}</b>
                </span>
              ))}
            </div>
          </section>

          <section className="card-plain">
            <h3>Фасад — каркас</h3>
            <div
              className="svg-frame tall"
              dangerouslySetInnerHTML={{ __html: model.projections.elevationFrontSvg }}
            />
          </section>
          <section className="card-plain">
            <h3>Торец — каркас</h3>
            <div
              className="svg-frame tall"
              dangerouslySetInnerHTML={{ __html: model.projections.elevationSideSvg }}
            />
          </section>
          <section className="card-plain wide">
            <h3>План стропил</h3>
            <div
              className="svg-frame tall"
              dangerouslySetInnerHTML={{ __html: model.projections.roofSvg }}
            />
          </section>

          <section className="card-plain wide">
            <h3>Развёртки стен (узлы проёмов: king / jack / header / cripple)</h3>
            <div className="elev-gallery">
              {model.projections.wallElevations.map((w) => (
                <div key={w.wallId} className="elev-item">
                  <div className="elev-title">{w.title}</div>
                  <div
                    className="svg-frame"
                    dangerouslySetInnerHTML={{ __html: w.svg }}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="card-plain wide">
            <h3>Ведомость элементов каркаса (СП 31-105-2002)</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Категория</th>
                    <th>Наименование</th>
                    <th>Сечение</th>
                    <th>Длина</th>
                    <th>Кол-во</th>
                    <th>Этаж</th>
                  </tr>
                </thead>
                <tbody>
                  {model.lumber.map((p) => (
                    <tr key={p.id}>
                      <td>{KIND_RU[p.category] ?? p.category}</td>
                      <td>{p.label}</td>
                      <td>
                        {p.sectionMm.width}×{p.sectionMm.depth}
                      </td>
                      <td>{p.lengthMm}</td>
                      <td>{p.qty}</td>
                      <td>{p.floor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'cutting' && (
        <div className="report-grid">
          {model.cutting.map((c, idx) => (
            <section className="card-plain" key={idx}>
              <h3>
                Раскрой {c.sectionMm.width}×{c.sectionMm.depth} → хлысты {c.stockLengthMm} мм
              </h3>
              <p className="muted">
                Нужно досок: <strong>{c.boardsNeeded}</strong> · утилизация{' '}
                {(c.utilization * 100).toFixed(0)}% · отход {c.wasteMm} мм
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Деталь</th>
                      <th>Длина, мм</th>
                      <th>Кол-во</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.pieces.map((p, i) => (
                      <tr key={i}>
                        <td>{p.label}</td>
                        <td>{p.lengthMm}</td>
                        <td>{p.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === 'estimate' && (
        <div className="report-grid">
          <section className="card-plain wide">
            <h3>Сметный лист материалов</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Группа</th>
                    <th>Наименование</th>
                    <th>Ед.</th>
                    <th>Кол-во</th>
                    <th>Цена</th>
                    <th>Сумма</th>
                    <th>Примечание</th>
                  </tr>
                </thead>
                <tbody>
                  {model.bom.map((l) => (
                    <tr key={l.id}>
                      <td>{l.group}</td>
                      <td>{l.name}</td>
                      <td>{l.unit}</td>
                      <td>{l.qty}</td>
                      <td>{money(l.unitPrice)}</td>
                      <td>{money(l.total)}</td>
                      <td>{l.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>
                      <strong>Итого</strong>
                    </td>
                    <td colSpan={2}>
                      <strong>{money(bomTotal)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'thermal' && (
        <div className="report-grid">
          <section className="card-plain wide">
            <h3>Калькулятор теплопотерь</h3>
            <p className="muted">
              Объём {model.heatLoss.volumeM3.toFixed(1)} м³ · удельные потери{' '}
              {model.heatLoss.specificWm2.toFixed(0)} Вт/м² · трансмиссия{' '}
              {(model.heatLoss.transmissionW / 1000).toFixed(2)} кВт · вентиляция{' '}
              {(model.heatLoss.ventilationW / 1000).toFixed(2)} кВт
            </p>
            <div className="heat-total">
              Расчётная мощность отопления:{' '}
              <strong>{(model.heatLoss.totalW / 1000).toFixed(2)} кВт</strong>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ограждение</th>
                    <th>Площадь, м²</th>
                    <th>U, Вт/(м²·К)</th>
                    <th>ΔT, °C</th>
                    <th>Потери, Вт</th>
                  </tr>
                </thead>
                <tbody>
                  {model.heatLoss.surfaces.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.areaM2.toFixed(2)}</td>
                      <td>{s.uValue.toFixed(3)}</td>
                      <td>{s.deltaT.toFixed(1)}</td>
                      <td>{s.lossW.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
