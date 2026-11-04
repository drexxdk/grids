# Gridz

A single-grid image editor built with React 19 and Vite, with optional Google, Facebook and Discord accounts. Fresh workspaces start with one empty, neutral 3x3 grid and an empty image library. Guest editing needs no backend; accounts add named saved grids and private or published layout/style presets. There are no local/password accounts.

## Run

The product name is **Gridz**. Existing `@grids/*` workspace names, `grids-*` storage/database identifiers, `GRIDS_*` environment variables, `X-Grids-*` headers and deployed URLs are compatibility identifiers and intentionally unchanged by the rebrand.

Requires Node.js 22.12 or newer. Node.js 22 is used for deployment. This is one Git repository with npm workspace packages, like Chatter:

| Workspace | Purpose |
| --- | --- |
| `apps/web` | React/Vite frontend |
| `apps/api` | Express provider sign-in, sessions and saved-item API |
| `packages/database` | Postgres access and versioned SQL migrations |
| `packages/contracts` | Shared strict schemas and grid/settings transformations |

For guest-only development:

```sh
npm ci
npm run dev:web
```

Open the localhost URL printed in the terminal, normally http://localhost:5837. If that port is occupied, Vite automatically tries the next available port. Use Vite rather than opening the HTML directly so modules, fonts, and canvas exports load consistently.

### Accounts And Database

1. Copy `.env.example` to the root `.env` (preserve any existing credentials). Set `POSTGRES_PASSWORD` and the matching URL-encoded password in `DATABASE_URL`.
2. Start Docker Desktop, then run `npm run db:up`. Postgres 16 uses a named persistent volume and binds only to localhost port **5433**, leaving Chatter's port 5432 alone.
3. Configure both credentials for each desired sign-in provider in the root `.env`. Unconfigured providers are hidden; partially configured providers fail startup explicitly. No OAuth secrets enter the frontend build.
4. Run `npm run db:migrate`, then `npm start`. This starts the API on **5841** and the web app on **5837**. The API also applies migrations transactionally on startup, with an advisory lock. Stop development processes with Ctrl+C; `npm run db:stop` stops Postgres without deleting its volume.

Register these exact development callbacks in the provider consoles:

- Google: `http://localhost:5841/api/auth/google/callback`
- Facebook: `http://localhost:5841/api/auth/facebook/callback`
- Discord: `http://localhost:5841/api/auth/discord/callback`

Use the provider's development/test-user configuration where required; Facebook may require HTTPS/app review for the intended deployment. Never reuse Chatter's production secrets. `WEB_URL` is the fixed return URL after login (including any frontend subpath); `PUBLIC_API_URL` is the API origin, without `/api`. If Vite uses another port, update `WEB_URL` and restart the API. The dev server proxies `/api`; provider callbacks go directly to port 5841. Production configuration requires HTTPS.

The header's hamburger menu offers **Log in** for guests, or **Account** and **Sign out** when signed in. **Library** opens saved grids and presets. The Account modal is dedicated to connected providers and account deletion; deletion confirmation appears directly below its button without hiding the account. Browser Back from a provider restores the modal you left. Sign-in never uploads or replaces the browser draft automatically. Signed-in users can save new named grids, replace a saved grid with stale-write protection, load or delete grids, and save/apply/publish/unpublish/delete presets. Loads, replacements, deletions and preset application require confirmation. Shared presets are readable by guests; only the owner can change them. Lists are paginated in groups of 50. Deleting an account removes its sessions, saved grids and private/public presets.

**No image hosting:** saved grids contain layout, captions, crops, approved Commons/Met provenance and original-image references, plus opaque IDs for browser-local images. They never contain uploaded files, image bytes, blob/data URLs or local file paths. Provider images load directly from their original hosts after reload; neither Postgres nor IndexedDB stores provider image binaries. Initial import still validates the original using the existing 20 MB/40 MP limits. Browser-local uploads remain in IndexedDB until removed or browser storage is cleared, and can be resolved when loading a saved grid in that same browser. On another browser their cells retain captions/layout but are empty, with a warning. A deleted/unavailable provider image cannot be guaranteed to reload or export; failures remain visible. Provider images are not guaranteed offline.

Presets contain only reusable layout/style/export settings, never captions, grid headings or image references. Publishing is explicit and off by default. Local navigation preferences are not published or synced.

Sessions use random opaque HttpOnly, SameSite=Lax cookies (Secure in production); only token hashes are stored. OAuth state is browser-bound, single-use and expires after ten minutes, with PKCE for Google/Discord. Access/refresh tokens and email addresses are not retained. Provider+subject identifies a sign-in identity; identities are never automatically linked by email. State-changing API calls enforce the exact frontend Origin, a custom request header and JSON bodies. Server-side validation, ownership checks, request limits and a 1 MB document limit apply.

**Connected providers:** while signed in, open **Menu → Account → Connected sign-in providers**. Provider icons and names appear in one row, with selected borders and checkmarks on connected providers. Click an unconnected tile to go directly to its authorization page, or a connected tile to review disconnecting it; the final usable sign-in provider stays selected and cannot be disconnected. Connecting requires an origin-protected POST and authorization with that provider, bound to the exact initiating Gridz session. A new identity is attached to the current account. If it already belongs to another account, Gridz shows a ten-minute merge review instead: nothing is moved until confirmed. The current account keeps its ID/name; all incoming identities, grids and presets transfer atomically, retaining IDs, timestamps, duplicate names and public/private status. Sessions from the incoming account are revoked. Cancel, expired authorization or conflicting identities leave accounts separate. One identity per provider is allowed; if both accounts have different identities from the same provider, disconnect the conflicting identity first. Normal guest/provider sign-in never implicitly merges accounts.

Disconnect actions appear only when more than one provider is connected. Disconnecting a provider requires confirmation and leaves saves intact. It preserves the current session using another configured connected provider, while revoking other sessions authenticated through the removed provider and their pending link/merge authorizations. Disconnect confirmation appears inline beneath the provider tiles. At least one currently configured sign-in provider must remain. Logging into a disconnected identity later creates a separate account unless explicitly connected again. Account deletion removes every connected identity and its sessions, cloud saves and pending merge requests. Neither linking, merging nor disconnecting changes browser drafts or local uploads.

Migration `002_linked_providers.sql` copies existing provider identities into `account_identities`, preserves existing account IDs/saves/sessions, and records the sign-in provider for sessions. Deploy the migrated API before the matching frontend. Identity changes use one transactional Postgres advisory lock across API processes; database integration tests cover legacy migration, session binding, merges, conflicts, revocation and concurrent operations.

Signing out invalidates the server session but deliberately leaves the browser draft and uploads unchanged. Loading an account grid makes it the browser's current autosaved draft; this is one shared browser workspace, not a private local cache per account. Clear site data before handing a shared browser to someone else.

### Public Policies And Discord

Public, JavaScript-independent pages are available at [Terms of Service](https://gritz.pages.dev/terms), [Privacy Policy](https://gritz.pages.dev/privacy) and [Support/data deletion](https://gritz.pages.dev/support). Their source lives in `apps/web/public` and is also bundled into the hamburger menu's **Information** modal, with Terms, Privacy and Support tabs. Internal policy links switch tabs without leaving the editor; external policy links open separately. The modal works without the account API or a network connection. Cloudflare serves the standalone `.html` pages at clean URLs for providers and direct access. The service worker must not replace these pages with the editor shell.

Shareable editor links open the corresponding modal tab automatically: [Terms](https://gritz.pages.dev/?info=terms), [Privacy](https://gritz.pages.dev/?info=privacy) and [Support](https://gritz.pages.dev/?info=support). Switching tabs updates `info`; closing the modal removes it while preserving other parameters and fragments. This explicit information link is separate from locally saved editor navigation. Keep the standalone policy URLs above in Discord, Google and Facebook settings so their reviewers can read the documents without JavaScript or signing in.

Discord uses server-side authorization-code sign-in with PKCE and only the `identify` scope. In the Discord Developer Portal, configure:

- Terms of Service URL: `https://gritz.pages.dev/terms`
- Privacy Policy URL: `https://gritz.pages.dev/privacy`
- Production OAuth2 redirect: `https://gritz.pages.dev/api/auth/discord/callback`
- Development OAuth2 redirect: `http://localhost:5841/api/auth/discord/callback`
- Support URL, if requested: `https://gritz.pages.dev/support`

Keep **Public Client** disabled: the API, not the browser, holds `DISCORD_CLIENT_SECRET`. No bot, bot permissions, interactions endpoint or linked-role verification endpoint is required. The URL generator is not the application's login flow; use Gridz's Continue with Discord action. Store `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` only in ignored local `.env` and protected production `deploy/api.env`, then restart the API. Do not put either secret into `VITE_*` variables or source control. Provider deauthorization does not delete Gridz data; the support page explains both steps.

Review the policy text when data handling, infrastructure, contact details or retention practices change. Recovery backups are separate from live account deletion; the support contact must handle requests concerning those copies as described in the Privacy Policy.

## Build And Preview

```sh
npm run build
npm run preview
```

The production site is generated in `apps/web/dist/`. Preview normally runs at http://localhost:5838 and also falls back to another port when occupied. Relative build paths support both a GitHub Pages repository URL and a custom domain. Preview is static and does not proxy `/api`; use `npm start` for local account development.

## Install And Offline Use

On Android, open the published site in Chrome and use **Install app** or **Add to Home screen** from its menu. On iPhone, open it in Safari and choose **Share > Add to Home Screen**, with **Open as Web App** enabled if offered. Browser wording and automatic install prompts vary.

After the first online visit finishes caching, Gridz can launch, edit local uploads and export them offline. Its production service worker caches the app, local fonts and icons, not images or API/authentication routes; local uploads remain in IndexedDB. Provider references and account saves require the network. Installation is not backup or cross-device sync, and some browsers keep installed-app storage separate from browser-tab storage. Updates are checked on launch and resume without reusing cached worker scripts. New workers activate automatically; an already-open page reloads only after changes are saved and active editors, settings, dialogs and uploads have finished. Existing installations using the old update behavior may need one close and reopen after deployment; do not clear site data, which contains local images and grids. Service workers are disabled in development; installation requires HTTPS or localhost and the production build.

## Frontend Foundation

Controls use Headless UI for accessible interactions, Motion for animation, and Tailwind CSS v4 for styling. Account actions use Lucide icons, with packaged Google/Facebook/Discord marks from React Icons; destructive actions and their confirmation buttons use the shared red danger variant. Tailwind uses standard, unprefixed utilities without Preflight while existing canvas styles are migrated incrementally. All application modules use TypeScript/TSX and are strictly checked during every production build; run `npm run typecheck` separately when needed. Directly executed Node configs and browser-test scripts use `.mjs`. Do not add authored `.js` or `.jsx` files; Vite's generated JavaScript bundles are build output, not application source.

The header's Export grid button opens one dialog with format, resolution, quality, output dimensions and a Download image action. Export options persist across reloads; PNG disables lossy quality adjustment. Settings are grouped into Canvas, Heading and Card style. Canvas style contains Background, Padding and one shared Gap between the heading/grid and between cards. Fonts, weights, colors and sizes are adjusted directly, without themes or remembered preset profiles. Reset grid settings has a confirmation explaining which settings change and which images/content remain. Dialogs scroll at the viewport edge and keep the background locked through their exit animations. Touch devices focus a non-input control rather than opening the keyboard automatically.

The full-width header centers the row/column controls and Reset grid above the canvas, with Export grid and the sidebar toggle at the top right. Resize buttons use the supplied line-style add/remove row icons, rotated for columns, with green add and red remove themes across the whole button. Descriptive tooltips explain each action and its limits. Export switches to icon-only when its label no longer fits beside the centered controls. The controls then align left if needed; the header uses two rows only when the full left-aligned icon-only row also runs out of room. Controls remain fixed while grid items scroll, and no side or bottom control tracks reduce the canvas area. The Gridz icon and title sit at the header's left when they fit beside the centered controls, otherwise moving into the right aside below the header. Branding never shifts the centered controls, and the aside has no empty branding row when the brand is in the header. Desktop has Images and Settings tabs; mobile uses the same aside as a Settings-only overlay and uses the image picker for library access. The only sidebar close button stays in the main header. Opening the mobile overlay does not resize the canvas, and the closed overlay does not intercept canvas input. Reset grid settings remains at the bottom of Settings. Settings reset preserves placements and captions; full grid reset confirms before creating an empty default 3x3 grid, clearing headings/crops/overflow and resetting export settings while keeping library images. Online provides keyless Commons image search. Uploads and placements survive viewport changes, and touch dialogs do not autofocus text inputs.

Settings select portrait (3:4), landscape (4:3), or square (1:1) image tiles independently of row/column counts. Captions remain directly editable above, below, or on the image. On-image captions support top or bottom alignment and adjustable overlay color/opacity. Preview and export share tile/caption geometry; style changes retain images and text. Reset restores portrait tiles with bottom-overlay captions. Native grid scrollbars live at the dotted workspace edges: wheel or finger scrolling moves grid items while the grid heading and resize controls remain fixed. Card touch gestures still move images; the surrounding dotted area supports native panning.

Images always fill their tile. Crop image opens a fullscreen `react-easy-crop` editor with the current tile ratio, mouse/touch/keyboard panning, zoom, guides and reset. Apply saves validated normalized coordinates per cell; Cancel leaves the saved crop unchanged. Reopening restores the crop, and the grid and export use the same source rectangle, including after ratio changes. The original image file is never cropped or replaced, so reused images can have independent crops and can always be cropped differently later.

Font, format and resolution dropdowns share a Headless UI listbox with 44px controls and viewport-edge clearance. Font-family menus are alphabetical and preview each face in both options and triggers at 20px, with reduced vertical padding only for those menus. Heading and Card style each have a separate font-weight slider: Manrope supports 100 through 900 in 100-point steps; display fonts offer Regular (400) and browser-synthesized Bold (700). The selected weight affects previews, text measurement and exports, persists across reloads, and resets to 400. Background has a 64x44 color-picker target and a separate editable hex textbox. Six-digit hex accepts an optional `#`; valid edits update the grid, while incomplete/invalid text reverts on blur or Escape. Picker and text changes stay synchronized.

The modal structure and scrollbar-compensation pattern were adapted from the user's Chatter frontend (`apps/web/src/components/Modal.tsx`, `apps/web/src/scrollbarWidth.ts`, and the portal-dialog rules in `apps/web/src/index.css`). Gridz uses Motion instead of Chatter's CSS/Web Animations transitions, adds listener/probe cleanup and post-dialog measurements, and keeps its own editor styling and deployment. No Chatter backend code is included.

Development order and progress are tracked in [docs/roadmap.md](docs/roadmap.md). Uploaded fonts/thumbnails and additional/custom ratios remain pending. Dexie stores local-upload blobs and the coherent local grid/reference snapshot in IndexedDB (`grids-client-v1`); localStorage holds the settings cache (`grids-settings-v1`) and separate navigation preferences (`grids-ui-v1`). Restoration uses strict Zod validation and fresh blob URLs for local uploads. Obsolete prototype localStorage documents are ignored, without migration or backup UI.

Navigation survives reloads through browser-local preferences, without adding panel, source, search, topic or pagination parameters to the URL. Search narrows the selected topic; changing topics keeps the text, clearing text keeps the topic, and All removes only the topic constraint. Both choices reset pagination when changed and survive reloads/provider switches independently in the sidebar and picker. Topic coverage depends on provider metadata, not an exhaustive category taxonomy; see [topic scope and limits](docs/providers.md#search-and-topics). Browser Back/Forward restores these views using session-history state while keeping the address unchanged. Legacy navigation links are imported once into local preferences and cleaned from the address; unrelated query parameters and fragments are preserved.

Browser-local navigation preferences remember the Images/Settings panel, library and picker source, desktop sidebar visibility, and independent search/topic/page positions and previous-page cursors for each provider in the sidebar and picker. They are separate from document/settings saves and account-settings payloads. Invalid or unavailable preference storage falls back safely; session-history state still supports Back/Forward and reloads in the current tab. Crop/export/reset/image-picker dialogs and the mobile Settings overlay never reopen automatically, and touch text inputs are not focused on restoration. Provider metadata caching remains memory-only: reloading restores the browsing position but fetches its results again.

The image library has one Image source dropdown listing My images and each enabled provider, currently Wikimedia Commons and The Met, without a separate Online/provider dropdown or demo/example loader. Both support keyless public-domain/CC0 image search and the same compact provider-specific topic controls, shared cards and current appearance settings. Sidebar imports add to the library; mouse/touch drops import into the targeted cell, and picker imports place only the chosen image. Provider references and source/creator/license metadata survive reload without persisting original blobs; source links remain available in My images. Searches and image requests disclose query/network information to the selected provider, not local uploads. Other licenses and providers are not enabled. See [provider scope and compatibility checks](docs/providers.md). Defaults use Manrope and do not infer branding from the grid name or uploaded images. Artwork used by browser tests lives only in test fixtures, outside public builds.

The shared model separates layout/style/export settings from cell content and media. Its strict settings-only representation excludes images, font files, URLs/paths, placements, IDs, grid names, headings and captions. Private and public presets use this contract on both client and server. Saved grids have a separate reference-only contract. Applying settings validates before changing the grid and preserves local content, including cells outside the visible grid. Reset uses this shared path, with an explicit reset of the grid name and banner text.

All editor document changes use typed commands and a React reducer: grid/cell/export edits, placement/swaps/clearing, resizing/reset, and completed imports. Commands resolve current cell IDs rather than stale positions; resize/reset prepare new-cell IDs before dispatch so replay stays stable. Dialogs, save/export progress and pending image decoding remain outside the saved document. There is no undo feature.

## Deploy To Cloudflare Pages

The Git-connected Cloudflare Pages project is `gritz`, at **https://gritz.pages.dev/**. Production builds follow `main` in `incrementish/grids`, using repository root, Node 22, build command `npm run build:web` and output `apps/web/dist`. GitHub Actions independently runs builds, model/browser tests and API/Postgres tests; it no longer publishes a second GitHub Pages site. Pages deploys successful builds without waiting for those independent tests.

Root [functions/api/[[path]].ts](functions/api/[[path]].ts) forwards only `/api` requests to the fixed Oracle upstream. All browser API calls remain same-origin; do not set `VITE_API_URL` to the DuckDNS host. This preserves secure SameSite=Lax cookies without relying on third-party cookies. Functions stream API JSON and redirects, never image files. [wrangler.jsonc](wrangler.jsonc) defines public production bindings. Set `GRIDS_PROXY_SECRET` as a **production-only encrypted Pages secret**, identical to the API secret. Preview builds are disabled and the function independently rejects other origins; do not give previews production secrets. Use separate infrastructure/secrets for preview accounts.

The isolated Oracle stack is `/opt/grids`, Compose project `grids-prod`. Its private Postgres volume is separate from Chatter's database; neither Gridz container publishes a host port. Only the API additionally joins `chatter-prod_default` under alias `grids-api`. Chatter's API-host Caddy block imports `extras/*.caddy`; [deploy/caddy/grids.caddy](deploy/caddy/grids.caddy) owns only `/grids-api/*`. It forwards the trusted Pages client-IP header; all API endpoints except read-only health require the shared secret before rate limiting/session handling.

### Oracle Deployment

1. Copy the tracked repository files to `/opt/grids`, without copying local `.env`, `node_modules` or browser uploads. Keep server secrets, backups and volumes between releases.
2. With `umask 077`, copy [deploy/stack.env.example](deploy/stack.env.example) to `deploy/stack.env` and [deploy/api.env.example](deploy/api.env.example) to `deploy/api.env`. Generate independent database and proxy secrets with `openssl rand -hex 32`. Never commit these files. The stack password must remain hexadecimal because Compose constructs `DATABASE_URL` from it.
3. Ensure Chatter's tracked API Caddy block has `import extras/*.caddy`. Its deploy copies files without deleting the unmanaged `extras` directory, preserving Gridz routing.
4. Run `TAG=<release-id> bash deploy/deploy.sh`. It builds the ARM-compatible non-root API image, backs up an already-running Gridz database before migration, waits for both containers to be healthy, validates Caddy and reloads only Caddy. It does not restart Chatter's application or database containers.
5. Upload the proxy secret to Pages without displaying it: `npm exec -- wrangler pages secret put GRIDS_PROXY_SECRET --project-name gritz`. Set it only for production in the dashboard/API. Redeploy Pages after changing secrets or function bindings.

The API applies transactional migrations on startup. Protected SQL backups are stored in `/opt/grids/backups`; copy them to separate protected storage, define retention and test restoration before relying on them. A named volume alone is not a backup. Request-rate limits are process-local; keep one API process until introducing a shared limiter.

### Production Login Providers

Create separate provider applications and put their paired credentials only in `/opt/grids/deploy/api.env`, then recreate the API with `docker compose --env-file deploy/stack.env -f docker-compose.prod.yml up -d --wait api`. Unconfigured providers remain hidden.

- Google: `https://gritz.pages.dev/api/auth/google/callback`
- Facebook: `https://gritz.pages.dev/api/auth/facebook/callback`
- Discord: `https://gritz.pages.dev/api/auth/discord/callback`

Google's authorized JavaScript origin is `https://gritz.pages.dev`. Register the exact callbacks above and complete each provider's consent/test-user/app-review requirements. Actual provider consent flows require configured credentials and manual checks.

When changing the domain, update `GRIDS_PUBLIC_ORIGIN` in Wrangler, API `WEB_URL`/`PUBLIC_API_URL`, page metadata and all provider-console URLs together, then redeploy both services. Browser drafts/uploads belong to the old origin and do not automatically migrate to a new domain. Local Compose remains development-only.

Review the rights to supplied images before publishing them in a public repository.

## Project Structure

- [apps/web/src/App.tsx](apps/web/src/App.tsx): typed React editor UI, command dispatch and import/download interactions.
- [apps/web/src/components/AccountDialog.tsx](apps/web/src/components/AccountDialog.tsx): sign-in, explicit saves/loads, publishing and account deletion.
- [apps/web/src/components/EditorLayout.tsx](apps/web/src/components/EditorLayout.tsx): responsive editor panels.
- [packages/contracts/model.ts](packages/contracts/model.ts): grid/settings schemas, commands and reducer.
- [packages/contracts/cloud.ts](packages/contracts/cloud.ts): reference-only saved grids, settings-only presets and API response schemas.
- [apps/web/src/storage.ts](apps/web/src/storage.ts): browser-local upload blobs and grid/reference snapshots.
- [apps/web/src/browser/navigation.ts](apps/web/src/browser/navigation.ts): browser-local navigation preferences, session history and legacy URL cleanup.
- [apps/web/src/export.ts](apps/web/src/export.ts): canvas sizing and CORS-aware image exports.
- [apps/web/tests](apps/web/tests): model, browser and account regression tests and test-only artwork.
- [apps/api/src](apps/api/src): validated configuration, OAuth, sessions and owner-scoped CRUD.
- [apps/api/tests](apps/api/tests): contracts/OAuth tests and isolated real-Postgres integration tests.
- [packages/database](packages/database): Postgres pool and transactional SQL migration runner.
- [docker-compose.yml](docker-compose.yml): local Postgres 16 service and persistent volume.
- [apps/web/vite.config.mjs](apps/web/vite.config.mjs) and [apps/web/playwright.config.mjs](apps/web/playwright.config.mjs): web tooling.
- `.github/workflows/deploy.yml`: independent build and regression checks.

## Editing And Export

Browser saving is automatic, separately from explicit account saves. Local-upload blobs and grid content/references stay in IndexedDB; localStorage holds a settings-only cache and separate navigation preferences. Document saves coalesce edits over 300 ms and attempt a flush when the page becomes hidden. Routine progress and success messages are hidden; save failures, session-only mode and conflicts remain visible. Unsaved or failed edits retain a leave-page warning because abrupt termination can still lose pending changes. Browser storage is not permanent backup or synchronization.

The library begins with an Add images placeholder: a square tile when images exist, or a full-width larger target when empty. Placeholder text/icons, captions, and in-card action buttons scale with their card; controls outside cards retain their fixed dimensions. Hover a library image on desktop or tap it on mobile to reveal Delete. Clear all images sits below the library. Both actions remove library entries directly, without confirmations or a trash flow. Images already placed on the canvas or in removed cells remain intact, along with captions and placements, across reloads; their local media stays stored but is no longer offered in the library or image picker. Unused images are deleted transactionally with their metadata, and URLs are revoked only after successful deletion. Failed saves retain the stored snapshot/files for retry.

Guest documents carry opaque revision tokens. Saving compares the loaded revision inside the image/document transaction before changing files or the settings cache, so stale tabs cannot silently overwrite newer saves. Successful commits send only the guest document ID and revision through BroadcastChannel; focus/visibility checks cover unavailable or missed notifications. Opening an unchanged saved grid does not create another revision. Restoration reads the document and blobs from one coherent transaction.

Changed in another tab stops this tab's autosaves and displays a persistent warning. Local edits and images remain available for session editing/export; they are not automatically merged or discarded. Reload saved grid requires confirmation before replacing them with the saved version, and Cancel preserves them. Ordinary write failures still retry on subsequent edits; revision conflicts require an explicit reload.

- Add/remove columns and rows with the centered header controls, from 1 to 12 in each direction. Preview cards scale between 128 and 200 CSS pixels wide, scrolling when they cannot fit; export resolution is unchanged. Existing cells stay at their coordinates, and cells outside the visible grid are saved across reloads and reappear when expanding. There is no removed-cell tray, individual recovery control, or resize history.
- Reset grid settings restores grid configuration and export preferences and clears the banner heading after confirmation. Local images, cell captions, and placements are retained; cells outside the default 3x3 area remain recoverable by expanding the grid. Cancel leaves everything unchanged.
- Click or tap the whole empty image placeholder to choose an image. An empty library opens file upload directly; otherwise the picker offers library images and upload. Empty cells have no hover upload tools.
- Drop image files anywhere in the image-library panel to import them without placing them. Drop files or library images into a cell to place them there; drag feedback marks the receiving area. GIF uploads are excluded from file pickers and rejected on upload/drop, including renamed GIF files. Hover or tap a library image to reveal its delete control.
- The library's Image source dropdown lists My images and enabled providers directly, not category filters or a nested Online selector. My images contains client-local images and the upload tile, without filler cards; Wikimedia Commons and The Met provide paginated public-domain/CC0 image search with source/rights links. Search failures do not affect the grid or My images.
- Drag filled cells to swap them, including their crops. Hover or tap a filled image for its available Replace, Crop image and top-right Clear tools, each on a translucent contrasting surface without an opaque tool strip. Replacing or clearing a cell resets its crop; clearing leaves its library image available. Cells are not selected; captions are edited directly in their chosen above/below/on-image position.
- Each placed card owns its caption and crop, even when multiple cards use the same library image. Editing one card does not rename the library image or other cards. Library renames leave existing cards unchanged; new placements start with the current library title.
- Set an optional Image heading above the grid, such as Team DC or Team Marvel. Turn off Show heading to export without a banner while retaining the text; an empty heading also omits the banner.
- Adjust Canvas, Heading and Card style directly. Colors and typography are included in exports and saved with the grid.
- Choose Bangers, Bebas Neue, Boogaloo, or Manrope separately for the banner and cell headings, then set each font's weight with its slider.
- Upload additional images, adjust their visual crops, spacing and background. Imports show a spinner and completed-file count in the upload tile on desktop and mobile. Processing yields between files so the editor can update; invalid images are skipped with an error, and loading clears when the batch finishes.
- Export the grid as PNG, JPEG, or WebP. Format, resolution, and quality preferences survive reloads.
- Exports include the optional image heading, images, and cell headings, not editor controls or the grid's workspace name.

The optional legacy comic pairing is Bangers for the image heading and Boogaloo for cell headings, with 0.5px letter spacing. Default grids use Manrope. All fonts are bundled locally. Fonts, icons, and original images stay local; no third-party service receives uploads. Imported files use managed blob URLs and persist as IndexedDB blobs, not base64 strings in localStorage. Preset source tags retain image identity across reloads without storing temporary blob URLs.

Automatic persistence is quiet during normal editing; Save failed and other actionable warnings remain visible. Grid and new-image writes are transactional and serialized; failed saves leave editing/export usable and subsequent edits retry. Unavailable storage or a missing saved image enters Session only mode without overwriting the stored grid. Browser storage is not permanent backup or cross-device synchronization. Canvas exports remain capped at 16 MP on narrow/touch layouts and 32 MP otherwise; choose 150/300 px per image for larger grids. These are initial allocation safeguards, not a guarantee against every device's memory limits.

## Check

```sh
npm run check
npm run test:database
```

The browser tests run against the production build under `/grids/` to verify repository-subpath hosting. They check neutral first launch without demo requests, real drag-and-drop, uploads, grid resizing, autosave/reset/export preferences, invalid-document rejection, storage-failure feedback, responsive layout, caption editing, modal scroll/focus lifecycle, touch-device no-autofocus, and downloaded PNG/JPEG/WebP image pixels. Comic-based checks seed test-only fixtures directly into isolated browser storage; fixture artwork is excluded from public builds. The multi-format export check has a larger timeout for image decoding and full-resolution output. Tests also write full-resolution PNGs to `exports/`, which is ignored by Git.

Storage checks use real browser IndexedDB: large blobs and private grid content, settings-only localStorage, fresh object URLs, latest-edit persistence, transaction rollback/retry, unavailable-storage fallback, missing-image overwrite protection, and object-URL disposal. Library deletion checks verify retained canvas/overflow images, unused-blob reclamation, and rollback/retry without premature URL revocation. Tests await completed saves before reload and verify restored content and media identity.

Multi-tab checks cover unchanged tab opening, metadata-only notifications, local edit/export preservation, confirmed/cancelled reload, mobile warning layout, focus/visibility fallback without BroadcastChannel, stale purge/write rejection, simultaneous-writer atomicity, commit-only notifications, revision retry after rollback, and channel disposal.

```sh
npx playwright install chromium
npm test
```

`npm run test:api` runs contract and mocked provider exchanges without Postgres. `npm run test:database` requires `DATABASE_URL` and a running Postgres; it creates and drops an isolated random test schema, never clears application tables, and checks migrations, browser-bound OAuth state, sessions, ownership, stale replacements, public/private visibility, logout and cascading account deletion. Provider-console credentials and actual Google/Facebook/Discord consent screens still require manual deployment checks.

`npm test` builds the app automatically and starts a dedicated preview server on localhost port 5840. That test port must be free; tests never reuse an unrelated project's server.

For focused browser runs, rebuild first after application or CSS changes, then use `npm exec -w @grids/web -- playwright test --project=browser tests/account.spec.mjs`. Playwright's preview server serves `apps/web/dist/`, not source files. In [apps/web/tests/editor.spec.mjs](apps/web/tests/editor.spec.mjs), reuse `openSidebarPanel`, `closeSidebarPanel`, and `selectField` for panel-dependent actions, and `setEditorViewport` before settled geometry checks. Panel helpers wait for real exit/removal and entry boundaries rather than sleeps. Compare sidebar/workspace geometry with the permanent header and actual native-scrollbar content box, not retired drawer selectors or fixed offsets. Use `paletteColor` for editor-token assertions while retaining exact saved-content/export pixel checks. Use `touchTest` for automatic touch-context cleanup and `scrollbarTest` when testing classic native gutters. Selected choices are natively disabled; keyboard tests must verify that navigation skips them.

## Asset Notices

Font redistribution licenses are bundled alongside the font files. Icons are provided by `lucide-react`. Publisher colors do not include logos in the editor or exports. Supplied character artwork and unused publisher logo files remain subject to their owners' rights; this project does not grant a license to that artwork.
