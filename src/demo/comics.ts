import {
  makeBoard,
  makeCell,
  type Asset,
  type Board,
  type Workspace,
} from "../model";

export const comicExample = {
  id: "legacy-comics",
  name: "Legacy comics",
  source: "Artwork supplied with the original project",
  rights:
    "Redistribution permission has not been verified. Artwork remains subject to its respective rights holders; this project grants no image license.",
  attribution:
    "DC and Marvel character artwork; original artist/source credits are not documented.",
  defaults: {
    rows: 2,
    columns: 2,
    headingFont: "Bangers",
    cellFont: "Boogaloo",
  },
  images: [
    ["DC", "Color Kid"],
    ["DC", "Condiment King"],
    ["DC", "Friendly Fire"],
    ["DC", "Kite Man"],
    ["Marvel", "Eye-Boy"],
    ["Marvel", "Hindsight"],
    ["Marvel", "Paste-Pot Pete"],
    ["Marvel", "Soft Serve"],
  ].map(([category, title]) => ({
    category,
    title,
    src: `assets/${category} - ${title}.jpg`,
  })),
  boards: [
    { name: "DC Characters", publisher: "dc", heading: "Team DC", start: 0 },
    {
      name: "Marvel Characters",
      publisher: "marvel",
      heading: "Team Marvel",
      start: 4,
    },
  ] as const,
};

export function loadComicExample(workspace: Workspace): Workspace {
  const assets = [...workspace.assets];
  const exampleAssets = comicExample.images.map((image) => {
    const existing = assets.find((asset) => asset.src === image.src);
    if (existing) return existing;
    const asset: Asset = { ...image, id: crypto.randomUUID() };
    assets.push(asset);
    return asset;
  });
  const boards: Board[] = comicExample.boards.map((definition) => ({
    ...makeBoard(definition.name),
    ...comicExample.defaults,
    publisher: definition.publisher,
    heading: definition.heading,
    cells: exampleAssets
      .slice(definition.start, definition.start + 4)
      .map(makeCell),
  }));
  return {
    ...workspace,
    assets,
    boards: [...workspace.boards, ...boards],
    active: workspace.boards.length,
  };
}
