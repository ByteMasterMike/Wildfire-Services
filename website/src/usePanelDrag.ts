import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { nearestPanelSlot } from './panelOrder.ts';

interface DragSession {
  id: number; pointerId: number; handle: HTMLElement; panel: HTMLElement; active: boolean;
  left: number; top: number; width: number; height: number;
  startX: number; startY: number; scrollX: number; scrollY: number;
  x: number; y: number; lastFrame: number;
}

export function usePanelDrag(onReorder: (id: number, index: number) => void) {
  const gridRef = useRef<HTMLDivElement>(null);
  const session = useRef<DragSession | null>(null);
  const frame = useRef(0);
  const ignoreClick = useRef(false);
  const settleFrom = useRef<Map<HTMLElement, {left: number; top: number}> | null>(null);
  const animations = useRef(new Set<Animation>());
  const reorder = useRef(onReorder); reorder.current = onReorder;
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);

  function stopMotion() {
    for (const animation of animations.current) animation.cancel();
    animations.current.clear();
  }

  useLayoutEffect(() => {
    const previous = settleFrom.current;
    if (!previous) return;
    settleFrom.current = null;
    stopMotion();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [element, before] of previous) {
      if (!element.isConnected) continue;
      const after = element.getBoundingClientRect();
      const x = before.left - after.left - window.scrollX;
      const y = before.top - after.top - window.scrollY;
      if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
      const animation = element.animate([
        {transform: `translate3d(${x}px, ${y}px, 0)`}, {transform: 'translate3d(0, 0, 0)'},
      ], {duration: 180, easing: 'cubic-bezier(.2,.75,.25,1)'});
      animations.current.add(animation);
      animation.onfinish = () => animations.current.delete(animation);
    }
  });

  function target(drag: DragSession) {
    const slots = Array.from(gridRef.current?.children ?? []).map(element => {
      const rect = element.getBoundingClientRect();
      return {id: Number((element as HTMLElement).dataset.panelId), left: rect.left, top: rect.top, width: rect.width, height: rect.height};
    });
    const index = nearestPanelSlot({x: drag.left + drag.width / 2 + drag.x - drag.startX, y: drag.top + drag.height / 2 + drag.y - drag.startY}, slots);
    return index === null ? null : {index, id: slots[index].id};
  }

  function place(drag: DragSession) {
    const x = drag.x - drag.startX + window.scrollX - drag.scrollX;
    const y = drag.y - drag.startY + window.scrollY - drag.scrollY;
    drag.panel.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    setTargetId(target(drag)?.id ?? null);
  }

  function finish(commit: boolean, notify = true) {
    const drag = session.current;
    if (!drag) return;
    const destination = commit && drag.active ? target(drag) : null;
    if (notify && drag.active) {
      settleFrom.current = new Map(Array.from(gridRef.current?.querySelectorAll<HTMLElement>('.workspace-panel:not(.is-expanded)') ?? []).map(element => {
        const rect = element.getBoundingClientRect();
        return [element, {left: rect.left + window.scrollX, top: rect.top + window.scrollY}];
      }));
    }
    session.current = null;
    cancelAnimationFrame(frame.current);
    drag.panel.style.removeProperty('transform');
    document.documentElement.classList.remove('is-reordering-panels');
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    ignoreClick.current = drag.active;
    if (notify) { setDraggingId(null); setTargetId(null); }
    if (destination) reorder.current(drag.id, destination.index);
  }

  function tick(time: number) {
    const drag = session.current;
    if (!drag?.active) return;
    if (!drag.panel.isConnected) { finish(false); return; }
    const elapsed = Math.min(32, time - drag.lastFrame) / 16.67;
    drag.lastFrame = time;
    const edge = 72;
    const speed = drag.y < edge ? -Math.min(1, (edge - drag.y) / edge)
      : drag.y > window.innerHeight - edge ? Math.min(1, (drag.y - window.innerHeight + edge) / edge) : 0;
    if (speed) window.scrollBy({top: speed * 14 * elapsed, behavior: 'instant'});
    place(drag);
    frame.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = session.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.x = event.clientX; drag.y = event.clientY;
      if (!drag.active) {
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
        drag.active = true;
        drag.handle.setPointerCapture(drag.pointerId);
        document.documentElement.classList.add('is-reordering-panels');
        setDraggingId(drag.id);
        drag.lastFrame = performance.now();
        frame.current = requestAnimationFrame(tick);
      }
      event.preventDefault();
      place(drag);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== session.current?.pointerId) return;
      session.current.x = event.clientX; session.current.y = event.clientY;
      finish(true);
    };
    const cancelPointer = (event: PointerEvent) => { if (event.pointerId === session.current?.pointerId) finish(false); };
    const lostCapture = (event: PointerEvent) => { if (event.target === session.current?.handle) cancelPointer(event); };
    const cancel = () => finish(false);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && session.current) { event.preventDefault(); finish(false); } };
    window.addEventListener('pointermove', move, {passive: false});
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('lostpointercapture', lostCapture);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('lostpointercapture', lostCapture);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      finish(false, false);
      stopMotion();
      settleFrom.current = null;
    };
  }, []);

  function start(event: ReactPointerEvent<HTMLElement>, id: number) {
    ignoreClick.current = false;
    if (event.button !== 0 || !event.isPrimary || session.current) return;
    const control = (event.target as Element).closest('button, input, select, textarea, a, summary, [contenteditable="true"]');
    if (control && !control.classList.contains('panel-title-button')) return;
    stopMotion();
    const panel = event.currentTarget.closest<HTMLElement>('.workspace-panel')!;
    const rect = panel.getBoundingClientRect();
    session.current = {id, pointerId: event.pointerId, handle: event.currentTarget, panel, active: false,
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      startX: event.clientX, startY: event.clientY, scrollX: window.scrollX, scrollY: window.scrollY,
      x: event.clientX, y: event.clientY, lastFrame: 0};
  }

  function suppressDragClick(event: ReactMouseEvent) {
    if (!ignoreClick.current) return;
    event.preventDefault(); event.stopPropagation(); ignoreClick.current = false;
  }

  return {gridRef, draggingId, targetId, start, suppressDragClick, stopMotion};
}
