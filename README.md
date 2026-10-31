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

## Deploy To GitHub Pages

1. Create a GitHub repository and push this project to its `main` branch. This folder does not currently have Git initialized or a remote configured.
2. In the GitHub repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy GitHub Pages** manually from the **Actions** tab.

The workflow installs locked dependencies, builds the site, runs the browser tests, and deploys `dist/` only after those checks pass. Pull requests run the same checks without deploying. The published URL is shown in the deployment environment, normally `https://<username>.github.io/<repository>/`.

No API keys or application secrets are needed. Saved boards belong to each browser origin: localhost boards will not automatically appear on the published site. GitHub Pages does not sync boards between devices. Review the rights to supplied images before publishing them in a public repository.

## Project Structure

- `src/App.jsx`: React editor UI, controls, and import/download interactions.
- `src/model.js`: workspace defaults and migration of saved boards.
- `src/export.js`: canvas sizing, image rendering, and export generation.
- `styles.css`: existing responsive editor styling.
- `public/assets/`: local fonts, images, and redistribution notices.
- `tests/editor.spec.js`: production-build browser regression checks.
- `.github/workflows/deploy.yml`: test and GitHub Pages deployment workflow.

## Editing And Export

- Set rows and columns independently for each board, from 1 to 6.
- Drag a library image or an image file into a cell. Clicking a library image places it in the selected cell, including on touch devices.
- Drag filled cells to swap them. Edit headings on the board or in the selected-cell panel.
- Set an optional Image heading above the grid, such as Team DC or Team Marvel. Clear it to export without a banner.
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

The browser tests run against the production build under `/tier-list/` to verify repository-subpath hosting. They check real drag-and-drop, uploads, grid resizing, local persistence and legacy migration, the mobile layout, and downloaded PNG/JPEG/WebP image pixels. They also write the two default full-resolution PNGs to `exports/`, which is ignored by Git.

```sh
npx playwright install chromium
npm test
```

`npm test` builds the app automatically and starts a dedicated preview server on localhost port 5840. That test port must be free; tests never reuse an unrelated project's server.

## Asset Notices

Font redistribution licenses are bundled alongside the font files. Icons are provided by `lucide-react`. Publisher colors do not include logos in the editor or exports. Supplied character artwork and unused publisher logo files remain subject to their owners' rights; this project does not grant a license to that artwork.
