import { useEffect, useRef, type ReactNode } from "react";

export function FileDialog({
  children,
  titleId,
  busy,
  onClose,
}: {
  children: ReactNode;
  titleId: string;
  busy: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = window.document.activeElement;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      className="file-modal"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
