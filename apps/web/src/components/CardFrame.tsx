import type { GridStyle } from "../model";

export function CardBorder({ style }: { style: GridStyle }) {
  if (!style.cardBorderVisible || (style.cardBorderWidth ?? 0.5) === 0)
    return null;
  return (
    <span
      aria-hidden="true"
      data-card-border
      className="pointer-events-none absolute inset-0 z-45 rounded-[inherit] border-solid"
      style={{
        borderColor: style.cardBorderColor ?? "#eef1f3",
        borderWidth: `${style.cardBorderWidth ?? 0.5}cqw`,
      }}
    />
  );
}

export function CardFrame({ dashed = true }: { dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-cell-image-frame
      className="pointer-events-none absolute inset-(--card-frame-inset) z-50 [--frame-color:var(--card-frame-color)]"
    >
      <svg
        className="absolute inset-0 h-full! w-full! overflow-visible"
        aria-hidden="true"
      >
        <rect
          fill="none"
          stroke="var(--frame-color)"
          strokeOpacity="var(--card-frame-opacity, 1)"
          strokeWidth="var(--card-frame-stroke)"
          strokeDasharray={
            dashed
              ? "var(--card-frame-dash) var(--card-frame-dash-gap)"
              : "none"
          }
          style={{
            x: "calc(var(--card-frame-stroke) / 2)",
            y: "calc(var(--card-frame-stroke) / 2)",
            rx: "calc(var(--card-radius) + var(--card-frame-gap) + var(--card-frame-stroke) / 2)",
            ry: "calc(var(--card-radius) + var(--card-frame-gap) + var(--card-frame-stroke) / 2)",
            width: "calc(100% - var(--card-frame-stroke))",
            height: "calc(100% - var(--card-frame-stroke))",
          }}
        />
      </svg>
    </span>
  );
}
