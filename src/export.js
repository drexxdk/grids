import { publishers } from "./model";

export function dimensions(item, size) {
  const gap = Math.round((item.gap * size) / 600);
  const titleHeight = Math.round(size * 0.17);
  const headingHeight =
    item.headingVisible !== false && item.heading?.trim()
      ? Math.round(size * 0.28) + gap
      : 0;
  return {
    gap,
    titleHeight,
    headingHeight,
    width: item.columns * size + (item.columns + 1) * gap,
    height:
      headingHeight + item.rows * (size + titleHeight) + (item.rows + 1) * gap,
  };
}
export async function loadImage(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}
function wrapTitle(context, title, maxWidth) {
  const lines = [];
  for (const paragraph of title.toUpperCase().split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}
export function fitTitle(context, title, font, maximumSize, width, height) {
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
  context,
  title,
  font,
  maximumSize,
  left,
  top,
  width,
  height,
  color,
) {
  context.letterSpacing = "0.5px";
  const { fontSize, lines } = fitTitle(
    context,
    title,
    font,
    maximumSize,
    width * 0.92,
    height * 0.82,
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
export async function createExport(item, assets, size, mime, quality = 0.95) {
  for (const font of new Set([item.headingFont, item.cellFont])) {
    await document.fonts.load(`48px "${font}"`);
    if (!document.fonts.check(`48px "${font}"`))
      throw new Error(`${font} could not load. Please reload and try again.`);
  }
  const { gap, titleHeight, headingHeight, width, height } = dimensions(
    item,
    size,
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
      item.heading,
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
      Math.floor(index / item.columns) * (size + titleHeight + gap);
    context.fillStyle = "#111315";
    context.fillRect(left, top, size, size);
    const image = images[index];
    if (image) {
      const scale =
        entry.fit === "cover"
          ? Math.max(size / image.width, size / image.height)
          : Math.min(size / image.width, size / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      context.save();
      context.beginPath();
      context.rect(left, top, size, size);
      context.clip();
      context.drawImage(
        image,
        left + (size - drawWidth) / 2,
        top + (size - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      context.restore();
    }
    context.fillStyle = publisher.caption;
    context.fillRect(left, top + size, size, titleHeight);
    drawTitle(
      context,
      entry.title,
      item.cellFont,
      size * 0.11,
      left,
      top + size,
      size,
      titleHeight,
      "#f4f4ef",
    );
  });
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, mime, quality),
  );
  if (!blob) throw new Error("Export failed. Try a smaller resolution.");
  if (blob.type !== mime)
    throw new Error(
      "This browser does not support that format. Try PNG or JPEG.",
    );
  return blob;
}
