# Image Provider Compatibility

## Credentials Checklist

See [.env.example](../.env.example) for blank credentials and registration links for all credentialed image-provider candidates in the roadmap, plus a separate optional sign-in section. Keyless providers are listed without unnecessary credentials. Copy it to a local `.env`; real environment files are Git-ignored, while the example remains tracked.

The example is a preparation checklist, not runtime configuration: Commons and The Met are implemented and keyless; filling in other credentials does not enable integrations. Reserved variable names can change when those integrations are built. Credentialed integrations still require terms/rights review and approved backend/gateway hosting. Never add a `VITE_` prefix to secrets: those variables are exposed in browser builds, and GitHub Pages cannot keep them private. Do not send secrets in chats, screenshots or commits.

## Wikimedia Commons

Checked November 2, 2026. Initial integration: public-domain and CC0 JPEG, PNG and WebP files only. Other licenses, SVG, animation, unclear copyright, required attribution and nonempty restrictions are excluded. API access is not a warranty of rights: users must review the linked source page, especially for privacy, personality, trademark and jurisdiction-specific restrictions.

- Keyless MediaWiki Action API, anonymous `origin=*`, one provider per request. Selecting a provider in Image source loads its first browse topic automatically; compact Space, Nature, Art, Places and History icon buttons offer one-click discovery. The placeholder-only filter textbox automatically searches 300ms after typing stops, without a submit button. Clearing the filter restores the first topic, and selecting a topic cancels a pending text filter. No automatic page crawling. Twelve results per page; ineligible results are removed, so a page can be empty with another page available.
- Requests omit credentials and referrers. Search text and network identity reach Commons; image requests reach its upload CDN. Local uploads are never sent. No gateway, arbitrary URL proxy, server media storage or account dependency.
- Search timeout 15 seconds; original download timeout 30 seconds. Search changes/unmount cancel and ignore stale results. HTTP 429 honors `Retry-After`, with a 60-second default. No automatic retries. Loading, empty, offline, malformed-response, service and import failures leave Imported and the grid available.
- Original files are streamed with a 20 MB ceiling, checked raster MIME and a 40 MP metadata/decode ceiling. Source URLs use approved HTTPS hosts. These are safeguards, not representative-device memory certification. Originals and provider/entity IDs, creator, license and source links persist in IndexedDB only; settings exclude provenance and media. Reimport of an already-visible entity reuses its local asset.
- Online previews and Imported use the same LibraryImage/GridCell card renderer, current shape/caption/font/color settings and hover tools. Sidebar Import actions add library-only; mouse and touch drags download/import the original into the dropped-on cell. Cancelled drags do not import or place anything, and failed drops leave the grid unchanged. Picker cards remain selection-only and intentionally import into the captured target cell. Original files use the existing independent crop and PNG/JPEG/WebP export path. Source and rights links remain below the shared cards and persist in Imported after reload; previews do not show a separate license heading or metadata-heavy card design.
- Isolated Chromium smoke check used a page with origin `https://drexxdk.github.io`, without touching the live editor. One `earth filetype:bitmap` search returned HTTP 200; an original public-domain NASA city-lights JPEG returned HTTP 200, decoded at 4800x2400 and produced untainted PNG, JPEG and WebP canvas exports. This verifies current browser CORS from that origin, not a deployed release, every catalog file or every browser.
- Browse follow-up, November 2: current Commons responses use `thumb.wikimedia.org` for thumbnails; both that host and the earlier upload host are allowed for previews, while originals remain upload-host-only. The actual adapter returned eligible first-page examples for Space (11), Nature/Ansel Adams landscapes (12), Art (5), Places (6) and History (7). Counts and ordering can change with the catalog. All checks used isolated contexts, not the shared saved editor.
- Mocked CI checks cover desktop/mobile initial examples, compact titled topic buttons, inset search-icon geometry, contained focus feedback, debounced filtering without submit controls, default-topic restoration on clear, pending-filter cancellation, pagination, excluded rights, safe creator HTML-to-text conversion, stale responses, malformed data, empty/quota/offline failures, download failure/recovery, explicit import/placement, crop, actual PNG download, provenance/blob persistence and reload, plus settings exclusion. Shared-card checks compare Online and Imported across all three shapes and four caption positions with edited typography/colors, real mouse drops, touch cancellation/placement, failed-drop recovery and entity reuse. CI never queries the real catalog.

## The Met

Checked November 2, 2026. Keyless collection search and CC0 image import are enabled in the same source dropdown, sidebar and picker as Commons. Paintings, Sculpture, Portraits, Prints and Ceramics use the same compact icon-only topic row below the search field. These are one-click topic searches, not exhaustive department filters. Cards, appearance settings, caption editing, mouse/touch drag handling, picker selection, crop and export use the existing shared implementation.

- Uses the current `/public/collection/v1.1/search` endpoint with `offset` and `limit=12`, not the retired unpaginated search. Fetches at most twelve object details sequentially per page; no catalog crawling. Pages can contain fewer eligible images or none, with Next available when more IDs remain. Search stops before the documented 10,000-result boundary.
- Requires `isPublicDomain: true`, no nonempty `rightsAndReproduction`, both primary JPEG URLs on `images.metmuseum.org`, and a source page on `www.metmuseum.org`. Only these explicitly open-access images are labeled CC0. Creator text is stripped of markup. No rights inference from artwork age or title.
- Previews use `primaryImageSmall`; intentional import/drop downloads `primaryImage`. Original byte size and pixel dimensions are not supplied by this API: the shared streaming 20 MB ceiling and post-decode 40 MP ceiling still apply. Large originals can be rejected without placing anything. No TIFF, SVG or other new formats are enabled.
- One page's search/details share a 15-second deadline; originals retain the 30-second download deadline. Detail requests are spaced at least 100ms apart in the normal sequential path. Abort, stale-request guards, per-provider 429/Retry-After cooldowns and failure isolation leave Commons, Imported and the grid available. No credentials or referrers are sent.
- Shared import validates provider-bound source/image hosts, rejects embedded URL credentials and unexpected redirects, and preserves CC0/source/original/creator/entity metadata with the local blob. Entity reuse is scoped to the provider. Settings remain media/provenance-free.
- Isolated real-service check: the adapter's initial `painting` page returned two eligible images out of twelve IDs, with a next page. A CC0 Thomas Rowlandson image downloaded directly from the deployed site origin, decoded at 3476x3100 (4.6 MB), and produced untainted PNG, JPEG and WebP canvas exports. This is a sampled Chromium compatibility check, not every record/browser or a deployed-release certification.
- Mocked desktop/mobile checks cover initial topics and their placement, debounced filtering, pagination, excluded copyright/missing image/unsafe hosts, source links, failed-import recovery, native mouse placement/entity reuse, mobile picker placement, crop, actual PNG download, local blob/provenance persistence and reload, plus stale responses, invalid/empty/quota errors and provider-name-specific messaging. Existing Commons native/touch workflows exercise the same card/drag code.

Sources: [Met API and pagination](https://metmuseum.github.io/), [Met Open Access](https://www.metmuseum.org/about-the-met/policies-and-documents/open-access), [CC0](https://creativecommons.org/publicdomain/zero/1.0/).

## Deferred Browser Candidates

Also checked November 2, 2026: Art Institute of Chicago and Cleveland Museum of Art provide keyless public-domain/CC0 metadata. Their sampled image URLs did not include `Access-Control-Allow-Origin` for `https://drexxdk.github.io`, so browser downloads/canvas exports failed even though metadata searches succeeded. Neither is exposed as supported; the experimental Chicago adapter was removed. Recheck official image delivery/CORS before considering either again. No arbitrary image proxy, gateway or backend was added.

Sources: [Chicago API/image policy](https://api.artic.edu/docs/), [Cleveland Open Access API](https://openaccess-api.clevelandart.org/).

## Remaining Work

More providers/domains, approved licensed-content credit export, image variants/resolution selection, policy-aware bounded search caching/throttling, additional browser/device checks and real-service release rechecks. Do not present candidate integrations as supported.

Sources reviewed:

- [Commons API](https://commons.wikimedia.org/wiki/Commons:API)
- [Imageinfo API](https://www.mediawiki.org/wiki/API:Imageinfo)
- [Commons reuse requirements](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
- [Commons public domain guidance](https://commons.wikimedia.org/wiki/Commons:Public_domain)
