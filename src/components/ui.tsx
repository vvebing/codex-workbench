import { t, useLocale, getLocale } from "../lib/i18n";
import {
  Dialog,
  Checkbox as RadixCheckbox,
  DropdownMenu,
  Select,
  ScrollArea as RadixScrollArea,
} from "radix-ui";
import { X, ChevronDown, ChevronUp, Check, CircleAlert } from "lucide-react";
import {
  useRef,
  type ReactNode,
  type ComponentPropsWithoutRef,
  type Ref,
  type ButtonHTMLAttributes,
} from "react";

export function ErrorNotice({
  children,
  className = "",
  onDismiss,
  ...props
}: ComponentPropsWithoutRef<"div"> & { onDismiss?: () => void }) {
  useLocale();
  return (
    <div
      role="alert"
      data-slot="error-notice"
      {...props}
      className={`flex min-w-0 items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-xs leading-relaxed text-danger ${className}`}
    >
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 whitespace-pre-line [overflow-wrap:anywhere]">
        {children}
      </div>
      {onDismiss && (
        <IconButton
          size="sm"
          onClick={onDismiss}
          label={t("关闭错误提示")}
          className="text-danger hover:bg-danger/10"
        >
          <X size={14} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}

export function ScrollArea({
  children,
  className = "",
  orientation = "vertical",
  scrollChaining = false,
  viewportRef,
  viewportProps,
  ...props
}: ComponentPropsWithoutRef<typeof RadixScrollArea.Root> & {
  orientation?: "vertical" | "horizontal" | "both";
  scrollChaining?: boolean;
  viewportRef?: Ref<HTMLDivElement>;
  viewportProps?: ComponentPropsWithoutRef<typeof RadixScrollArea.Viewport>;
}) {
  useLocale();
  return (
    <RadixScrollArea.Root
      {...props}
      className={`relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden ${className}`}
    >
      <RadixScrollArea.Viewport
        {...viewportProps}
        ref={viewportRef}
        disableImplicitContentElement
        className={`min-h-0 min-w-0 w-full rounded-[inherit] ${scrollChaining ? "overscroll-auto" : "overscroll-contain"} ${viewportProps?.className || ""}`}
      >
        {/* Table layout expands to intrinsic content widths, including nested code blocks. */}
        <RadixScrollArea.Content
          style={{ display: "block", width: "100%", minWidth: 0 }}
        >
          {children}
        </RadixScrollArea.Content>
      </RadixScrollArea.Viewport>
      {(orientation === "vertical" || orientation === "both") && (
        <RadixScrollArea.Scrollbar
          orientation="vertical"
          className="flex w-2.5 touch-none select-none p-0.5"
        >
          <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-muted/35 hover:bg-muted/60" />
        </RadixScrollArea.Scrollbar>
      )}
      {(orientation === "horizontal" || orientation === "both") && (
        <RadixScrollArea.Scrollbar
          orientation="horizontal"
          className="flex h-2.5 touch-none select-none flex-col p-0.5"
        >
          <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-muted/35 hover:bg-muted/60" />
        </RadixScrollArea.Scrollbar>
      )}
      <RadixScrollArea.Corner />
    </RadixScrollArea.Root>
  );
}

const buttonVariants = {
  primary: "border-accent bg-accent text-background hover:bg-accent/90",
  secondary: "border-border bg-elevated hover:bg-hover",
  quiet:
    "border-transparent bg-transparent text-muted hover:bg-hover hover:text-foreground",
  danger: "border-transparent bg-danger-soft text-danger hover:bg-danger/20",
};

export function Checkbox({
  className = "",
  ...props
}: ComponentPropsWithoutRef<typeof RadixCheckbox.Root>) {
  useLocale();
  return (
    <RadixCheckbox.Root
      {...props}
      data-slot="checkbox"
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded border border-border bg-elevated text-background outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-elevated disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-accent data-[state=checked]:bg-accent ${className}`}
    >
      <RadixCheckbox.Indicator>
        <Check size={12} aria-hidden="true" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}

export function Button({
  variant = "secondary",
  size = "default",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: "default" | "sm";
}) {
  useLocale();
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-medium ${size === "sm" ? "min-h-8 px-2 py-1.5 text-caption max-[900px]:min-h-11" : "min-h-9 px-[13px] py-2 text-control max-[900px]:min-h-11"} ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  children,
  className = "",
  size = "default",
  highlighted = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: "default" | "sm" | "composer";
  highlighted?: boolean;
}) {
  useLocale();
  return (
    <button
      type="button"
      data-slot="icon-button"
      data-highlighted={highlighted || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-[7px] border-0 ${highlighted ? "bg-selected text-accent hover:bg-selected hover:text-accent" : "bg-transparent text-muted hover:bg-hover hover:text-foreground"} ${size === "composer" ? "size-[34px] max-[900px]:size-11" : size === "sm" ? "size-6 max-[900px]:size-10" : "size-8 max-[900px]:size-11"} ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

const modalVariants = {
  default:
    "left-1/2 top-1/2 flex flex-col max-h-[85dvh] w-[calc(100%-36px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl",
  search:
    "left-1/2 top-1/2 flex flex-col max-h-[85dvh] w-[calc(100%-36px)] max-w-[660px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl pt-5",
  settings:
    "left-1/2 top-1/2 flex h-[min(720px,90dvh)] max-h-[90dvh] w-[calc(100%-48px)] max-w-[960px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl [--radius-lg:8px] [--radius-xl:12px] [--radius-2xl:16px] max-[900px]:h-[min(720px,92dvh)] max-[900px]:max-h-[92dvh] max-[900px]:w-[calc(100%-24px)]",
  drawer: "inset-y-0 left-0 w-[min(340px,90vw)] overflow-hidden",
  details: "inset-y-0 right-0 w-[min(450px,95vw)] overflow-hidden",
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  variant = "default",
  returnFocusSelector,
  returnFocusElement,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  variant?: keyof typeof modalVariants;
  returnFocusSelector?: string;
  returnFocusElement?: HTMLElement | null;
  dismissible?: boolean;
}) {
  useLocale();
  const returnFocus = useRef<HTMLElement | null>(null);
  const drawer = variant === "drawer" || variant === "details";
  const content = (
    <>
      <div
        data-slot="modal-heading"
        className={
          drawer
            ? "sr-only"
            : `${variant === "settings" ? "mb-1 px-6 pt-5 max-[450px]:px-4 max-[450px]:pt-4" : "mb-[7px]"} flex shrink-0 items-center justify-between gap-3 ${variant === "search" ? "mx-[22px]" : ""}`
        }
      >
        <Dialog.Title
          className={`m-0 font-semibold ${variant === "settings" ? "text-base" : "text-title-sm"}`}
        >
          {title}
        </Dialog.Title>
        {!drawer && (
          <Dialog.Close asChild>
            <IconButton label={t("关闭")} disabled={!dismissible}>
              <X size={18} />
            </IconButton>
          </Dialog.Close>
        )}
      </div>
      <Dialog.Description
        className={
          description && !drawer
            ? variant === "settings"
              ? "mb-5 shrink-0 px-6 text-caption leading-copy text-muted max-[450px]:mb-4 max-[450px]:px-4"
              : `mb-[23px] shrink-0 text-caption leading-copy text-muted ${variant === "search" ? "mx-[22px] mb-3.5" : ""}`
            : "sr-only"
        }
      >
        {description || title}
      </Dialog.Description>
      {children}
    </>
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next || dismissible) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[3px]" />
        <Dialog.Content
          data-slot="modal"
          data-variant={variant}
          className={`fixed z-50 border border-border bg-elevated text-foreground shadow-2xl ${modalVariants[variant]} ${className}`}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusElement ?? returnFocus.current;
            requestAnimationFrame(() => {
              // A drawer can close while opening settings. The new dialog owns focus.
              if (
                document.querySelector('[data-slot="modal"][data-state="open"]')
              )
                return;
              const preferred = returnFocusSelector
                ? [
                    ...document.querySelectorAll<HTMLElement>(
                      returnFocusSelector,
                    ),
                  ].find(
                    (element) =>
                      element.isConnected &&
                      element.checkVisibility() &&
                      !element.closest('[inert], [aria-hidden="true"]'),
                  )
                : null;
              if (preferred?.getClientRects().length) preferred.focus();
              else if (target?.isConnected && target.getClientRects().length)
                target.focus();
              else
                document
                  .querySelector<HTMLElement>(
                    '[data-slot="topbar"] button, [data-slot="sidebar-actions"] button',
                  )
                  ?.focus();
            });
          }}
        >
          {variant === "default" || drawer ? (
            <ScrollArea
              className={drawer ? "h-full" : "min-h-0 max-h-[85dvh]"}
              viewportProps={
                drawer ? { className: "[&>div]:h-full" } : undefined
              }
            >
              <div className={drawer ? "h-full" : "p-6 max-[550px]:p-5"}>
                {content}
              </div>
            </ScrollArea>
          ) : (
            content
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Menu({
  trigger,
  children,
  label,
  open,
  onOpenChange,
  matchTriggerWidth = false,
  align = "end",
}: {
  trigger: ReactNode;
  children: ReactNode;
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  matchTriggerWidth?: boolean;
  align?: "start" | "center" | "end";
}) {
  useLocale();
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          data-slot="menu"
          className={`menu-content z-[60] max-h-[var(--radix-dropdown-menu-content-available-height)] ${matchTriggerWidth ? "min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-24px)]" : "min-w-[205px] max-w-[min(360px,calc(100vw-24px))]"} overflow-hidden rounded-[11px] border border-border bg-elevated text-foreground shadow-xl`}
          sideOffset={8}
          collisionPadding={12}
          align={align}
        >
          <ScrollArea className="max-h-[calc(var(--radix-dropdown-menu-content-available-height)-2px)]">
            <div className="p-[5px]">{children}</div>
          </ScrollArea>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
export const MenuItem = DropdownMenu.Item;
export function MenuLabel(
  props: React.ComponentProps<typeof DropdownMenu.Label>,
) {
  useLocale();
  return (
    <DropdownMenu.Label
      data-slot="menu-label"
      {...props}
      className={`px-2.5 py-[9px] text-fine text-muted ${props.className || ""}`}
    />
  );
}
export function MenuSeparator(
  props: React.ComponentProps<typeof DropdownMenu.Separator>,
) {
  useLocale();
  return (
    <DropdownMenu.Separator
      {...props}
      className={`m-[5px] h-px bg-border ${props.className || ""}`}
    />
  );
}

export function SelectField({
  id,
  label,
  "aria-describedby": descriptionId,
  "aria-invalid": invalid,
  "aria-required": required,
  value,
  onValueChange,
  onOpenChange,
  onCloseAutoFocus,
  options,
  disabled,
  size = "default",
  className = "",
}: {
  id?: string;
  label: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: ComponentPropsWithoutRef<
    typeof Select.Content
  >["onCloseAutoFocus"];
  options: { value: string; label: string; icon?: ReactNode }[];
  disabled?: boolean;
  size?: "default" | "field";
  className?: string;
}) {
  useLocale();
  const typography =
    size === "field" ? "text-sm max-[900px]:text-base" : "text-caption";
  return (
    <Select.Root
      value={value}
      onValueChange={onValueChange}
      onOpenChange={onOpenChange}
      disabled={disabled}
    >
      <Select.Trigger
        id={id}
        className={`inline-flex ${size === "field" ? "min-h-10" : "min-h-9"} min-w-0 max-w-full items-center justify-between max-[900px]:min-h-11 [&>span:first-child]:truncate gap-2 rounded-lg border border-border bg-elevated px-3 py-2 ${typography} hover:bg-hover data-[state=open]:bg-hover ${className}`}
        aria-label={label}
        aria-describedby={descriptionId}
        aria-invalid={invalid}
        aria-required={required}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={15} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          onCloseAutoFocus={onCloseAutoFocus}
          className="z-[70] max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-elevated p-1 text-foreground shadow-lg"
          position="popper"
          collisionPadding={12}
          sideOffset={6}
        >
          <Select.ScrollUpButton className="flex justify-center py-1 text-muted">
            <ChevronUp size={15} />
          </Select.ScrollUpButton>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                className={`flex cursor-pointer items-center justify-between gap-4 rounded px-3 py-2 ${typography} [overflow-wrap:anywhere] outline-none data-[highlighted]:bg-hover data-[state=checked]:text-accent max-[900px]:min-h-11`}
                key={option.value}
                value={option.value}
                textValue={option.label}
              >
                <Select.ItemText className="min-w-0">
                  {option.icon ? (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden="true">{option.icon}</span>
                      <span className="truncate">{option.label}</span>
                    </span>
                  ) : (
                    option.label
                  )}
                </Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="flex justify-center py-1 text-muted">
            <ChevronDown size={15} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function MultiSelectField({
  label,
  value,
  onValueChange,
  options,
  disabled,
  className = "",
  "aria-invalid": invalid,
  "aria-describedby": descriptionId,
}: {
  label: string;
  value: string[];
  onValueChange: (value: string[]) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  useLocale();
  const selected = new Set(value);
  const summary = options
    .filter((option) => selected.has(option.value))
    .map((option) => option.label)
    .join(getLocale() === "zh-CN" ? "、" : ", ");
  return (
    <Menu
      label={label}
      align="start"
      matchTriggerWidth
      trigger={
        <button
          type="button"
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={descriptionId}
          disabled={disabled}
          className={`inline-flex min-h-9 min-w-0 max-w-full items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-caption hover:bg-hover data-[state=open]:bg-hover disabled:opacity-50 max-[900px]:min-h-11 ${className}`}
        >
          <span className="min-w-0 truncate" title={summary || undefined}>
            {summary || t("请选择（可多选）")}
          </span>
          <ChevronDown size={15} className="shrink-0" aria-hidden="true" />
        </button>
      }
    >
      {options.map((option) => (
        <DropdownMenu.CheckboxItem
          key={option.value}
          disabled={disabled}
          checked={selected.has(option.value)}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) => {
            const next = new Set(value);
            if (checked) next.add(option.value);
            else next.delete(option.value);
            onValueChange(
              options
                .filter((entry) => next.has(entry.value))
                .map((entry) => entry.value),
            );
          }}
        >
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {option.label}
          </span>
          <DropdownMenu.ItemIndicator>
            <Check size={14} aria-hidden="true" />
          </DropdownMenu.ItemIndicator>
        </DropdownMenu.CheckboxItem>
      ))}
    </Menu>
  );
}
