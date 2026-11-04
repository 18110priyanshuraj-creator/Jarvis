# Creator Studio capability boundary and next steps

## Existing capabilities verified in source

- Media Studio can create a 2–12-scene storyboard, script, captions and visual directions.
- Export options include JSON, script, captions, PNG frames and silent WebM output.
- Formats are vertical short (up to 90 seconds), landscape explainer (up to 180 seconds) and square carousel (up to 60 seconds).
- YouTube Publisher has a saved preview and explicit confirmation step; it is not an automatic posting tool.
- Android Companion can launch installed apps and perform bounded accessibility-label actions, scrolling, Back/Home, and focused-field text entry.

## Capabilities not present / not claimed

- Direct Canva Connect API integration in the JARVIS server.
- Reliable drag-and-drop or arbitrary touch-coordinate control of Canva.
- Full multi-track timeline editing, precise clip timing, keyframe/rig animation or automated audio mastering.
- Native voiceover recording/generation in Media Studio.
- A full long-form video renderer beyond the current 180-second landscape storyboard limit.
- Guaranteed YouTube impressions, reach, views, retention or subscriber growth.

## Recommended staged roadmap

1. **Creator Studio skill:** activate the supplied optional skill after testing positive and negative triggers.
2. **Storyboard upgrades:** add long-form chapter plans (the current renderer stays bounded) and separate reusable stick-character pose/scene references.
3. **Editable project export:** prepare a Canva-friendly asset/script/caption bundle without claiming an editable Canva timeline unless the official integration creates one.
4. **Canva integration research:** assess the current official Canva Connect API capabilities and OAuth scopes before implementing. Keep credentials server-side and require user approval for any external write action.
5. **Android validation:** test Canva on the target tablet. Record which controls are actually exposed by Accessibility; keep unsupported drag/drop steps manual.
6. **Analytics review:** only connect channel analytics with explicit user consent and read-only scopes first. Use a video's own analytics to recommend experiments, never to promise an outcome.

## Acceptance criteria for future device-control work

- JARVIS must distinguish a requested app launch from a completed edit.
- Every visible tap requires a unique accessible label and a fresh screen observation.
- Unsupported gestures must fail honestly and ask the user to perform the step.
- No auto-publish, file deletion, permission grant or credential entry.
- Test on the physical Android device before claiming Canva workflow support.
