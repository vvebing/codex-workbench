import { Component, createRef, type ReactNode } from "react";
import { animateHeight } from "./height-motion";

export const BEFORE_EXECUTION_LAYOUT = "conversation-before-execution-layout";

export interface ExecutionMotionItem {
  id: string;
  instant: boolean;
  state: readonly unknown[];
}

interface Props {
  children: ReactNode;
  motionItems: readonly ExecutionMotionItem[];
  running: boolean;
  /** A manual filter change also animates layout after execution has ended. */
  transitionKey?: boolean;
  enter?: boolean;
  className?: string;
  contentClassName?: string;
  "data-slot"?: string;
}

interface LayoutSnapshot {
  height: number;
  changed: ExecutionMotionItem[];
}

/** Own structural/output growth only; disclosures own their open/close transition. */
export class AnimatedExecution extends Component<Props> {
  private viewport = createRef<HTMLDivElement>();
  private content = createRef<HTMLDivElement>();
  private animation: Animation | null = null;
  private fade: Animation | null = null;
  private targetHeight: number | null = null;
  private observer: ResizeObserver | null = null;
  private resizeFrame = 0;

  componentDidMount() {
    if (
      this.props.enter &&
      this.props.running &&
      this.props.motionItems.some((item) => !item.instant)
    ) {
      this.animateHeight(0);
      // With the entering content still at zero height, capture the reader's
      // position before the first animation frame changes the layout.
      this.viewport.current?.dispatchEvent(
        new Event(BEFORE_EXECUTION_LAYOUT, { bubbles: true }),
      );
    }
  }

  getSnapshotBeforeUpdate(previous: Readonly<Props>): LayoutSnapshot | null {
    const previousItems = new Map(
      previous.motionItems.map((item) => [item.id, item]),
    );
    const changed = this.props.motionItems.filter((item) => {
      const before = previousItems.get(item.id);
      previousItems.delete(item.id);
      return (
        !before ||
        before.instant !== item.instant ||
        before.state.length !== item.state.length ||
        item.state.some((value, index) => value !== before.state[index])
      );
    });
    changed.push(...previousItems.values());
    // A re-render with identical content must not capture an old scroll anchor
    // while the reader is deliberately jumping to another turn.
    if (!changed.length || !this.viewport.current) return null;
    this.viewport.current?.dispatchEvent(
      new Event(BEFORE_EXECUTION_LAYOUT, { bubbles: true }),
    );
    return {
      height: this.viewport.current.getBoundingClientRect().height,
      changed,
    };
  }

  componentDidUpdate(
    previous: Readonly<Props>,
    _state: unknown,
    snapshot: LayoutSnapshot | null,
  ) {
    const manualTransition =
      previous.transitionKey !== this.props.transitionKey;
    // Live updates and explicit manual filtering can change layout. Initial
    // history stays static; newly arriving groups explicitly opt into entrance.
    if (
      snapshot === null ||
      (!manualTransition && !previous.running && !this.props.running)
    )
      return;
    const { height, changed } = snapshot;
    // Empty terminal thinking leaves neither an animated gap nor residual fade.
    if (!this.props.motionItems.length) {
      this.cancelMotion();
      return;
    }
    // Do not let a list animation reintroduce motion for an instant task,
    // including a delayed merge of several instant commands into a summary.
    if (!manualTransition && changed.every((item) => item.instant)) {
      this.cancelMotion();
      return;
    }
    const nestedAnimation = Array.from(
      this.content.current?.querySelectorAll(
        '[data-slot="disclosure-content"]',
      ) ?? [],
    ).some((element) => element.getAnimations().length > 0);
    // A nested fold owns its height unless manual filtering also adds/removes
    // sibling rows. That structural transition must preserve the group's height.
    if (nestedAnimation && !manualTransition) {
      // Let the nested disclosure own new motion. An existing entrance must
      // reach the changing content height before it can release its height.
      if (this.animation) this.animateHeight(height);
      return;
    }
    this.animateHeight(height);
  }

  componentWillUnmount() {
    this.viewport.current?.dispatchEvent(
      new Event(BEFORE_EXECUTION_LAYOUT, { bubbles: true }),
    );
    this.cancelMotion();
  }

  private stopObserving() {
    this.observer?.disconnect();
    this.observer = null;
    cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = 0;
  }

  private cancelMotion() {
    this.stopObserving();
    this.animation?.cancel();
    this.animation = null;
    this.fade?.cancel();
    this.fade = null;
    this.targetHeight = null;
    if (this.viewport.current) this.viewport.current.style.overflow = "";
  }

  private animateHeight(from: number) {
    const element = this.viewport.current;
    const content = this.content.current;
    if (!element || !content) return;
    const to = content.getBoundingClientRect().height;
    // New tokens often keep the same height; let the current animation finish.
    if (
      this.animation &&
      this.targetHeight !== null &&
      Math.abs(to - this.targetHeight) < 1
    )
      return;
    if (
      Math.abs(to - from) < 1 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      this.cancelMotion();
      return;
    }
    if (from < 1 && to > 1 && !this.fade) {
      const fade = content.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 180,
        easing: "ease-out",
        fill: "both",
      });
      this.fade = fade;
      fade.onfinish = () => {
        if (this.fade === fade) this.fade = null;
        fade.cancel();
      };
    }
    element.style.overflow = "hidden";
    const animation = animateHeight(element, from, to, this.animation);
    this.animation = animation;
    this.targetHeight = to;
    if (!this.observer) {
      this.observer = new ResizeObserver(() => {
        // Defer ancestor layout writes until ResizeObserver delivery is over.
        if (!this.resizeFrame)
          this.resizeFrame = requestAnimationFrame(() => {
            this.resizeFrame = 0;
            if (this.animation)
              this.animateHeight(element.getBoundingClientRect().height);
          });
      });
      this.observer.observe(content);
    }
    animation.onfinish = () => {
      // Streaming output or a nested disclosure can change size during this animation.
      // Reach its latest natural height before releasing the explicit height.
      const latest = content.getBoundingClientRect().height;
      if (Math.abs(latest - to) >= 1) {
        this.animateHeight(to);
        return;
      }
      this.animation = null;
      this.targetHeight = null;
      this.stopObserving();
      animation.cancel();
      element.style.overflow = "";
    };
  }

  render() {
    const {
      children,
      className,
      contentClassName,
      "data-slot": slot,
    } = this.props;
    return (
      <div data-slot={slot} className={className} ref={this.viewport}>
        {/* Keep spacing inside the measured height; outer margins can collapse
            differently when the surrounding process container changes. */}
        <div
          ref={this.content}
          className={contentClassName ?? "flow-root min-w-0 py-1"}
        >
          {children}
        </div>
      </div>
    );
  }
}
