# Creator Studio capability boundary and next steps

## Implemented in this branch

- Creator Studio dashboard view with a 4–20 minute, eight-chapter timed outline builder.
- Full narration drafting through the existing JARVIS chat API when the server's AI provider is configured.
- Title and hook ideas, visual direction per chapter, Markdown script export, storyboard CSV export and YouTube description draft export.
- Stick-figure SVG pose generator (idle, walk, point, think, surprised and explaining) and an all-pose SVG sheet.
- A read-only YouTube Analytics panel for top-video performance and selected-video audience retention (views, watch time, average duration, average percentage viewed, likes, comments and subscribers gained). CTR is not included in this report and remains a manual YouTube Studio comparison field.
- A button to create and test an optional Creator Coach skill draft; skill activation remains a separate explicit approval step.
- Optional Canva Connect OAuth flow with encrypted refresh-token storage, explicit disconnect/revocation, thumbnail PNG asset upload, and creation of a new 1280 × 720 Canva design from that flat PNG. The user can open the design in Canva and refine it there.
- Optional read-only YouTube Analytics OAuth and reports for top videos and selected-video audience retention; thumbnail impression CTR remains a manual input.
- Creator Studio drafts are saved in local browser storage on the current device and can be exported to move them.

## Existing Media Studio capabilities verified in source

- Media Studio can create a 2–12-scene storyboard, script, captions and visual directions.
- Export options include JSON, script, captions, PNG frames and silent WebM output. Creator Studio also exports 1280 × 720 thumbnail PNGs, single-pose and pose-sheet SVGs, a short silent WebM stick-figure motion sample, long-form chapter CSV, Markdown script draft and YouTube description template.
- Formats are vertical short (up to 90 seconds), landscape explainer (up to 180 seconds) and square carousel (up to 60 seconds).
- YouTube Publisher has a saved preview and explicit confirmation step; it is not an automatic posting tool. Its upload permission is separate from the read-only YouTube Analytics permission.
- Android Companion can launch installed apps and perform bounded accessibility-label actions, scrolling, Back/Home, and focused-field text entry.

## Capabilities not present / not claimed

- Canva's client credentials are not configured in this repo or Vercel. The integration code is present, but a real Canva connection still needs the owner's registered Canva developer app, OAuth client ID/secret and exact callback URL entered as private server environment variables. No Canva account has been connected or tested here.
- The first Canva handoff creates a new custom 16:9 design containing a single flat thumbnail PNG. It does not create separately editable headline/shape layers or a video timeline.
- Reliable drag-and-drop or arbitrary touch-coordinate control of Canva.
- Full multi-track timeline editing, precise clip timing, keyframe/rig animation or automated audio mastering.
- Native voiceover recording/generation in Media Studio.
- A full long-form video renderer beyond the current 180-second landscape Media Studio renderer limit. Creator Studio makes a 4–20 minute plan and narration draft, not a finished video file.
- YouTube Analytics read-only OAuth/report code is implemented, but a live channel account has not yet granted the separate permission in this workspace. Thumbnail impression CTR still remains manual in the worksheet.
- Guaranteed YouTube impressions, reach, views, retention or subscriber growth.

## Remaining roadmap

1. **Canva Connect validation:** configure the owner's developer app credentials and exact redirect callback in private server settings, then test OAuth, asset upload, design creation and explicit revocation with the real account. Do not claim full timeline editing unless Canva exposes and the integration has tested it.
2. **Editable video handoff:** add a documented asset bundle with script, scene images, captions and audio notes; preserve a manual import/edit step in Canva.
3. **Long-form render pipeline:** design a separate renderer with voiceover/audio support and explicit processing/storage limits; do not extend the current 180-second Media Studio renderer without tests.
4. **YouTube analytics validation:** connect an account using the separate read-only permission, verify report eligibility, and compare top-video metrics / retention with the manual CTR worksheet. Keep API data separate from manually entered values.
5. **Android validation:** test Canva on the target tablet. Record which controls are actually exposed by Accessibility; keep unsupported drag/drop steps manual.
6. **Skill activation:** Creator Coach drafts must be validated and explicitly approved by the workspace owner.

## Acceptance criteria for future device-control work

- JARVIS must distinguish a requested app launch from a completed edit.
- Every visible tap requires a unique accessible label and a fresh screen observation.
- Unsupported gestures must fail honestly and ask the user to perform the step.
- No auto-publish, file deletion, permission grant or credential entry.
- Test on the physical Android device before claiming Canva workflow support.
