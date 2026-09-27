import { useRef, type PointerEvent, type MouseEvent } from "react";

// Require both ends of the gesture on the backdrop. Dragging from a field
// or clicking the dialog's own padding must not discard an edit.
export function useBackdropDismiss(close: () => void, disabled = false) {
  const startedOutside = useRef(false);
  function outside(
    event: PointerEvent<HTMLDialogElement> | MouseEvent<HTMLDialogElement>,
  ) {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }
  return {
    onPointerDown(event: PointerEvent<HTMLDialogElement>) {
      startedOutside.current = event.button === 0 && outside(event);
    },
    onClick(event: MouseEvent<HTMLDialogElement>) {
      const dismiss = startedOutside.current && outside(event);
      startedOutside.current = false;
      if (dismiss && !disabled) close();
    },
  };
}
