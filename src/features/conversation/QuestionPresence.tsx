import { Component, createRef, type ReactNode } from "react";
import { BEFORE_EXECUTION_LAYOUT } from "./AnimatedExecution";

interface Entry {
  id: string;
  content: ReactNode;
  answerFor?: string;
}
interface Props {
  entries: Entry[];
}
interface State {
  entries: (Entry & { exiting: boolean })[];
}

/** Retain outgoing forms just long enough to collapse their complete footprint. */
export class QuestionPresence extends Component<Props, State> {
  state: State = {
    entries: this.props.entries.map((entry) => ({ ...entry, exiting: false })),
  };
  static getDerivedStateFromProps(props: Props, state: State): State {
    const active = new Map(props.entries.map((entry) => [entry.id, entry]));
    return {
      entries: [
        ...state.entries.map((entry) => {
          const current = active.get(entry.id);
          active.delete(entry.id);
          return current
            ? { ...current, exiting: false }
            : { ...entry, exiting: true };
        }),
        ...Array.from(active.values(), (entry) => ({
          ...entry,
          exiting: false,
        })),
      ],
    };
  }
  render() {
    return this.state.entries.map((entry) => (
      <ExitingQuestion
        key={entry.id}
        exiting={entry.exiting}
        answerFor={entry.answerFor}
        onExited={() =>
          this.setState((state) => ({
            entries: state.entries.filter((item) => item.id !== entry.id),
          }))
        }
      >
        {entry.content}
      </ExitingQuestion>
    ));
  }
}

class ExitingQuestion extends Component<{
  exiting: boolean;
  answerFor?: string;
  onExited: () => void;
  children: ReactNode;
}> {
  private element = createRef<HTMLDivElement>();
  private animation?: Animation;
  getSnapshotBeforeUpdate(previous: Readonly<typeof this.props>) {
    return !previous.exiting && this.props.exiting
      ? (this.element.current?.getBoundingClientRect().height ?? null)
      : null;
  }
  componentDidUpdate(
    previous: Readonly<typeof this.props>,
    _state: unknown,
    height: number | null,
  ) {
    const element = this.element.current;
    if (!element) return;
    if (!this.props.exiting) {
      this.animation?.cancel();
      return;
    }
    if (previous.exiting) return;
    element.dispatchEvent(
      new Event(BEFORE_EXECUTION_LAYOUT, { bubbles: true }),
    );
    if (
      element.contains(document.activeElement) ||
      document.activeElement === document.body
    ) {
      const records = document.querySelectorAll<HTMLElement>(
        "[data-question-answer-for]",
      );
      Array.from(records)
        .findLast(
          (record) => record.dataset.questionAnswerFor === this.props.answerFor,
        )
        ?.focus({ preventScroll: true });
    }
    if (
      !height ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      this.props.onExited();
      return;
    }
    this.animation = element.animate(
      [
        { height: `${height}px`, opacity: 1 },
        { height: "0px", opacity: 0 },
      ],
      { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "both" },
    );
    this.animation.onfinish = this.props.onExited;
  }
  componentWillUnmount() {
    this.animation?.cancel();
  }
  render() {
    return (
      <div
        ref={this.element}
        data-slot="question-presence"
        data-exiting={this.props.exiting || undefined}
        inert={this.props.exiting}
        aria-hidden={this.props.exiting || undefined}
        className="flow-root overflow-hidden"
      >
        {this.props.children}
      </div>
    );
  }
}
