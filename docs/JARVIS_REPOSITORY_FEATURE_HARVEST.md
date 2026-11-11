# JARVIS repository feature harvest

**Target branch:** `feat/full-canva-voice-native-workspace`

This note records the review of these projects and the independent improvements selected for JARVIS:

- `openvideodev/react-video-editor`
- `trykimu/videoeditor`
- `canva-sdks/canva-apps-sdk-starter-kit`
- `Jay-yoon10/canva-asset-hub`
- `charliechan95/canvapipeline`
- `lukagoguadze2/CanvaAutomationSuite`

## Reuse decisions

### OpenVideo Editor

Reviewed for its browser-first multi-track, snapping, trimming, split, preview and export architecture. JARVIS already has a custom multi-track Media Studio with video, overlay and audio tracks, split/trim, keyframes, speed ramps, chroma key, masks, local preview and local video export. No OpenVideo editor source or dependency was copied. This avoids replacing a working renderer with a separate Next.js/PixiJS application and avoids importing its custom dual-license obligations into JARVIS.

### Kimu Video Editor

Reviewed for its AI edit assistant, multi-track workflow and media-library/cloud-project concepts. No source or dependencies were copied: the repository declares AGPLv3 as the default open-source license, offers a separate commercial license, and notes that the Remotion license also applies. JARVIS keeps its independent Media Studio implementation.

### Canva Apps SDK starter kit

Reviewed official examples for Canva-platform apps that add image/video/audio assets, replace selected video content and add audio tracks. No source, SDK package or starter-kit derivative was copied into the JARVIS website or Android app: the starter kit's license restricts its components and derivatives to apps offered on the Canva Platform. JARVIS instead keeps the separate Canva Connect API integration and Android Accessibility path. A future Canva-platform app would be a distinct project with its own Canva app registration and license compliance.

### Canva Asset Hub

Reviewed its asset catalog, tagging, async upload/export jobs and metadata-sync architecture. The repository did not expose a root LICENSE or LICENSE.md during this review, so no source files were copied. An original, browser-local IndexedDB library was implemented in JARVIS instead. Its media blobs and tags remain in the current browser profile; this is not cloud sync and does not upload media to Canva.

### CanvaPipeline

Reviewed its MIT-licensed Playwright/CDP approach to accessible toolbar labels for text formatting, font size and image replacement. No Python code, browser-debug port, remote-debugging setup, raw DOM script or coordinate logic was copied. JARVIS has an original native Android command parser that maps a short allow-listed set of Canva requests to exact visible accessibility labels. It only runs while the installed Canva app is foregrounded and leaves file selection, final commit and visual verification under the user's control.

### CanvaAutomationSuite

Reviewed its image/video editing workflow examples. No code was copied. Its README describes Google Sign-In with preconfigured account details in an `accounts.json` file; JARVIS does not store or automate Google/Canva login credentials, bypass authentication, or automate verification challenges.

## JARVIS changes in this branch

- New `public/media-asset-library.js`: validated IndexedDB storage for image/video/audio assets, MIME-kind normalization, tags, search/filter, last-used sorting, local blob retrieval and deletion.
- Media Studio UI for saving, searching, attaching and removing reusable assets.
- Magnetic timeline snapping for clip moves and trims: JARVIS snaps leading/trailing clip edges to nearby clip boundaries or the playhead within a small tolerance. The timeline's existing trim/split/keyframe logic remains the source of truth.
- Restores a saved asset into its timeline clip when reopening that project in the same browser profile. Assets are not synced to another browser/device. Direct file uploads still remain local to the browser.
- New Android `CanvaAccessibilityPolicy`: narrowly parsed formatting toggles, font-size field and selected-media replacement commands.
- New `UIActionExecutor.focusExactEditableField`: focuses one unique visible editable control matching an exact accessible label; typing is a separate bounded action.
- The Android voice path checks that Canva is the foreground app, uses the pre-existing protected-screen and exact-label policy, and does not automatically choose files or press Enter to commit font size.
- Automated Node and Android parser tests, including local asset metadata/filtering and timeline snap tolerance/alignment.

## Explicit non-goals

- No Canva credential scraping, Google sign-in automation, persistent password storage, CAPTCHA/2FA handling or hidden browser debugging port.
- No unrestricted Canva freeform timeline automation. Precise clip trimming/splitting in the Canva app remains conditional on what Android Accessibility exposes. JARVIS Media Studio's own timeline remains independently editable and exportable.
- No cloud media sync, third-party object storage or CDN provisioned by this change.
- No OpenVideo, Kimu/Remotion or Canva Apps SDK source copied into JARVIS.
