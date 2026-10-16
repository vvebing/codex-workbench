import type { ReactNode } from "react";

export const settingsInputClass =
  "block min-h-10 min-w-0 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm outline-accent disabled:opacity-50 max-[900px]:min-h-11 max-[900px]:text-base";

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
    <section className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      {(title || description) && (
        <header className="flex items-start justify-between gap-4 max-[550px]:flex-wrap max-[550px]:gap-3">
          <div className="grid min-w-0 gap-2">
            {title && <h4 className="text-sm font-semibold">{title}</h4>}
            {description && (
              <p className="text-xs leading-relaxed text-muted">
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
    <div className="grid min-w-0 gap-2">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {description && (
        <p
          id={`${id}-description`}
          className="text-xs leading-relaxed text-muted"
        >
          {description}
        </p>
      )}
    </div>
  );
}

export function SettingsActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
      {children}
    </div>
  );
}
