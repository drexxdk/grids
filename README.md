# Gridroom

A browser-only image-board editor built with React 19 and Vite. The supplied images are preloaded into two 2x2 boards: DC and Marvel. No backend is required.

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

New controls use Headless UI for accessible interactions, Motion for animation, and Tailwind CSS v4 for styling. Tailwind uses the `tw:` prefix without Preflight while existing canvas styles are migrated incrementally. Typed UI/browser modules are checked during every production build; run `npm run typecheck` separately when needed. Existing JavaScript modules are not yet strictly typechecked.

The board-action menu offers Rename board and Download image. Board settings expand/collapse, and the Show heading switch hides the exported heading without erasing its text or styling. The rename dialog scrolls at the viewport edge and keeps the background locked through its exit animation. Touch devices focus a non-input control rather than opening the keyboard automatically.

The modal structure and scrollbar-compensation pattern were adapted from the user's Chatter frontend (`apps/web/src/components/Modal.tsx`, `apps/web/src/scrollbarWidth.ts`, and the portal-dialog rules in `apps/web/src/index.css`). Gridroom uses Motion instead of Chatter's CSS/Web Animations transitions, adds listener/probe cleanup and post-dialog measurements, and keeps its own editor styling and deployment. No Chatter backend code is included.

The broader roadmap and feature/section completion checklists are in [docs/product-plan.md](docs/product-plan.md). Edge row/column controls, general undo/redo, IndexedDB migration, and opt-in demo packs are not implemented yet.

## Deploy To GitHub Pages

1. Push the project to the GitHub repository's `main` branch. The repository is already initialized with an `origin` remote.
2. In the GitHub repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** manually from the **Actions** tab.

The workflow installs locked dependencies, builds the site, runs the browser tests, and deploys `dist/` only after those checks pass. Pull requests run the same checks without deploying. The published URL is shown in the deployment environment, normally `https://<username>.github.io/<repository>/`.

No API keys or application secrets are needed. Saved boards belong to each browser origin: localhost boards will not automatically appear on the published site. GitHub Pages does not sync boards between devices. Review the rights to supplied images before publishing them in a public repository.

## Project Structure

- `src/App.jsx`: React editor UI, controls, and import/download interactions.
- `src/model.js`: workspace defaults and migration of saved boards.
- `src/export.js`: canvas sizing, image rendering, and export generation.
- `src/components/ui/`: typed Headless UI/Motion buttons, switches, accordion, action menu, and modal.
- `src/browser/scrollbar.ts`: scrollbar measurement and dialog lifecycle compensation support.
- `styles.css`: existing responsive canvas/editor styling and incremental Tailwind utilities.
- `public/assets/`: local fonts, images, and redistribution notices.
- `tests/editor.spec.js`: production-build browser regression checks.
- `.github/workflows/deploy.yml`: test and GitHub Pages deployment workflow.

## Editing And Export

- Set rows and columns independently for each board, from 1 to 6.
- Delete the active board with the trash button beside board navigation. Undo restores deleted boards during the current session without overwriting changes to surviving boards. Deleting the last board leaves an empty workspace that survives reload; the image library and uploads remain available, and Add Board resumes editing. Reload clears session Undo history, not the saved workspace.
- Drag a library image or an image file into a cell. Clicking a library image places it in the selected cell, including on touch devices.
- Drag filled cells to swap them. Edit headings on the board or in the selected-cell panel.
- Set an optional Image heading above the grid, such as Team DC or Team Marvel. Turn off Show heading to export without a banner while retaining the text; an empty heading also omits the banner.
- Choose DC, Marvel, or None under Publisher. DC uses a blue palette; Marvel uses a red palette. Colors are included in all exports and saved per board. Headers keep the team name centered without logos.
- Choose Bangers, Boogaloo, or Bebas Neue separately for the banner and character headings.
- Upload additional images, choose Fit or Fill, and adjust spacing and background.
- Export the active board or all boards as PNG, JPEG, or WebP. Allow multiple downloads when exporting all boards.
- Exports include the optional image heading, images, and character headings, not editor controls or the board's workspace name.

The default comic pairing is Bangers for the image heading and Boogaloo for character headings, with 0.5px letter spacing. All fonts are bundled locally. Fonts, icons, and original images stay local; no third-party service receives uploads. Boards are saved in this browser's local storage. Large imported images may exceed the browser storage limit; the app will report this and exports remain available for that session. Reducing the grid temporarily hides extra cells without deleting them.

## Check

```sh
npm run check
```

The browser tests run against the production build under `/tier-list/` to verify repository-subpath hosting. They check real drag-and-drop, uploads, grid resizing, local persistence and legacy migration, the mobile layout, and downloaded PNG/JPEG/WebP image pixels. Foundation checks cover heading visibility/export parity, animated controls, rename persistence/cancel, modal scroll/focus lifecycle, and touch-device no-autofocus. The multi-download export check has a larger timeout for image decoding and full-resolution output. Tests also write the two default full-resolution PNGs to `exports/`, which is ignored by Git.

```sh
npx playwright install chromium
npm test
```

`npm test` builds the app automatically and starts a dedicated preview server on localhost port 5840. That test port must be free; tests never reuse an unrelated project's server.

## Asset Notices

Font redistribution licenses are bundled alongside the font files. Icons are provided by `lucide-react`. Publisher colors do not include logos in the editor or exports. Supplied character artwork and unused publisher logo files remain subject to their owners' rights; this project does not grant a license to that artwork.
