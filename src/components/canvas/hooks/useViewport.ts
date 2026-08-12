import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../../store/editorStore';

export function useViewport(containerRef: React.RefObject<HTMLDivElement | null>) {
  const scale = useEditorStore((s) => s.scale);
  const offset = useEditorStore((s) => s.offset);
  const setScale = useEditorStore((s) => s.setScale);
  const setOffset = useEditorStore((s) => s.setOffset);
  const fitView = useEditorStore((s) => s.fitView);
  const activeFloor = useEditorStore((s) => s.project.activeFloor);

  const [size, setSize] = useState({ width: 800, height: 600 });
  const [spacePan, setSpacePan] = useState(false);
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const fittedFloor = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, [containerRef]);

  // Fit when switching floors (keep persisted viewport on first mount)
  useEffect(() => {
    if (size.width < 100 || size.height < 100) return;
    if (fittedFloor.current === null) {
      fittedFloor.current = activeFloor;
      return;
    }
    if (fittedFloor.current === activeFloor) return;
    fittedFloor.current = activeFloor;
    fitView(size);
  }, [activeFloor, size, fitView]);

  const toWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - offset.x) / scale,
      y: (sy - offset.y) / scale,
    }),
    [offset, scale],
  );

  const startPan = useCallback(
    (clientX: number, clientY: number) => {
      panRef.current = {
        active: true,
        startX: clientX,
        startY: clientY,
        origX: offset.x,
        origY: offset.y,
      };
      setPanning(true);
    },
    [offset],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const pan = panRef.current;
      if (!pan?.active) return;
      setOffset({
        x: pan.origX + (e.clientX - pan.startX),
        y: pan.origY + (e.clientY - pan.startY),
      });
    };
    const onUp = () => {
      if (panRef.current?.active) {
        panRef.current = null;
        setPanning(false);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setOffset]);

  const zoomAt = useCallback(
    (pointer: { x: number; y: number }, factor: number) => {
      const newScale = Math.min(0.4, Math.max(0.02, scale * factor));
      const world = {
        x: (pointer.x - offset.x) / scale,
        y: (pointer.y - offset.y) / scale,
      };
      setScale(newScale);
      setOffset({
        x: pointer.x - world.x * newScale,
        y: pointer.y - world.y * newScale,
      });
    },
    [scale, offset, setScale, setOffset],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      zoomAt({ x: size.width / 2, y: size.height / 2 }, factor);
    },
    [zoomAt, size],
  );

  const fit = useCallback(() => {
    fitView(size);
  }, [fitView, size]);

  return {
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
  };
}
