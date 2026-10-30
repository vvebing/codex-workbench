---
name: Codex Workbench
description: A focused workspace for sessions, files, approvals, and development environments.
colors:
  background: "#ffffff"
  surface: "#f6f6f5"
  elevated: "#ffffff"
  hover: "#eeeeec"
  selected: "#e6e9e6"
  foreground: "#252728"
  muted: "#626667"
  subtle: "#65696a"
  border: "#dedfdd"
  accent: "#296346"
  action: "#296346"
  on-action: "#ffffff"
  danger: "#a83f32"
  danger-soft: "#fbece9"
  warning: "#916419"
  warning-soft: "#f5f1e6"
  success: "#328050"
  success-soft: "#eaf3e9"
  dark-background: "#1b1d1e"
  dark-surface: "#222425"
  dark-elevated: "#292c2d"
  dark-hover: "#333637"
  dark-selected: "#383e3a"
  dark-foreground: "#e8e9e7"
  dark-muted: "#b1b5b4"
  dark-subtle: "#a5aaa8"
  dark-border: "#3c4040"
  dark-accent: "#97c8a9"
  dark-action: "#97c8a9"
  dark-on-action: "#17291f"
  dark-danger: "#f59f91"
  dark-danger-soft: "#432b28"
  dark-warning: "#dfbb76"
  dark-warning-soft: "#3a3324"
  dark-success: "#91cba0"
  dark-success-soft: "#263b2b"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "calc(14px * var(--font-scale))"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "calc(13px * var(--font-scale))"
    fontWeight: 500
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "calc(12px * var(--font-scale))"
    fontWeight: 400
  meta:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "calc(11px * var(--font-scale))"
    fontWeight: 400
  title-sm:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "calc(18px * var(--font-scale))"
    fontWeight: 600
  prose:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "calc(15px * var(--font-scale))"
    fontWeight: 400
    lineHeight: 1.8
  markdown-heading:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "calc(25px * var(--font-scale))"
    fontWeight: 600
    lineHeight: 1.4
  code:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
    fontSize: "var(--code-font-size)"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  2xl: "12px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    padding: "8px 13px"
  button-secondary:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    padding: "8px 13px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    padding: "8px 13px"
  button-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.lg}"
    typography: "{typography.control}"
    padding: "8px 13px"
  settings-input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  navigation-environment:
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    padding: "4px 9px"
---

# Design System: Codex Workbench

## Overview

**Creative North Star: "Focused workbench"**

Codex Workbench uses a neutral graphite and white interface with forest green for actions and meaningful states. Content, lists, and dividers establish hierarchy across sessions, settings, files, and conversation tools.

The design system supports configurable typography, light and dark themes, and responsive working layouts.

**Key Characteristics:**

- Compact controls with clear text hierarchy.
- Flat working surfaces, divided lists, and restrained overlays.
- Semantic colors paired with readable labels and interaction states.

Source of truth: `src/theme.css`, `src/styles.css`, `src/components/ui.tsx`, `src/components/menu.css`, navigation styles, conversation Markdown styles, and settings components/preferences. `PRODUCT.md` supplies product constraints; implementation supplies the values below.

## Colors

### Primary

Forest green (`accent`) identifies links, caret, focus, and selected control details. `action` supplies primary button and checked-control fills; `on-action` supplies their text. The two green roles currently share a value but have different jobs. Light values are the unprefixed frontmatter entries; `dark-` entries are the corresponding dark-mode values, applied by `data-theme="dark"`. The system preference resolves to one of these themes.

### Neutral

`background` is the main canvas, `surface` groups navigation and secondary areas, and `elevated` supports controls and overlays. `hover` and `selected` distinguish pointer and persistent selection states. `foreground`, `muted`, and `subtle` form the text hierarchy; `border` separates areas without framing every item as a card.

Danger, warning, and success each have a text/icon color and a soft fill. Preserve these semantic exceptions to the single action accent. File modification and diff colors remain specialized editor indicators rather than general UI accents.

**The Action Pair Rule.** Always pair action fills with on-action text; dark mode uses dark text on the lighter green fill.

## Typography

The default interface uses the platform sans stack with Chinese fallbacks; code uses the platform monospace stack. The frontmatter records reused roles, not a marketing display scale. Settings allow default, system, or serif interface fonts and default, Menlo, or Courier code fonts.

Interface size defaults to (14px), code to (13px). Interface roles multiply their base size by `--font-scale`, calculated as the chosen interface size divided by 14. Code size is independent. The root size stays (14px) so rem-based geometry does not grow with text preferences. Saved sizes are validated between (8px) and (40px), including fractional values.

Body copy uses the body role; buttons and labels use control; supporting information uses caption and meta. Settings section headings use body size with semibold weight. Dialog titles use title-sm, with settings titles at base size (16px before scaling). Markdown prose uses its own larger, more open role, with heading sizes of (25px), (21px), and (18px), semibold and line-height (1.4). Code line-height is (1.65), help (1.6), and settings descriptions (1.7).

**The Preference Rule.** New interface text follows scalable roles, and code follows the independent code preference. Mobile editable controls use at least (16px) to avoid focus zoom.

## Layout

The working shell separates navigation, conversation, and supporting panels. The shared spacing unit is (4px); half steps and local optical adjustments also exist. Common control gaps are (8px), field/list padding (12px), and section gaps (24px). Settings use divided sections and aligned label/control rows rather than nested decorative panels.

Conversation width is configurable: reading (928px), wide (1128px), or fluid (100%). Content is centered with (24px) side padding, reduced to (12px) when the conversation container is narrower than (550px). The start surface is capped at (600px); its content stacks at that same container threshold.

The main mobile boundary is viewport width (900px). Controls grow to touch-friendly sizes, settings navigation becomes a two-column grid above its content, row actions stay visible, and the shell respects safe areas and the visible keyboard viewport. Standard buttons and navigation controls have a (44px) minimum height there; compact icon buttons can be (40px). Menus apply their touch minimum below (900px).

Settings fields become two columns at container width (560px), with a control column of (180px–240px). Below viewport width (550px), settings padding reduces and wrapping increases. Below (450px), search timestamps are hidden and search margins reduce. These are local component breakpoints, not interchangeable global screen tiers.

## Elevation & Depth

Working content is flat and uses neutral fills, borders, and whitespace. Dialogs use `--shadow-dialog` and a border ring; menus and transient notices use the existing Tailwind large shadow. The dialog shadow is (0 18px 64px var(--shadow-color)), with shadow color (#00000033). Navigation sticky headings use a border shadow and a subtle background-colored fade to preserve the list's edge while scrolling.

**The Overlay Rule.** Reserve pronounced shadow for floating controls, dialogs, and transient notices. Use divisions and tonal surfaces for routine content.

## Shapes

The radius scale is in frontmatter: small inline code and keycaps, medium menu items/environment controls, large buttons and fields, and extra-large dialogs/menus. Icon buttons use a local radius (7px). Settings locally override extra-large radii to (12px), while most dialogs use the shared extra-large token (10px). Status dots, switches, and scroll thumbs retain circular or pill forms. Ordinary dividers and field borders are (1px).

## Components

### Buttons

Primary, secondary, quiet, and danger variants share medium weight, the large radius, and (8px 13px) padding. Standard minimum height is (36px); small uses (32px), caption text, and (6px 8px) padding. Secondary uses an elevated fill and border; quiet is transparent with muted text; danger uses the soft danger fill. Hover uses a semantic hover fill, except primary lowers its fill opacity to (90%) and danger uses a (20%) danger mix. Disabled buttons use reduced opacity (0.45) and block pointer interaction.

Button color transitions last (140ms). Shared keyboard focus uses a (2px) accent outline offset (3px). Checkbox focus uses a (2px) ring and (2px) offset. Reduced-motion preference removes animations and transitions globally.

### Inputs / Fields

Settings fields use the background canvas, border, large radius, and (8px 12px) padding, with minimum height (40px). Hover strengthens the border; focus uses accent. Select triggers use elevated backgrounds and the same control geometry. Invalid states and error notices use danger roles; labels, help text, and errors retain explicit semantic associations in the components.

### Navigation

Environment choices use compact rounded controls; active choices use elevated fill and medium foreground text. View tabs use an underline and semibold text rather than a decorative badge. Session rows use selected fill for selection and hover fill for pointer feedback. Row menus appear on hover, keyboard focus, open state, and touch. Search results share this selected-fill pattern and compact metadata.

### Containers / Dialogs

Settings sections separate with a top divider and (24px) top padding; lists use horizontal dividers. Status and error containers may use semantic soft fills. Dialogs supply titled, focus-managed overlays; default and search maximum widths are (520px) and (660px). Settings use a maximum (960px) width and (720px) height bounded by the viewport; drawer and detail variants attach to the screen edge.

## Do's and Don'ts

### Do:

- **Do** use semantic color variables so light and dark modes stay aligned.
- **Do** preserve font scaling, independent code sizing, and mobile input sizing.
- **Do** use dividers and spacing to group settings and working lists.
- **Do** keep keyboard focus visible and respect reduced motion.

### Don't:

- **Don't** hardcode white text on primary actions; use the on-action token.
- **Don't** add decorative heroes, gradients, or repeated cards to working screens.
- **Don't** hide row actions from keyboard focus or touch users.
- **Don't** use page-specific text sizes in place of shared typography roles.

## Implementation reference

Use `src/theme.css` for shared tokens, `src/components/ui.tsx` for common controls, and feature styles for local layout rules. Validate changes with both themes, font preferences, keyboard navigation, and narrow viewports. See [development](docs/development.md) for checks and [product scope](PRODUCT.md) for workflows.
