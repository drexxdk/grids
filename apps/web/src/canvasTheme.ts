export function colorLuminance(background: string): number {
  const luminance = [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const channel =
      parseInt(background.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return (
      sum +
      weight *
        (channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4)
    );
  }, 0);
  return luminance;
}

export function colorContrast(foreground: string, background: string): number {
  const foregroundLuminance = colorLuminance(foreground);
  const backgroundLuminance = colorLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

export function contrastingColor(
  background: string,
  preferred: string,
  minimumRatio = 4.5,
): string {
  if (colorContrast(preferred, background) >= minimumRatio) return preferred;
  const target =
    colorContrast("#000000", background) > colorContrast("#ffffff", background)
      ? "#000000"
      : "#ffffff";
  let lower = 0;
  let upper = 1;
  let result = target;
  for (let iteration = 0; iteration < 16; iteration++) {
    const amount = (lower + upper) / 2;
    const mixed = `#${[0, 1, 2]
      .map((index) => {
        const start = parseInt(
          preferred.slice(1 + index * 2, 3 + index * 2),
          16,
        );
        const end = parseInt(target.slice(1 + index * 2, 3 + index * 2), 16);
        return Math.round(start + (end - start) * amount)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")}`;
    if (colorContrast(mixed, background) >= minimumRatio) {
      result = mixed;
      upper = amount;
    } else {
      lower = amount;
    }
  }
  return result;
}

export function isLightCanvasColor(background: string): boolean {
  return colorLuminance(background) > 0.18;
}
