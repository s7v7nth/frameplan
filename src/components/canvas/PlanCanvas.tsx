import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Stage, Layer } from 'react-konva';
import {
  resolveDraftSnap,
  gridStepForScale,
  type MagnetHit,
} from '../../domain/geometry';
import type { Point } from '../../domain/types';
import { useEditorStore } from '../../store/editorStore';
import { CanvasChrome } from './CanvasChrome';
import { useViewport } from './hooks/useViewport';
import { useCanvasHotkeys } from './hooks/useCanvasHotkeys';
import { GridLayer } from './layers/GridLayer';
import { WallsLayer } from './layers/WallsLayer';
import { OpeningsLayer } from './layers/OpeningsLayer';
import { FurnitureLayer } from './layers/FurnitureLayer';
import { OverlayLayer } from './layers/OverlayLayer';
import type { MagnetFeedback, MeasureDraft } from './interaction/types';

export function PlanCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wallDragRef = useRef({
    id: '',
    x: 0,
    y: 0,
    lastDx: 0,
    lastDy: 0,
    invalid: false,
  });
  const snapPrevRef = useRef<MagnetHit | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [dragInvalid, setDragInvalid] = useState(false);
  const [dragRejectFlash, setDragRejectFlash] = useState(false);
  const [hover, setHover] = useState<Point | null>(null);
  const [magnetAt, setMagnetAt] = useState<MagnetFeedback | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [measure, setMeasure] = useState<MeasureDraft>({ a: null, b: null });

  const project = useEditorStore((s) => s.project);
  const tool = useEditorStore((s) => s.tool);
  const selectedId = useEditorStore((s) => s.selectedId);
  const draftStart = useEditorStore((s) => s.draftStart);
  const wallKind = useEditorStore((s) => s.wallKind);
  const select = useEditorStore((s) => s.select);
  const beginWall = useEditorStore((s) => s.beginWall);
  const finishWall = useEditorStore((s) => s.finishWall);
  const addOpeningAt = useEditorStore((s) => s.addOpeningAt);
  const cancelDraft = useEditorStore((s) => s.cancelDraft);

  const {
    size,
    scale,
    offset,
    spacePan,
    setSpacePan,
    panning,
    toWorld,
    startPan,
    zoomAt,
    zoomBy,
    fit,
  } = useViewport(containerRef);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1400);
  }, []);

  const onCancelMeasure = useCallback(() => {
    setMeasure({ a: null, b: null });
  }, []);

  useCanvasHotkeys({ setSpacePan, fit, onCancelMeasure });

  const draftThickness = wallKind === 'exterior' ? 200 : 120;

  useEffect(() => {
    snapPrevRef.current = null;
  }, [tool, draftStart]);

  useEffect(() => {
    setMeasure({ a: null, b: null });
  }, [tool]);

  const walls = useMemo(
    () => project.walls.filter((w) => w.floor === project.activeFloor),
    [project.walls, project.activeFloor],
  );
  const furniture = useMemo(
    () => project.furniture.filter((f) => f.floor === project.activeFloor),
    [project.furniture, project.activeFloor],
  );
  const openings = useMemo(
    () => project.openings.filter((o) => walls.some((w) => w.id === o.wallId)),
    [project.openings, walls],
  );

  const gridMm = gridStepForScale(scale);
  const viewCenter = useMemo(
    () => ({
      x: (size.width / 2 - offset.x) / scale,
      y: (size.height / 2 - offset.y) / scale,
    }),
    [size, offset, scale],
  );
  const viewSizeMm = useMemo(
    () => ({ w: size.width / scale, h: size.height / scale }),
    [size, scale],
  );

  const placeWall = useCallback(
    (world: Point) => {
      if (!draftStart) {
        beginWall(world);
        return;
      }
      const snapped = resolveDraftSnap(world, walls, {
        from: draftStart,
        scale,
        selfThickness: draftThickness,
      }).point;
      const result = finishWall(snapped);
      if (result === 'too_short') showToast('Слишком короткий сегмент');
      if (result === 'collision') showToast('Нельзя сюда');
    },
    [draftStart, beginWall, finishWall, walls, scale, draftThickness, showToast],
  );

  const onStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    const evt = e.evt;
    if (evt.button === 1 || evt.button === 2 || spacePan) {
      evt.preventDefault();
      startPan(evt.clientX, evt.clientY);
      return;
    }
    if (evt.button !== 0) return;

    const stage = e.target.getStage();
    if (!stage) return;
    const isEmpty = e.target === stage;

    if (tool === 'select' && isEmpty) {
      startPan(evt.clientX, evt.clientY);
      select(null);
      return;
    }

    if (!isEmpty) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;
    const world = toWorld(pos.x, pos.y);

    if (tool === 'wall') {
      placeWall(world);
      return;
    }
    if (tool === 'window') {
      addOpeningAt(world, 'window');
      return;
    }
    if (tool === 'door') {
      addOpeningAt(world, 'door');
      return;
    }
    if (tool === 'measure') {
      const hit = resolveDraftSnap(world, walls, { scale }).point;
      setMeasure((m) => {
        if (!m.a || m.b) return { a: hit, b: null };
        return { a: m.a, b: hit };
      });
    }
  };

  const onStageDblClick = () => {
    if (tool === 'wall' && draftStart) {
      cancelDraft();
      showToast('Цепочка стен завершена');
    }
  };

  const draftLengthM =
    draftStart && hover && tool === 'wall'
      ? Math.hypot(hover.x - draftStart.x, hover.y - draftStart.y) / 1000
      : null;
  const measureLengthM =
    measure.a && measure.b
      ? Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y) / 1000
      : measure.a && hover && tool === 'measure'
        ? Math.hypot(hover.x - measure.a.x, hover.y - measure.a.y) / 1000
        : null;

  return (
    <div
      className="canvas-wrap"
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
    >
      <CanvasChrome
        gridMm={gridMm}
        draftLengthM={draftLengthM}
        measureLengthM={measureLengthM}
        toast={toast}
        onZoomIn={() => zoomBy(1.15)}
        onZoomOut={() => zoomBy(1 / 1.15)}
        onFit={fit}
      />

      <Stage
        width={size.width}
        height={size.height}
        onMouseDown={onStageMouseDown}
        onDblClick={onStageDblClick}
        onMouseMove={(e) => {
          const stage = e.target.getStage();
          const pos = stage?.getPointerPosition();
          if (!pos) return;
          const world = toWorld(pos.x, pos.y);
          if (tool === 'wall') {
            const hit = resolveDraftSnap(world, walls, {
              from: draftStart ?? undefined,
              prev: snapPrevRef.current,
              scale,
              selfThickness: draftThickness,
            });
            snapPrevRef.current = hit;
            setHover(hit.point);
            setMagnetAt({ x: hit.point.x, y: hit.point.y, kind: hit.kind });
          } else if (tool === 'measure') {
            const hit = resolveDraftSnap(world, walls, {
              prev: snapPrevRef.current,
              scale,
            });
            snapPrevRef.current = hit;
            setHover(hit.point);
            setMagnetAt({ x: hit.point.x, y: hit.point.y, kind: hit.kind });
          } else {
            snapPrevRef.current = null;
            setHover(world);
            setMagnetAt(null);
          }
        }}
        onWheel={(e) => {
          e.evt.preventDefault();
          const stage = e.target.getStage();
          const pointer = stage?.getPointerPosition();
          if (!pointer) return;
          const direction = e.evt.deltaY > 0 ? 0.9 : 1.1;
          zoomAt(pointer, direction);
        }}
        style={{
          cursor:
            panning || spacePan
              ? 'grabbing'
              : tool === 'wall' || tool === 'window' || tool === 'door' || tool === 'measure'
                ? 'crosshair'
                : 'default',
        }}
      >
        <Layer x={offset.x} y={offset.y} scaleX={scale} scaleY={scale}>
          <GridLayer scale={scale} viewCenter={viewCenter} viewSizeMm={viewSizeMm} />
          <WallsLayer
            walls={walls}
            openings={openings}
            tool={tool}
            selectedId={selectedId}
            spacePan={spacePan}
            panning={panning}
            dragInvalid={dragInvalid}
            dragRejectFlash={dragRejectFlash}
            toWorld={toWorld}
            wallDragRef={wallDragRef}
            setDragInvalid={setDragInvalid}
            setDragRejectFlash={setDragRejectFlash}
            setMagnetAt={setMagnetAt}
            showToast={showToast}
            onWallPlace={placeWall}
          />
          <OpeningsLayer
            openings={openings}
            walls={walls}
            tool={tool}
            selectedId={selectedId}
            spacePan={spacePan}
            panning={panning}
          />
          <FurnitureLayer
            furniture={furniture}
            tool={tool}
            selectedId={selectedId}
            spacePan={spacePan}
            panning={panning}
          />
          <OverlayLayer
            allWalls={project.walls}
            activeFloor={project.activeFloor}
            tool={tool}
            draftStart={draftStart}
            hover={hover}
            magnetAt={magnetAt}
            measure={measure}
          />
        </Layer>
      </Stage>
    </div>
  );
}
