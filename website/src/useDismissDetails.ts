import { useEffect, type RefObject } from 'react';

export function useDismissDetails(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const dismiss = (event: Event) => {
      const element = ref.current;
      if (element?.open && event.target instanceof Node && !element.contains(event.target)) element.open = false;
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('focusin', dismiss, true);
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('focusin', dismiss, true); };
  }, [ref]);
}
