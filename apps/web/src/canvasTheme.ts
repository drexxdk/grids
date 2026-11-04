export function isLightCanvasColor(background: string): boolean {
  const luminance = [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const channel = parseInt(background.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return sum + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  }, 0);
  return luminance > 0.18;
}
