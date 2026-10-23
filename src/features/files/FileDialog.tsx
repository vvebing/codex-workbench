import { useState, type ReactNode } from "react";
import { Modal } from "../../components/ui";

export function FileDialog({
  children,
  title,
  busy,
  onClose,
}: {
  children: ReactNode;
  title: string;
  busy: boolean;
  onClose: () => void;
}) {
  const [returnFocus] = useState(() =>
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <Modal
      open
      title={title}
      dismissible={!busy}
      returnFocusElement={returnFocus}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {children}
    </Modal>
  );
}
