import { useState } from "react";
import { ImageOff } from "lucide-react";

export interface PreviewImage {
  url: string;
  name: string;
}

/** Shared rendering; callers supply the modal or workspace layout bounds. */
export function ImageViewer({
  image,
  className = "",
}: {
  image: PreviewImage;
  className?: string;
}) {
  return <ImageContent key={image.url} image={image} className={className} />;
}

function ImageContent({
  image,
  className,
}: {
  image: PreviewImage;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div
      role="status"
      className={`flex min-h-0 flex-col items-center justify-center gap-3 p-4 text-sm text-muted ${className}`}
    >
      <ImageOff size={28} className="shrink-0" aria-hidden="true" />
      图片无法加载
    </div>
  ) : (
    <img
      src={image.url}
      alt={image.name}
      onError={() => setFailed(true)}
      className={`min-h-0 min-w-0 max-w-full object-contain ${className}`}
    />
  );
}
