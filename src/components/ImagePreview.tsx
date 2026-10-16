import { useEffect, useRef, useState, type RefObject } from "react";
import { Dialog } from "radix-ui";
import { ImageOff, X, ZoomIn } from "lucide-react";
import { IconButton } from "./ui";

export interface PreviewImage {
  url: string;
  name: string;
}

/** Shared by draft attachments and sent conversation images. */
export function ImagePreview({
  image,
  onClose,
  triggerRef,
}: {
  image?: PreviewImage;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog.Root
      open={!!image}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (triggerRef.current?.isConnected) triggerRef.current.focus();
          }}
          className="fixed top-1/2 left-1/2 z-[80] flex max-h-[90dvh] w-[min(92vw,1000px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-xl border border-border bg-elevated p-4 text-foreground shadow-xl"
        >
          <div className="flex shrink-0 items-center gap-3">
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm">
              {image?.name}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="关闭图片预览">
                <X size={18} aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>
          {image && <PreviewContent image={image} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function PreviewContent({ image }: { image: PreviewImage }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image.url]);
  return failed ? (
    <div
      role="status"
      className="flex min-h-40 flex-col items-center justify-center gap-3 text-sm text-muted"
    >
      <ImageOff size={28} aria-hidden="true" />
      图片无法加载
    </div>
  ) : (
    <img
      src={image.url}
      alt={image.name}
      onError={() => setFailed(true)}
      className="min-h-0 max-h-[75dvh] w-full object-contain"
    />
  );
}
export function imageSource(url: string) {
  return /^(?:https?:\/\/|blob:|data:image\/)/i.test(url);
}

/** Bounded, uncropped thumbnails keep multi-image messages compact. */
export function ConversationImage({
  src,
  name,
}: {
  src: string;
  name: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setOpen(false);
  }, [src]);
  const valid = imageSource(src);
  return (
    <span
      data-slot="conversation-image"
      className="my-1 mr-2 inline-flex max-w-full align-top"
    >
      <button
        ref={trigger}
        type="button"
        aria-label={`预览图片 ${name}`}
        title={`预览图片 ${name}`}
        disabled={!valid}
        onClick={() => setOpen(true)}
        className="group/image relative inline-flex max-w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border border-border bg-elevated p-1 hover:border-accent focus-visible:outline-accent"
      >
        {valid && !failed ? (
          <img
            src={src}
            alt={name}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="!m-0 !h-24 !w-32 !max-w-full rounded bg-surface object-contain"
          />
        ) : (
          <span
            role="img"
            aria-label={name}
            className="flex h-24 w-32 flex-col items-center justify-center gap-2 rounded bg-surface text-xs text-muted"
          >
            <ImageOff size={20} aria-hidden="true" />
            图片无法加载
          </span>
        )}
        {valid && !failed && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2 bottom-2 rounded bg-elevated/90 p-1 text-muted opacity-0 group-hover/image:opacity-100 group-focus-visible/image:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <ZoomIn size={14} />
          </span>
        )}
      </button>
      <ImagePreview
        image={open && valid ? { url: src, name } : undefined}
        onClose={() => setOpen(false)}
        triggerRef={trigger}
      />
    </span>
  );
}
