export function CardFrame() {
  return (
    <span
      aria-hidden="true"
      data-cell-image-frame
      className="pointer-events-none absolute inset-(--card-frame-edge) z-50 [--frame-color:var(--card-frame-color)]"
    >
      <svg
        className="absolute inset-0 h-full! w-full! overflow-visible"
        aria-hidden="true"
      >
        <rect
          fill="none"
          stroke="var(--frame-color)"
          strokeWidth="var(--card-frame-stroke)"
          strokeDasharray="var(--card-frame-dash) var(--card-frame-dash-gap)"
          style={{
            x: "calc(var(--card-frame-stroke) / 2)",
            y: "calc(var(--card-frame-stroke) / 2)",
            rx: "max(0px, calc(var(--card-radius) - 1px - var(--card-frame-edge) - var(--card-frame-stroke) / 2))",
            ry: "max(0px, calc(var(--card-radius) - 1px - var(--card-frame-edge) - var(--card-frame-stroke) / 2))",
            width: "calc(100% - var(--card-frame-stroke))",
            height: "calc(100% - var(--card-frame-stroke))",
          }}
        />
      </svg>
    </span>
  );
}
