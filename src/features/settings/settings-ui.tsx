import type { ReactNode } from "react";

export const settingsInputClass =
  "block min-h-10 min-w-0 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-accent transition-colors hover:border-subtle focus-visible:border-accent disabled:opacity-50 max-[900px]:min-h-11 max-[900px]:text-base";

export const settingsSelectClass =
  "min-h-10 min-w-0 w-full text-sm max-[900px]:min-h-11";

export function SettingsSection({
  title,
  description,
  trailing,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="@container min-w-0 space-y-4 border-t border-border pt-6 first:border-t-0 first:pt-0 [overflow-wrap:anywhere]">
      {(title || description) && (
        <header className="flex items-start justify-between gap-4 max-[550px]:flex-col max-[550px]:gap-3">
          <div className="grid min-w-0 gap-1.5 max-[550px]:w-full">
            {title && <h4 className="text-sm font-semibold">{title}</h4>}
            {description && (
              <p className="max-w-prose text-caption leading-copy text-muted">
                {description}
              </p>
            )}
          </div>
          {trailing}
        </header>
      )}
      {children}
    </section>
  );
}

export function SettingsField({
  id,
  label,
  description,
  children,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 items-start gap-x-6 gap-y-2 @min-[560px]:grid-cols-[minmax(0,1fr)_minmax(180px,240px)]">
      <div className="min-w-0 space-y-1.5">
        <label htmlFor={id} className="block text-control font-medium">
          {label}
        </label>
        {description && (
          <p
            id={`${id}-description`}
            className="text-caption leading-copy text-muted"
          >
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
      {children}
    </div>
  );
}
