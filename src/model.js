export const fontOptions = ["Bangers", "Boogaloo", "Bebas Neue"];
export const storageKey = "gridroom-v1";
export const publishers = {
  none: { color: "transparent", caption: "#202325", text: "#d8f36a" },
  dc: { color: "#0085c7", caption: "#123c55", text: "#ffffff" },
  marvel: { color: "#ed1d24", caption: "#4b1a20", text: "#ffffff" },
};
const sources = [
  ["DC", "Color Kid"],
  ["DC", "Condiment King"],
  ["DC", "Friendly Fire"],
  ["DC", "Kite Man"],
  ["Marvel", "Eye-Boy"],
  ["Marvel", "Hindsight"],
  ["Marvel", "Paste-Pot Pete"],
  ["Marvel", "Soft Serve"],
];
export const initialAssets = sources.map(([category, title], index) => ({
  id: `asset-${index}`,
  category,
  title,
  src: `assets/${category} - ${title}.jpg`,
}));
export const makeCell = (asset = null) => ({
  assetId: asset?.id ?? null,
  title: asset?.title ?? "",
  fit: "contain",
});
const defaultHeading = (name) =>
  ({ "DC Characters": "Team DC", "Marvel Characters": "Team Marvel" })[name] ||
  "";
const defaultPublisher = (name, assets = []) =>
  ({ "DC Characters": "dc", "Marvel Characters": "marvel" })[name] ||
  (assets.length &&
  assets.every((asset) => asset?.category === assets[0]?.category) &&
  ["DC", "Marvel"].includes(assets[0]?.category)
    ? assets[0].category.toLowerCase()
    : "none");
export const makeBoard = (name, assets = []) => ({
  id: crypto.randomUUID(),
  name,
  publisher: defaultPublisher(name, assets),
  heading: defaultHeading(name),
  headingVisible: true,
  headingFont: "Bangers",
  cellFont: "Boogaloo",
  rows: 2,
  columns: 2,
  gap: 12,
  background: "#17191b",
  cells: Array.from({ length: 4 }, (_, index) => makeCell(assets[index])),
});
export function removeBoard(workspace, boardId) {
  const position = workspace.boards.findIndex((board) => board.id === boardId);
  if (position < 0) return workspace;
  const activeId = workspace.boards[workspace.active]?.id;
  const boards = workspace.boards.filter((board) => board.id !== boardId);
  const survivingActive = boards.findIndex((board) => board.id === activeId);
  return {
    ...workspace,
    boards,
    active:
      survivingActive >= 0
        ? survivingActive
        : Math.max(0, Math.min(position, boards.length - 1)),
  };
}
export function restoreBoard(workspace, board, position) {
  if (workspace.boards.some((item) => item.id === board.id)) return workspace;
  const insertion = Math.max(0, Math.min(position, workspace.boards.length));
  const boards = [...workspace.boards];
  boards.splice(insertion, 0, board);
  return { ...workspace, boards, active: insertion };
}
export function loadWorkspace() {
  const fallback = {
    assets: initialAssets,
    boards: [
      makeBoard("DC Characters", initialAssets.slice(0, 4)),
      makeBoard("Marvel Characters", initialAssets.slice(4)),
    ],
    active: 0,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (
      !Array.isArray(saved?.boards) ||
      !Array.isArray(saved.assets) ||
      !saved.boards.every(
        (board) =>
          Number.isInteger(board.rows) &&
          board.rows >= 1 &&
          board.rows <= 6 &&
          Number.isInteger(board.columns) &&
          board.columns >= 1 &&
          board.columns <= 6 &&
          Array.isArray(board.cells) &&
          board.cells.length >= board.rows * board.columns,
      )
    )
      return fallback;
    saved.active = Math.max(
      0,
      Math.min(saved.active || 0, saved.boards.length - 1),
    );
    saved.boards.forEach((item) => {
      if (!Object.hasOwn(publishers, item.publisher))
        item.publisher = defaultPublisher(
          item.name,
          item.cells
            .filter((entry) => entry.assetId)
            .map((entry) =>
              saved.assets.find((asset) => asset.id === entry.assetId),
            ),
        );
      if (typeof item.heading !== "string")
        item.heading = defaultHeading(item.name);
      if (typeof item.headingVisible !== "boolean") item.headingVisible = true;
      if (!fontOptions.includes(item.headingFont)) item.headingFont = "Bangers";
      if (!fontOptions.includes(item.cellFont)) item.cellFont = "Boogaloo";
    });
    return saved;
  } catch {
    return fallback;
  }
}
