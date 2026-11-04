# Creator Studio capability boundary and next steps

## Implemented in this branch

- Creator Studio dashboard view with a 4–20 minute, eight-chapter timed outline builder.
- Full narration drafting through the existing JARVIS chat API when the server's AI provider is configured.
- Title and hook ideas, visual direction per chapter, Markdown script export, storyboard CSV export and YouTube description draft export.
- Stick-figure SVG pose generator (idle, walk, point, think, surprised and explaining) and an all-pose SVG sheet.
- A manual CTR / first-30-second-retention worksheet that compares entered metrics with the user's own channel baseline.
- A button to create and test an optional Creator Coach skill draft; skill activation remains a separate explicit approval step.
- Creator Studio drafts are saved in local browser storage on the current device and can be exported to move them.

## Existing Media Studio capabilities verified in source

- Media Studio can create a 2–12-scene storyboard, script, captions and visual directions.
- Export options include JSON, script, captions, PNG frames and silent WebM output. Creator Studio also exports 1280 × 720 thumbnail PNGs, single-pose and pose-sheet SVGs, a short silent WebM stick-figure motion sample, long-form chapter CSV, Markdown script draft and YouTube description template.
- Formats are vertical short (up to 90 seconds), landscape explainer (up to 180 seconds) and square carousel (up to 60 seconds).
- YouTube Publisher has a saved preview and explicit confirmation step; it is not an automatic posting tool.
- Android Companion can launch installed apps and perform bounded accessibility-label actions, scrolling, Back/Home, and focused-field text entry.

## Capabilities not present / not claimed

- Direct Canva Connect API integration in the JARVIS server. Canva's official Connect API supports design creation, asset uploads and MP4 export, but a production integration still requires a registered Canva developer app, OAuth credentials, user-granted scopes and secure token handling. The current branch only prepares SVG/script/CSV handoff assets and opens Canva; no Canva OAuth app is configured.
- Reliable drag-and-drop or arbitrary touch-coordinate control of Canva.
- Full multi-track timeline editing, precise clip timing, keyframe/rig animation or automated audio mastering.
- Native voiceover recording/generation in Media Studio.
- A full long-form video renderer beyond the current 180-second landscape Media Studio renderer limit. Creator Studio makes a 4–20 minute plan and narration draft, not a finished video file.
- Direct YouTube Analytics API access; the current Creator Studio worksheet uses manually entered metrics, not live channel data.
- Guaranteed YouTube impressions, reach, views, retention or subscriber growth.

## Remaining roadmap

1. **Canva Connect:** register a Canva developer app, implement user-authorized OAuth and only use official supported APIs (design creation, asset management and export). Do not claim full timeline editing unless Canva exposes and the integration has tested it.
2. **Editable video handoff:** add a documented asset bundle with script, scene images, captions and audio notes; preserve a manual import/edit step in Canva.
3. **Long-form render pipeline:** design a separate renderer with voiceover/audio support and explicit processing/storage limits; do not extend the current 180-second Media Studio renderer without tests.
4. **YouTube analytics:** evaluate read-only YouTube Analytics scopes and reports for impressions, CTR, average view duration and audience retention. Keep API data separate from manually entered worksheet values.
5. **Android validation:** test Canva on the target tablet. Record which controls are actually exposed by Accessibility; keep unsupported drag/drop steps manual.
6. **Skill activation:** Creator Coach drafts must be validated and explicitly approved by the workspace owner.

## Acceptance criteria for future device-control work

- JARVIS must distinguish a requested app launch from a completed edit.
- Every visible tap requires a unique accessible label and a fresh screen observation.
- Unsupported gestures must fail honestly and ask the user to perform the step.
- No auto-publish, file deletion, permission grant or credential entry.
- Test on the physical Android device before claiming Canva workflow support.
