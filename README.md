# Grids

A browser-only image-board editor built with React 19 and Vite. Fresh workspaces start with one empty, neutral 3x3 board and an empty image library. No backend is required.

## Run

Requires Node.js 22.12 or newer. Node.js 22 is used for deployment.

```sh
npm ci
npm run dev
```

Open the localhost URL printed in the terminal, normally http://localhost:5837. If that port is occupied, Vite automatically tries the next available port. `npm start` also starts the development server. Use Vite rather than opening the HTML directly so modules, fonts, and canvas exports load consistently.

## Build And Preview

```sh
npm run build
npm run preview
```

The production site is generated in `dist/`. Preview normally runs at http://localhost:5838 and also falls back to another port when occupied. Relative build paths support both a GitHub Pages repository URL and a custom domain.

## Frontend Foundation

Controls use Headless UI for accessible interactions, Motion for animation, and Tailwind CSS v4 for styling. Tailwind uses the `tw:` prefix without Preflight while existing canvas styles are migrated incrementally. All application modules use TypeScript/TSX and are strictly checked during every production build; run `npm run typecheck` separately when needed. Directly executed Node configs and browser-test scripts use `.mjs`. Do not add authored `.js` or `.jsx` files; Vite's generated JavaScript bundles are build output, not application source.

The board-action menu offers Rename board and Download image. Board settings expand/collapse, and the Show heading switch hides the exported heading without erasing its text or styling. The rename dialog scrolls at the viewport edge and keeps the background locked through its exit animation. Touch devices focus a non-input control rather than opening the keyboard automatically.

The modal structure and scrollbar-compensation pattern were adapted from the user's Chatter frontend (`apps/web/src/components/Modal.tsx`, `apps/web/src/scrollbarWidth.ts`, and the portal-dialog rules in `apps/web/src/index.css`). Grids uses Motion instead of Chatter's CSS/Web Animations transitions, adds listener/probe cleanup and post-dialog measurements, and keeps its own editor styling and deployment. No Chatter backend code is included.

Completed work and the ordered development backlog are in [docs/roadmap.md](docs/roadmap.md). General undo/redo, IndexedDB migration, image ratios, and reviewed/licensed example content remain pending. The legacy `gridroom-v1` browser-storage key is retained so the rename does not reset saved boards.

The image-library Load example icon explicitly appends two legacy 2x2 comic boards without replacing existing boards or uploads. Repeat loads reuse the same library images and create new boards. Neither the example module nor its images are requested by a fresh workspace until selected. Existing saved boards retain their image paths, captions, dimensions, fonts, and palettes. New boards use Manrope and do not infer comic branding from their name or uploaded images.

## Deploy To GitHub Pages

1. Push the project to the GitHub repository's `main` branch. The repository is already initialized with an `origin` remote.
2. In the GitHub repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** manually from the **Actions** tab.

The workflow installs locked dependencies, builds the site, runs the browser tests, and deploys `dist/` only after those checks pass. Pull requests run the same checks without deploying. The published URL is shown in the deployment environment, normally `https://<username>.github.io/<repository>/`.

No API keys or application secrets are needed. Saved boards belong to each browser origin: localhost boards will not automatically appear on the published site. GitHub Pages does not sync boards between devices. Review the rights to supplied images before publishing them in a public repository.

## Project Structure

- [src/App.tsx](src/App.tsx): typed React editor UI, controls, and import/download interactions.
- [src/model.ts](src/model.ts): document types, workspace defaults, and saved-board migration.
- [src/demo/comics.ts](src/demo/comics.ts): lazily loaded legacy example manifest and append-only importer, including the unresolved source/rights record.
- [src/export.ts](src/export.ts): typed canvas sizing, image rendering, and export generation.
- `src/components/ui/`: typed Headless UI/Motion buttons, switches, accordion, action menu, and modal.
- `src/browser/scrollbar.ts`: scrollbar measurement and dialog lifecycle compensation support.
- `styles.css`: existing responsive canvas/editor styling and incremental Tailwind utilities.
- `public/assets/`: local fonts, images, and redistribution notices.
- [tests/editor.spec.mjs](tests/editor.spec.mjs): Node-side production-build browser regression checks.
- [vite.config.mjs](vite.config.mjs) and [playwright.config.mjs](playwright.config.mjs): directly executed ESM tooling configuration.
- `.github/workflows/deploy.yml`: test and GitHub Pages deployment workflow.

## Editing And Export

- Add/remove columns with right-edge plus/minus buttons and rows with bottom-edge buttons, from 1 to 12 in each direction. Existing cells stay at their coordinates, and removed cells are saved across reloads. Expanding restores them; the removed-cell tray can swap content with the selected cell. Undo grid resize restores prior dimensions during the current session without overwriting newer edits.
- Delete the active board with the trash button beside board navigation. Undo restores deleted boards during the current session without overwriting changes to surviving boards. Deleting the last board leaves an empty workspace that survives reload; the image library and uploads remain available, and Add Board resumes editing. Reload clears session Undo history, not the saved workspace.
- Drag a library image or an image file into a cell. Clicking a library image places it in the selected cell, including on touch devices.
- Drag filled cells to swap them. Edit headings on the board or in the selected-cell panel.
- Set an optional Image heading above the grid, such as Team DC or Team Marvel. Turn off Show heading to export without a banner while retaining the text; an empty heading also omits the banner.
- Choose DC, Marvel, or None under Publisher. DC uses a blue palette; Marvel uses a red palette. Colors are included in all exports and saved per board. Headers keep the team name centered without logos.
- Choose Manrope, Bangers, Boogaloo, or Bebas Neue separately for the banner and cell headings.
- Upload additional images, choose Fit or Fill, and adjust spacing and background.
- Export the active board or all boards as PNG, JPEG, or WebP. Allow multiple downloads when exporting all boards.
- Exports include the optional image heading, images, and character headings, not editor controls or the board's workspace name.

The optional legacy comic pairing is Bangers for the image heading and Boogaloo for cell headings, with 0.5px letter spacing. New boards use Manrope. All fonts are bundled locally. Fonts, icons, and original images stay local; no third-party service receives uploads. Boards are saved in this browser's local storage. Large imported images may exceed the browser storage limit; the app will report this and exports remain available for that session. Canvas exports are capped at 16 MP on narrow/touch layouts and 32 MP otherwise; choose 150/300 px per image for larger grids. These are initial allocation safeguards, not a guarantee against every device's memory limits.

## Check

```sh
npm run check
```

The browser tests run against the production build under `/tier-list/` to verify repository-subpath hosting. They check neutral first launch without demo requests, append-only example loading, real drag-and-drop, uploads, grid resizing, local persistence and legacy migration, the mobile layout, and downloaded PNG/JPEG/WebP image pixels. Comic-based checks explicitly load the legacy example; its image-rights review and replacement with owned/licensed fixtures remain pending. Foundation checks cover heading visibility/export parity, animated controls, rename persistence/cancel, modal scroll/focus lifecycle, and touch-device no-autofocus. The multi-download export check has a larger timeout for image decoding and full-resolution output. Tests also write the two example full-resolution PNGs to `exports/`, which is ignored by Git.

```sh
npx playwright install chromium
npm test
```

`npm test` builds the app automatically and starts a dedicated preview server on localhost port 5840. That test port must be free; tests never reuse an unrelated project's server.

## Asset Notices

Font redistribution licenses are bundled alongside the font files. Icons are provided by `lucide-react`. Publisher colors do not include logos in the editor or exports. Supplied character artwork and unused publisher logo files remain subject to their owners' rights; this project does not grant a license to that artwork.
