import {
  makeBoard,
  makeCell,
  type Asset,
  type Workspace,
  type Publisher,
} from "../../src/model";

const images = [
  ["DC", "Color Kid"],
  ["DC", "Condiment King"],
  ["DC", "Friendly Fire"],
  ["DC", "Kite Man"],
  ["Marvel", "Eye-Boy"],
  ["Marvel", "Hindsight"],
  ["Marvel", "Paste-Pot Pete"],
  ["Marvel", "Soft Serve"],
];

export function makeComicFixture(
  workspace: Workspace,
  publisher: Publisher = "dc",
): Workspace {
  const assets = [...workspace.assets];
  const fixtureAssets = images.map(([category, title]) => {
    const source = `${category} - ${title}.jpg`;
    const existing = assets.find((asset) => asset.source === source);
    if (existing) return existing;
    const asset: Asset = {
      category,
      title,
      source,
      src: source,
      id: crypto.randomUUID(),
    };
    assets.push(asset);
    return asset;
  });
  const marvel = publisher === "marvel";
  const grid = {
    ...makeBoard(marvel ? "Marvel Characters" : "DC Characters"),
    imageAspect: "portrait" as const,
    captionPlacement: "overlay" as const,
    captionOverlayOpacity: 60,
    captionOverlayColor: undefined,
    cornerRadius: 12.5,
    gap: 60,
    canvasPadding: 60,
    headingBackgroundColor: undefined,
    headingTextColor: undefined,
    cellBackgroundColor: undefined,
    cellTextColor: undefined,
    rows: 2,
    columns: 2,
    headingFont: "Bangers",
    cellFont: "Boogaloo",
    publisher,
    heading: marvel ? "Team Marvel" : "Team DC",
    cells: fixtureAssets.slice(marvel ? 4 : 0, marvel ? 8 : 4).map(makeCell),
  };
  return { ...workspace, assets, grid };
}
