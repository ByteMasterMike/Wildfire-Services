import { useLayoutEffect, useState, type RefObject } from 'react';

// Fit overview rows to actual available space, including header and horizontal scrollbar.
export function useRowCapacity(ref: RefObject<HTMLDivElement | null>, rowSelector: string, ready: boolean, headerSelector?: string) {
  const [capacity, setCapacity] = useState(4);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !ready) return;
    const measure = () => {
      const rowHeight = element.querySelector(rowSelector)?.getBoundingClientRect().height ?? 34;
      const headerHeight = headerSelector ? element.querySelector(headerSelector)?.getBoundingClientRect().height ?? 0 : 0;
      const gap = parseFloat(getComputedStyle(element).rowGap) || 0;
      if (rowHeight > 0) setCapacity(Math.max(1, Math.floor((element.clientHeight - headerHeight + gap) / (rowHeight + gap))));
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [ref, rowSelector, ready, headerSelector]);
  return capacity;
}
