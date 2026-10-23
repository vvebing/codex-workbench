interface Motion {
  from: number;
  to: number;
  velocity: number;
}

const response = 22;
const frameDuration = 1000 / 60;
const motions = new WeakMap<Animation, Motion>();

function sample(motion: Motion, seconds: number) {
  const distance = motion.from - motion.to;
  const momentum = motion.velocity + response * distance;
  const decay = Math.exp(-response * seconds);
  return {
    height: motion.to + (distance + momentum * seconds) * decay,
    velocity: (motion.velocity - response * momentum * seconds) * decay,
  };
}

/** A damped spring starts gently and carries its velocity through streaming updates. */
export function animateHeight(
  element: HTMLElement,
  from: number,
  to: number,
  previous: Animation | null,
): Animation {
  const prior = previous && motions.get(previous);
  const velocity =
    prior &&
    previous.playState !== "finished" &&
    typeof previous.currentTime === "number"
      ? sample(prior, previous.currentTime / 1000).velocity
      : 0;
  previous?.cancel();
  const motion: Motion = { from, to, velocity };
  const heights = [from];
  for (let frame = 1; frame <= 48; frame++) {
    const current = sample(motion, (frame * frameDuration) / 1000);
    heights.push(Math.max(0, current.height));
    if (Math.abs(current.height - to) < 0.2 && Math.abs(current.velocity) < 3)
      break;
  }
  heights[heights.length - 1] = to;
  const animation = element.animate(
    heights.map((height, index) => ({
      height: `${height}px`,
      offset: index / (heights.length - 1),
    })),
    {
      duration: (heights.length - 1) * frameDuration,
      easing: "linear",
      fill: "both",
    },
  );
  motions.set(animation, motion);
  return animation;
}
