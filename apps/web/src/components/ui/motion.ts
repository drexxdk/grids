import {
  useReducedMotion,
  type HTMLMotionProps,
  type Transition,
} from "motion/react";

export const motionDuration = { popup: 0.14, control: 0.16, layout: 0.18 };

export const motionPresets = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  collapse: {
    initial: { height: 0, opacity: 0 },
    animate: { height: "auto", opacity: 1 },
    exit: { height: 0, opacity: 0 },
  },
} satisfies Record<
  string,
  Pick<HTMLMotionProps<"div">, "initial" | "animate" | "exit">
>;

export function useUiTransition(kind: keyof typeof motionDuration): Transition {
  const reduced = useReducedMotion();
  return { duration: reduced ? 0 : motionDuration[kind] };
}
