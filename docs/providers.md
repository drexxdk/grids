# Image Provider Compatibility

## Wikimedia Commons

Checked November 2, 2026. Initial integration: public-domain and CC0 JPEG, PNG and WebP files only. Other licenses, SVG, animation, unclear copyright, required attribution and nonempty restrictions are excluded. API access is not a warranty of rights: users must review the linked source page, especially for privacy, personality, trademark and jurisdiction-specific restrictions.

- Keyless MediaWiki Action API, anonymous `origin=*`, one provider per request. Opening Online loads the first provider-supplied browse topic automatically; Space, Nature, Art, Places and History offer one-click discovery without typing. Searches remain explicitly submitted, with no requests on typing or automatic page crawling. Twelve results per page; ineligible results are removed, so a page can be empty with another page available.
- Requests omit credentials and referrers. Search text and network identity reach Commons; image requests reach its upload CDN. Local uploads are never sent. No gateway, arbitrary URL proxy, server media storage or account dependency.
- Search timeout 15 seconds; original download timeout 30 seconds. Search changes/unmount cancel and ignore stale results. HTTP 429 honors `Retry-After`, with a 60-second default. No automatic retries. Loading, empty, offline, malformed-response, service and import failures leave Imported and the grid available.
- Original files are streamed with a 20 MB ceiling, checked raster MIME and a 40 MP metadata/decode ceiling. Source URLs use approved HTTPS hosts. These are safeguards, not representative-device memory certification. Originals and provider/entity IDs, creator, license and source links persist in IndexedDB only; settings exclude provenance and media. Reimport of an already-visible entity reuses its local asset.
- Sidebar imports do not place images. Picker imports intentionally place into its captured target cell. Imported originals use the existing independent crop and PNG/JPEG/WebP export path. Source and rights links remain available in Imported after reload.
- Isolated Chromium smoke check used a page with origin `https://drexxdk.github.io`, without touching the live editor. One `earth filetype:bitmap` search returned HTTP 200; an original public-domain NASA city-lights JPEG returned HTTP 200, decoded at 4800x2400 and produced untainted PNG, JPEG and WebP canvas exports. This verifies current browser CORS from that origin, not a deployed release, every catalog file or every browser.
- Browse follow-up, November 2: current Commons responses use `thumb.wikimedia.org` for thumbnails; both that host and the earlier upload host are allowed for previews, while originals remain upload-host-only. The actual adapter returned eligible first-page examples for Space (11), Nature/Ansel Adams landscapes (12), Art (5), Places (6) and History (7). Counts and ordering can change with the catalog. All checks used isolated contexts, not the shared saved editor.
- Mocked CI checks cover desktop/mobile initial examples, one-click browse topics, noninteractive search captions and contained focus feedback, search, pagination, excluded rights, safe creator HTML-to-text conversion, stale responses, malformed data, empty/quota/offline failures, download failure/recovery, explicit import/placement, crop, actual PNG download, provenance/blob persistence and reload, plus settings exclusion. CI never queries the real catalog.

Remaining: more providers/domains, approved licensed-content credit export, image variants/resolution selection, policy-aware bounded search caching/throttling, additional browser/device checks and real-service release rechecks. Do not present candidate integrations as supported.

Sources reviewed:

- [Commons API](https://commons.wikimedia.org/wiki/Commons:API)
- [Imageinfo API](https://www.mediawiki.org/wiki/API:Imageinfo)
- [Commons reuse requirements](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
- [Commons public domain guidance](https://commons.wikimedia.org/wiki/Commons:Public_domain)
