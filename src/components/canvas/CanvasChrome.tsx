import { APP_BUILD } from '../../version';
import { useEditorStore } from '../../store/editorStore';
import { CANVAS_TOOLS, type CanvasTool } from './interaction/types';

type Props = {
  gridMm: number;
  draftLengthM: number | null;
  measureLengthM: number | null;
  jointCount: number;
  toast: string | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
};

export function CanvasChrome({
  gridMm,
  draftLengthM,
  measureLengthM,
  jointCount,
  toast,
  onZoomIn,
  onZoomOut,
  onFit,
}: Props) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const wallKind = useEditorStore((s) => s.wallKind);
  const setWallKind = useEditorStore((s) => s.setWallKind);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const pastLen = useEditorStore((s) => s.past.length);
  const futureLen = useEditorStore((s) => s.future.length);
  const activeHint =
    CANVAS_TOOLS.find((t) => t.id === tool)?.hint ??
    (tool === 'delete' ? 'Delete — удалить выделенное' : '');

  const safeTool = (tool === 'delete' ? 'select' : tool) as CanvasTool;

  return (
    <>
      <div className="canvas-toolbar">
        {CANVAS_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={safeTool === t.id ? 'canvas-tool active' : 'canvas-tool'}
            onClick={() => setTool(t.id)}
            title={`${t.hint} (${t.key})`}
          >
            {t.label}
          </button>
        ))}
        {safeTool === 'wall' && (
          <div className="canvas-wall-kind">
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
        <span className="canvas-tool-hint">{activeHint}</span>
        <div className="canvas-history">
          <button type="button" className="canvas-tool" disabled={pastLen === 0} onClick={undo} title="Отменить (Ctrl+Z)">
            Отм.
          </button>
          <button type="button" className="canvas-tool" disabled={futureLen === 0} onClick={redo} title="Вернуть (Ctrl+Shift+Z)">
            Верн.
          </button>
        </div>
      </div>

      <div className="canvas-zoom">
        <button type="button" onClick={onZoomOut} title="Отдалить">
          −
        </button>
        <button type="button" onClick={onFit} title="Вписать (F)">
          ⊕
        </button>
        <button type="button" onClick={onZoomIn} title="Приблизить">
          +
        </button>
      </div>

      {toast && <div className="canvas-toast">{toast}</div>}

      <div className="canvas-statusbar">
        <span>build {APP_BUILD}</span>
        <span>сетка {gridMm} мм · шаг 10 мм · ось ±5°</span>
        <span>стыки {jointCount}</span>
        {draftLengthM != null && <span className="accent">стена {draftLengthM.toFixed(2)} м</span>}
        {measureLengthM != null && (
          <span className="accent">рулетка {measureLengthM.toFixed(2)} м</span>
        )}
        <span>V/W/O/D/M · F вписать · R поворот · Del</span>
      </div>
    </>
  );
}
