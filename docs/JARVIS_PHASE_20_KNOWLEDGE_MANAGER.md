# JARVIS Phase 20 — Knowledge Manager

**Status:** IN_PROGRESS (implementation branch and CI pending)  
**Current roadmap:** Phase 20 of the Phase 0 + Phase 1–32 plan  
**Implementation branch:** `feat/phase-20-knowledge-manager`

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

Automated coverage verifies file type/signature validation, UTF-8 and JSON extraction, sensitive-content rejection, duplicate SHA-256 handling, review-gated retrieval, search, and path traversal resistance. Full repository CI also runs Node tests/audit and Android build/APK checks.

Physical Galaxy Tab A9 file-picker, permission, download and lifecycle acceptance remains Phase 31.
