import { useEffect } from 'react';
import { useEditorStore } from '../../../store/editorStore';
import type { CanvasTool } from '../interaction/types';

type Options = {
  setSpacePan: (v: boolean) => void;
  fit: () => void;
  onCancelMeasure: () => void;
};

export function useCanvasHotkeys({ setSpacePan, fit, onCancelMeasure }: Options) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const store = useEditorStore.getState();

      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePan(true);
      }

      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && e.code === 'KeyY') {
        e.preventDefault();
        store.redo();
        return;
      }

      if (e.code === 'KeyV') store.setTool('select' satisfies CanvasTool);
      if (e.code === 'KeyW') store.setTool('wall');
      if (e.code === 'KeyO') store.setTool('window');
      if (e.code === 'KeyD') store.setTool('door');
      if (e.code === 'KeyM') store.setTool('measure');
      if (e.code === 'KeyF') {
        e.preventDefault();
        fit();
      }
      if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        store.deleteSelected();
      }
      if (e.code === 'Escape') {
        store.cancelDraft();
        onCancelMeasure();
      }
      if (e.code === 'Enter') {
        store.cancelDraft();
        onCancelMeasure();
      }
      if (e.code === 'KeyR') {
        const id = store.selectedId;
        if (!id) return;
        const fur = store.project.furniture.find((f) => f.id === id);
        if (!fur) return;
        e.preventDefault();
        store.rotateFurniture(id, e.shiftKey ? -15 : 15);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePan(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [setSpacePan, fit, onCancelMeasure]);
}
