# JARVIS Phase 20 — Knowledge Manager

**Status:** CODE_COMPLETE (repository scope; deployment volume and tablet acceptance remain external)  
**Current roadmap:** Phase 20 of the Phase 0 + Phase 1–32 plan  
**Implementation PR:** [#65](https://github.com/18110priyanshuraj-creator/Jarvis/pull/65), merged to `main` at `11351868839059a5148bb66d5ffcf97fbc20a82e`

## Scope

Turn the existing text-note Library into a managed document library with explicit collections, tags, file metadata, duplicate detection, review, secure download and deletion.

### Supported files

- Searchable text extraction: UTF-8 TXT, Markdown, CSV and JSON (JSON syntax is validated).
- Managed attachments: PDF, JPEG, PNG, WebP, MP3, M4A, WAV, OGG, WebM and MP4.
- All file types are size-limited to 15 MiB and are checked against both the declared MIME type and expected file signature.
- Unsupported active-content and archive types (HTML, JavaScript, SVG, ZIP and executable files) are rejected.

### Storage and safety

- File bytes are stored under a server-configured filesystem directory; only metadata and bounded extracted text are included in the existing application state/Neon persistence.
- Configure `JARVIS_DOCUMENTS_DIR` (or `JARVIS_DATA_DIR`) to a durable mounted volume in hosted production. The status API reports whether a path was configured but deliberately never claims that the host's retention policy was verified. Confirm the path is backed by a persistent volume; a database connection does not persist local file bytes.
- File names are sanitized; stored object names are generated IDs, not user-controlled paths. Downloads are always sent as attachments with `nosniff`.
- Secret-like text and sensitive personal information are rejected from indexed content, titles, tags and descriptions.
- Imported files are initially unreviewed. Only a user-reviewed document can enter assistant context. A review is the owner's approval, not independent verification.
- If online conversation AI is enabled, approved document context may be sent to the configured provider as part of an answer request. When online AI is disabled, covered requests use the built-in offline path. Review only material appropriate for that configured processing path.
- Duplicate files use SHA-256. No duplicate blob is written.
- Deletion removes the associated file and metadata.

### Honest extraction limits

- TXT/Markdown/CSV/JSON are indexed offline. The assistant can retrieve only user-reviewed extracted text and user-written descriptions.
- PDFs and media files are stored, listed, downloadable and searchable by metadata/tags/description. This phase does not claim PDF parsing, OCR, image understanding, audio transcription, video transcription or automatic captions.
- Those extraction engines require separate resource, licensing, quality and privacy decisions. No file is sent to an external AI provider automatically.

## API

- `GET /api/knowledge/documents` — filter by query, collection and review status.
- `POST /api/knowledge/documents` — authenticated raw-byte upload with metadata in bounded headers.
- `PATCH /api/knowledge/documents/:id` — edit collection/tags/description or review status.
- `GET /api/knowledge/documents/:id/download` — authenticated attachment download.
- `DELETE /api/knowledge/documents/:id` — remove file and record.
- `GET /api/knowledge/documents/status` — limits and storage durability warning; never reveals the filesystem path.

## Verification

- GitHub Actions PR run [41598828117](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41598828117) passed on implementation head `1ad69127297c52ab0cf07e22999dccf7f10d4a53`.
- Node test suite: 260 passed, 0 failed. Production dependency audit: 0 vulnerabilities.
- Android Companion: unit tests, debug build, APK integrity verification and artifact upload all passed.
- Debug APK artifact: `jarvis-companion-debug`, artifact ID `13213871772`, 23,992,550 bytes, expires 2026-11-10. This is not a signed production APK.
- PR #65 merge commit: `11351868839059a5148bb66d5ffcf97fbc20a82e`.

Automated coverage verifies file type/signature validation, UTF-8 and JSON extraction, sensitive-content rejection, duplicate SHA-256 handling, review-gated retrieval, search, and path traversal resistance. Full repository CI also runs Node tests/audit and Android build/APK checks.

Physical Galaxy Tab A9 file-picker, permission, download and lifecycle acceptance remains Phase 31.


## Closeout and deployment acceptance

The code is complete and merged. Production file persistence is not considered verified merely because a path is configured: set `JARVIS_DOCUMENTS_DIR` (or `JARVIS_DATA_DIR`) to a durable mounted volume and verify that the host retains it across deploys/restarts. The status API returns `durabilityVerified: false` intentionally because application code cannot validate the hosting provider's retention policy. Neon persists metadata and extracted text, not binary file bytes.

Physical Samsung Galaxy Tab A9 file-picker, upload, download and restart/lifecycle behavior remain Phase 31. PDFs and media are stored as metadata-only attachments; no OCR, PDF extraction or transcription is claimed.
