/**
 * useDragReorder
 *
 * Provides drag-to-reorder functionality for a list of widget IDs.
 * - Long-press (500ms) on a widget activates drag mode
 * - Drag over another widget to swap positions
 * - Order is persisted to localStorage under the given storageKey
 */
import { useState, useCallback, useRef, useEffect } from "react";

export interface DragReorderState {
  order: string[];
  dragMode: boolean;
  draggingId: string | null;
  dragOverId: string | null;
  activateDragMode: () => void;
  deactivateDragMode: () => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDragEnd: () => void;
  getLongPressProps: (id: string) => {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
  };
  resetOrder: () => void;
}

export function useDragReorder(
  defaultOrder: string[],
  storageKey: string
): DragReorderState {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed: string[] = JSON.parse(saved);
        // Validate — ensure all defaultOrder IDs are present
        const valid = defaultOrder.every((id) => parsed.includes(id)) &&
          parsed.length === defaultOrder.length;
        return valid ? parsed : defaultOrder;
      }
    } catch {
      // ignore
    }
    return defaultOrder;
  });

  const [dragMode, setDragMode] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist order to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(order));
    } catch {
      // ignore
    }
  }, [order, storageKey]);

  const activateDragMode = useCallback(() => setDragMode(true), []);
  const deactivateDragMode = useCallback(() => {
    setDragMode(false);
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const onDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);

  const onDragOver = useCallback((id: string) => {
    setDragOverId(id);
  }, []);

  const onDragEnd = useCallback(() => {
    if (draggingId && dragOverId && draggingId !== dragOverId) {
      setOrder((prev) => {
        const next = [...prev];
        const fromIdx = next.indexOf(draggingId!);
        const toIdx = next.indexOf(dragOverId!);
        if (fromIdx === -1 || toIdx === -1) return prev;
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, draggingId!);
        return next;
      });
    }
    setDraggingId(null);
    setDragOverId(null);
  }, [draggingId, dragOverId]);

  const getLongPressProps = useCallback(
    (id: string) => ({
      onPointerDown: (_e: React.PointerEvent) => {
        if (!dragMode) {
          longPressTimer.current = setTimeout(() => {
            setDragMode(true);
            setDraggingId(id);
            // Haptic feedback on mobile
            if ("vibrate" in navigator) navigator.vibrate(40);
          }, 500);
        } else {
          setDraggingId(id);
        }
      },
      onPointerUp: () => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        if (dragMode) onDragEnd();
      },
      onPointerLeave: () => {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      },
    }),
    [dragMode, onDragEnd]
  );

  const resetOrder = useCallback(() => {
    setOrder(defaultOrder);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [defaultOrder, storageKey]);

  return {
    order,
    dragMode,
    draggingId,
    dragOverId,
    activateDragMode,
    deactivateDragMode,
    onDragStart,
    onDragOver,
    onDragEnd,
    getLongPressProps,
    resetOrder,
  };
}
