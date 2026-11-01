import {
  cellGeometry,
  captionPadding,
  sourceRectangle,
  publishers,
  type Asset,
  type Board,
  type ImageFormat,
} from "./model";

export function dimensions(item: Board, size: number) {
  const gap = Math.round((item.gap * size) / 600);
  const geometry = cellGeometry(item, size);
  const titleHeight = geometry.captionHeight;
  const headingHeight =
    item.headingVisible !== false && item.heading?.trim()
      ? Math.round(size * 0.28) + gap
      : 0;
  return {
    gap,
    titleHeight,
    cellHeight: geometry.height,
    headingHeight,
    width: item.columns * size + (item.columns + 1) * gap,
    height: headingHeight + item.rows * geometry.height + (item.rows + 1) * gap,
  };
}
export async function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}
function wrapTitle(
  context: CanvasRenderingContext2D,
  title: string,
  maxWidth: number,
) {
  const lines = [];
  for (const paragraph of title.split("\n")) {
    let line = "";
    for (const word of paragraph.match(/\s*\S+|\s+$/g) ?? []) {
      const candidate = line + word;
      if (line && context.measureText(candidate.trimEnd()).width > maxWidth) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = candidate;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export function fitTitle(
  context: CanvasRenderingContext2D,
  title: string,
  font: string,
  maximumSize: number,
  width: number,
  height: number,
) {
  let fontSize = Math.max(1, Math.round(maximumSize));
  let lines;
  do {
    context.font = `${fontSize}px "${font}"`;
    lines = wrapTitle(context, title, width);
    if (
      lines.length * fontSize * 1.05 <= height &&
      lines.every((line) => context.measureText(line).width <= width)
    )
      break;
    fontSize--;
  } while (fontSize > 1);
  return { fontSize, lines };
}
function drawTitle(
  context: CanvasRenderingContext2D,
  title: string,
  font: string,
  maximumSize: number,
  left: number,
  top: number,
  width: number,
  height: number,
  color: string,
  padding = { horizontal: width * 0.04, vertical: height * 0.09 },
) {
  context.letterSpacing = "0.5px";
  const { fontSize, lines } = fitTitle(
    context,
    title,
    font,
    maximumSize,
    width - padding.horizontal * 2,
    height - padding.vertical * 2,
  );
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lineHeight = fontSize * 1.05;
  lines.forEach((line, lineIndex) =>
    context.fillText(
      line,
      left + width / 2,
      top + height / 2 + (lineIndex - (lines.length - 1) / 2) * lineHeight,
    ),
  );
}
export async function createExport(
  item: Board,
  assets: Asset[],
  size: number,
  mime: ImageFormat,
  quality = 0.95,
  maximumPixels = 32_000_000,
): Promise<Blob> {
  for (const font of new Set([item.headingFont, item.cellFont])) {
    await document.fonts.load(`48px "${font}"`);
    if (!document.fonts.check(`48px "${font}"`))
      throw new Error(`${font} could not load. Please reload and try again.`);
  }
  const { gap, titleHeight, headingHeight, width, height } = dimensions(
    item,
    size,
  );
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("Invalid export dimensions.");
  if (width * height > maximumPixels)
    throw new Error(
      `Export exceeds the ${maximumPixels / 1_000_000} MP limit. Choose a smaller resolution.`,
    );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not create an image.");
  context.fillStyle = item.background;
  context.fillRect(0, 0, width, height);
  const publisher = publishers[item.publisher];
  if (headingHeight) {
    const bandHeight = headingHeight - gap;
    if (publisher.color !== "transparent") {
      context.fillStyle = publisher.color;
      context.fillRect(gap, gap, width - gap * 2, bandHeight);
    }
    drawTitle(
      context,
      item.heading.toUpperCase(),
      item.headingFont,
      size * 0.18,
      gap,
      gap,
      width - gap * 2,
      bandHeight,
      publisher.text,
    );
  }
  const cells = item.cells.slice(0, item.rows * item.columns);
  const geometry = cellGeometry(item, size);
  const images = await Promise.all(
    cells.map(async (entry) => {
      const asset = assets.find((asset) => asset.id === entry.assetId);
      return asset ? loadImage(asset.src) : null;
    }),
  );
  cells.forEach((entry, index) => {
    const left = gap + (index % item.columns) * (size + gap);
    const top =
      gap +
      headingHeight +
      Math.floor(index / item.columns) * (geometry.height + gap);
    const imageTop = top + geometry.imageTop;
    context.fillStyle = "#111315";
    context.fillRect(left, imageTop, size, geometry.imageHeight);
    const image = images[index];
    if (image) {
      const source = sourceRectangle(
        entry.crop,
        image.width,
        image.height,
        geometry.aspectRatio,
      );
      context.save();
      context.beginPath();
      context.rect(left, imageTop, size, geometry.imageHeight);
      context.clip();
      context.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        left,
        imageTop,
        size,
        geometry.imageHeight,
      );
      context.restore();
    }
    const captionTop = top + geometry.captionTop;
    context.save();
    context.fillStyle =
      item.captionPlacement === "overlay"
        ? (item.captionOverlayColor ?? "#000000")
        : publisher.caption;
    if (item.captionPlacement === "overlay")
      context.globalAlpha = (item.captionOverlayOpacity ?? 60) / 100;
    context.fillRect(left, captionTop, size, titleHeight);
    context.restore();
    drawTitle(
      context,
      entry.title,
      item.cellFont,
      size * 0.11,
      left,
      captionTop,
      size,
      titleHeight,
      "#f4f4ef",
      captionPadding(size),
    );
  });
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, quality),
  );
  if (!blob) throw new Error("Export failed. Try a smaller resolution.");
  if (blob.type !== mime)
    throw new Error(
      "This browser does not support that format. Try PNG or JPEG.",
    );
  return blob;
}
