# JARVIS editing dataset format

Use JSONL: one complete example per line. Keep source provenance separate in a manifest and reference source IDs from each example.

Recommended task families:

- brief_to_edit_plan
- media_asset_understanding
- story_structure
- shot_selection
- pacing_and_cut_reasoning
- timeline_operation
- subtitle_and_caption_plan
- audio_mix_plan
- color_and_visual_consistency
- motion_and_transition_plan
- export_configuration
- render_error_recovery
- quality_assessment
- tool_selection

Each example should include:
- a task identifier and schema version;
- user brief and available media metadata;
- scene/frame/audio/transcript annotations where legally permitted;
- a target edit plan using only the canonical JARVIS operation schema;
- source IDs and provenance;
- quality-review status.

Do not put raw entire video files inside JSONL. Store approved assets separately and refer to them by stable IDs. Prefer small, aligned annotations (timestamps, shot descriptions, transcript segments and frame references) for the first version.

Suggested example shape (illustrative only):

{
  "schema_version": 1,
  "task_type": "brief_to_edit_plan",
  "messages": [
    {"role": "user", "content": "Create a calm 60-second landscape explainer from these approved assets."},
    {"role": "assistant", "content": "{"operations":[],"notes":"A real target must contain validated operations."}"}
  ],
  "media_context": {
    "duration_seconds": 60,
    "aspect_ratio": "16:9",
    "asset_ids": ["asset_001"]
  },
  "source_ids": ["source_001"],
  "review_status": "approved"
}

Keep train, validation and test examples separate by original source/project/creator, not by randomly splitting near-duplicate clips from the same project. Test data must remain unseen during training.
