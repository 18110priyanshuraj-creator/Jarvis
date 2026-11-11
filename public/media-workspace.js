import { createMediaAssetLibrary, formatMediaAssetSize } from "./media-asset-library.js";

const FORMATS = {
  "vertical-short": { width: 720, height: 1280, maxDurationSeconds: 90 },
  "landscape-explainer": { width: 1280, height: 720, maxDurationSeconds: 180 },
  "long-form": { width: 1280, height: 720, maxDurationSeconds: 1200 },
  "square-carousel": { width: 1080, height: 1080, maxDurationSeconds: 60 }
};
const MAX_PROJECT_DURATION_SECONDS = 20 * 60;
const MAX_SCENES = 80;
const MIN_SCENES = 2;

export function createMediaWorkspace({ api, toast }) {
  let projects = [];
  let currentProject = null;
  let selectedProjectId = null;
  let initialized = false;
  let previewFrame = 0;
  let previewStartedAt = 0;
  let previewing = false;
  let previewAudioContext = null;
  let previewAudioSources = [];
  const previewAudioBuffers = new WeakMap();
  let previewTimeMs = 0;
  let lastPlayheadUpdate = 0;
  let exporting = false;
  let cancelExportRequested = false;
  let audioFile = null;
  let audioObjectUrl = null;
  let musicFile = null;
  let musicObjectUrl = null;
  const sceneAssets = new Map();
  const timelineAssets = new Map();
  let selectedTimelineClipId = null;
  const activeTimelineClipIds = new Set();
  let activeVideoSceneId = null;
  const assetLibrary = createMediaAssetLibrary();
  let pendingAssetLibraryFile = null;

  const byId = (id) => document.getElementById(id);

  function projectDurationLimit(project = currentProject) {
    return FORMATS[project?.format]?.maxDurationSeconds || 180;
  }

  function sceneDurationLimit(project = currentProject) {
    return project?.format === "long-form" ? 120 : 30;
  }

  function formatDurationLabel(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (seconds < 60) return seconds + " sec";
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes + " min" + (remainder ? " " + remainder + " sec" : "");
  }

  function setStatus(message, isError = false) {
    const target = byId("media-status");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("error-text", isError);
  }

  function cleanFileName(value) {
    return String(value || "jarvis-media")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "jarvis-media";
  }

  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadText(name, text, type) {
    downloadBlob(name, new Blob([text], { type: type || "text/plain;charset=utf-8" }));
  }

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeField(labelText, value, field, type = "text") {
    const wrapper = makeElement("label", "media-field");
    wrapper.append(makeElement("span", "", labelText));
    const control = type === "textarea"
      ? makeElement("textarea", "media-scene-input")
      : makeElement("input", "media-scene-input");
    if (type === "textarea") control.rows = field === "voiceover" || field === "visualPrompt" ? 3 : 2;
    else control.type = type;
    if (type === "number") {
      control.min = "3";
      control.max = String(sceneDurationLimit());
      control.step = "1";
    }
    control.value = value ?? "";
    control.dataset.field = field;
    wrapper.append(control);
    return wrapper;
  }

  function makeSelectField(labelText, value, field, choices) {
    const wrapper = makeElement("label", "media-field");
    wrapper.append(makeElement("span", "", labelText));
    const select = makeElement("select", "media-scene-input");
    select.dataset.field = field;
    for (const [optionValue, optionLabel] of choices) {
      const option = makeElement("option", "", optionLabel);
      option.value = optionValue;
      select.append(option);
    }
    select.value = value;
    wrapper.append(select);
    return wrapper;
  }

  function makeRangeField(labelText, value, field, min, max, step = 1, suffix = "") {
    const wrapper = makeElement("label", "media-field media-range-field");
    const heading = makeElement("span", "", labelText);
    const readout = makeElement("output", "media-range-value", Number(value) + suffix);
    const input = makeElement("input", "media-scene-input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.dataset.field = field;
    input.addEventListener("input", () => {
      readout.textContent = Number(input.value) + suffix;
    });
    wrapper.append(heading, readout, input);
    return wrapper;
  }

  const VISUAL_CHOICES = [
    ["auto", "Automatic layout"],
    ["stick-figure", "Stick figure"],
    ["diagram", "Diagram / process"],
    ["quote", "Quote / text focus"],
    ["title-card", "Title card"]
  ];
  const POSE_CHOICES = [
    ["idle", "Neutral"], ["walk", "Walking"], ["point", "Pointing"],
    ["think", "Thinking"], ["celebrate", "Celebrating"]
  ];
  const ANIMATION_CHOICES = [
    ["fade", "Fade in"], ["rise", "Rise up"], ["bounce", "Bounce"],
    ["walk", "Walk cycle"], ["gesture", "Gesture"]
  ];
  const BACKGROUND_CHOICES = [
    ["midnight", "Midnight"], ["sunset", "Sunset"], ["paper", "Warm paper"],
    ["mint", "Mint"], ["violet", "Violet"]
  ];
  const TRANSITION_CHOICES = [
    ["cut", "Cut"], ["fade", "Crossfade"], ["slide", "Slide"],
    ["wipe", "Wipe"], ["zoom", "Zoom"]
  ];

  const CAMERA_CHOICES = [
    ["static", "Static"],
    ["ken-burns", "Ken Burns"],
    ["push-in", "Push in"],
    ["pull-out", "Pull out"],
    ["pan-left", "Pan left"],
    ["pan-right", "Pan right"],
    ["drift-up", "Drift up"]
  ];

  function disposeSceneAsset(sceneId) {
    const asset = sceneAssets.get(sceneId);
    if (!asset) return;
    if (asset.type === "video") {
      asset.element.pause();
      asset.element.removeAttribute("src");
      asset.element.load();
    }
    URL.revokeObjectURL(asset.url);
    sceneAssets.delete(sceneId);
  }

  function releaseProjectAssets(projectId) {
    for (const [sceneId, asset] of sceneAssets.entries()) {
      if (asset.projectId === projectId) disposeSceneAsset(sceneId);
    }
    for (const [clipId, asset] of timelineAssets.entries()) {
      if (asset.projectId !== projectId) continue;
      if (asset.element?.tagName === "VIDEO") {
        asset.element.pause();
        asset.element.removeAttribute("src");
        asset.element.load();
      }
      if (asset.url) URL.revokeObjectURL(asset.url);
      timelineAssets.delete(clipId);
      activeTimelineClipIds.delete(clipId);
    }
  }

  async function setSceneAsset(scene, file) {
    const projectId = currentProject?.id;
    if (!projectId || !scene?.id) return;
    if (!file) {
      disposeSceneAsset(scene.id);
      renderSceneEditors();
      renderPreview(currentProject, currentProject.scenes.findIndex((item) => item.id === scene.id));
      return;
    }
    const type = String(file.type || "").toLowerCase();
    if (!type.startsWith("image/") && !type.startsWith("video/")) {
      throw new Error("Choose an image or video file for this scene.");
    }
    if (file.size > 100 * 1024 * 1024) {
      throw new Error("Scene assets must be 100 MiB or smaller for local rendering.");
    }
    disposeSceneAsset(scene.id);
    const url = URL.createObjectURL(file);
    let element;
    if (type.startsWith("image/")) {
      element = new Image();
      element.decoding = "async";
      element.src = url;
      try {
        if (typeof element.decode === "function") await element.decode();
        else await new Promise((resolve, reject) => {
          element.onload = resolve;
          element.onerror = () => reject(new Error("The selected image could not be opened."));
        });
      } catch {
        URL.revokeObjectURL(url);
        throw new Error("The selected image could not be opened.");
      }
    } else {
      element = document.createElement("video");
      element.muted = true;
      element.loop = true;
      element.playsInline = true;
      element.preload = "auto";
      element.src = url;
      element.load();
    }
    if (currentProject?.id !== projectId ||
        !currentProject.scenes.some((item) => item.id === scene.id)) {
      URL.revokeObjectURL(url);
      if (type.startsWith("video/")) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      return;
    }
    sceneAssets.set(scene.id, {
      projectId,
      type: type.startsWith("video/") ? "video" : "image",
      name: file.name,
      url,
      element
    });
    const index = currentProject.scenes.findIndex((item) => item.id === scene.id);
    renderSceneEditors();
    renderPreview(currentProject, index);
    setExportStatus("Local scene asset selected: " + file.name + ". It will be included in the exported video and is not uploaded.");
  }

  function timelineCurveProgress(t, easing = "linear", curve = {}) {
    const p = Math.max(0, Math.min(1, t));
    if (easing === "hold") return p < 1 ? 0 : 1;
    if (easing === "ease-in") return p * p;
    if (easing === "ease-out") return 1 - (1 - p) ** 2;
    if (easing === "ease-in-out") return p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
    if (easing !== "cubic-bezier") return p;
    const x1 = Math.max(0, Math.min(1, Number(curve.x1 ?? 0.25)));
    const y1 = Math.max(0, Math.min(1, Number(curve.y1 ?? 0.1)));
    const x2 = Math.max(0, Math.min(1, Number(curve.x2 ?? 0.25)));
    const y2 = Math.max(0, Math.min(1, Number(curve.y2 ?? 1)));
    const bezier = (a, b, tValue) =>
      3 * a * (1 - tValue) ** 2 * tValue + 3 * b * (1 - tValue) * tValue ** 2 + tValue ** 3;
    let low = 0;
    let high = 1;
    let value = p;
    for (let step = 0; step < 12; step++) {
      const x = bezier(x1, x2, value);
      if (Math.abs(x - p) < 0.0005) break;
      if (x < p) low = value;
      else high = value;
      value = (low + high) / 2;
    }
    return bezier(y1, y2, value);
  }

  function sampleTimelinePoints(points, time, fields) {
    const ordered = [...(Array.isArray(points) ? points : [])].sort((a, b) => a.time - b.time);
    if (!ordered.length) return {};
    const rightIndex = ordered.findIndex((point) => point.time >= time);
    if (rightIndex === 0) return { ...ordered[0] };
    if (rightIndex < 0) return { ...ordered[ordered.length - 1] };
    const left = ordered[rightIndex - 1];
    const right = ordered[rightIndex];
    const span = Math.max(0.0001, right.time - left.time);
    const progress = timelineCurveProgress((time - left.time) / span, left.easing, left.curve);
    const value = { time };
    for (const field of fields) {
      const a = Number(left[field] ?? (field === "scale" || field === "opacity" || field === "speed" ? 1 : 0));
      const b = Number(right[field] ?? a);
      value[field] = a + (b - a) * progress;
    }
    return value;
  }

  function sampleClipTransform(clip, time) {
    const base = clip.transform || {};
    const animated = sampleTimelinePoints(clip.keyframes, time, ["x", "y", "scale", "opacity", "rotation"]);
    return {
      x: Number(base.x || 0) + Number(animated.x || 0),
      y: Number(base.y || 0) + Number(animated.y || 0),
      scale: Number(base.scale || 1) * Number(animated.scale || 1),
      opacity: Number(base.opacity ?? 1) * Number(animated.opacity ?? 1),
      rotation: Number(base.rotation || 0) + Number(animated.rotation || 0)
    };
  }

  function sampleClipSpeed(clip, time) {
    const points = clip.speedRamp?.length ? clip.speedRamp : [
      { time: 0, speed: clip.speed || 1 },
      { time: clip.duration, speed: clip.speed || 1 }
    ];
    return Math.max(0.25, Math.min(4, Number(sampleTimelinePoints(points, time, ["speed"]).speed || clip.speed || 1)));
  }

  function integrateClipSpeed(clip, toTime) {
    const to = Math.max(0, Math.min(clip.duration, Number(toTime) || 0));
    const steps = Math.max(8, Math.ceil(to * 20));
    const step = to / steps;
    let sourceSeconds = 0;
    for (let index = 0; index < steps; index++) {
      const a = sampleClipSpeed(clip, index * step);
      const b = sampleClipSpeed(clip, (index + 1) * step);
      sourceSeconds += (a + b) * 0.5 * step;
    }
    return sourceSeconds;
  }

  async function loadTimelineAsset(clip, file, libraryAssetId = null) {
    const projectId = currentProject?.id;
    if (!projectId || !clip?.id || !file) return;
    if (file.size > 100 * 1024 * 1024) throw new Error("Timeline media must be 100 MiB or smaller for local editing.");
    const type = String(file.type || "").toLowerCase();
    const isAudio = type.startsWith("audio/");
    const isImage = type.startsWith("image/");
    const isVideo = type.startsWith("video/");
    if (!isAudio && !isImage && !isVideo) throw new Error("Choose a video, image or audio file.");
    const track = currentProject.tracks.find((item) => item.clips.some((candidate) => candidate.id === clip.id));
    if (!track) throw new Error("The selected timeline track no longer exists.");
    if (track.kind === "audio" && !isAudio) throw new Error("Audio tracks accept audio files only.");
    if (track.kind !== "audio" && isAudio) throw new Error("Add audio files to an Audio track.");
    const url = URL.createObjectURL(file);
    let element = null;
    let duration = 6;
    if (isImage) {
      element = new Image();
      element.decoding = "async";
      element.src = url;
      try {
        if (typeof element.decode === "function") await element.decode();
        else await new Promise((resolve, reject) => {
          element.onload = resolve;
          element.onerror = () => reject(new Error("The selected image could not be opened."));
        });
      } catch {
        URL.revokeObjectURL(url);
        throw new Error("The selected image could not be opened.");
      }
    } else if (isVideo) {
      element = document.createElement("video");
      element.muted = true;
      element.loop = false;
      element.playsInline = true;
      element.preload = "auto";
      element.src = url;
      element.load();
      try {
        await new Promise((resolve, reject) => {
          if (element.readyState >= 1) return resolve();
          element.addEventListener("loadedmetadata", resolve, { once: true });
          element.addEventListener("error", () => reject(new Error("The selected video could not be decoded.")), { once: true });
        });
        duration = Number.isFinite(element.duration)
          ? Math.max(0.25, Math.min(projectDurationLimit(currentProject), element.duration))
          : 6;
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    }
    if (currentProject?.id !== projectId || !currentProject.tracks.some((item) => item.id === track.id)) {
      URL.revokeObjectURL(url);
      if (element?.tagName === "VIDEO") {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      return;
    }
    const currentClip = track.clips.find((item) => item.id === clip.id);
    if (!currentClip) {
      URL.revokeObjectURL(url);
      return;
    }
    const reattaching = Boolean(currentClip.assetId && currentClip.assetName);
    currentClip.assetId = libraryAssetId || clip.id;
    currentClip.assetName = file.name;
    currentClip.assetType = isAudio ? "audio" : isImage ? "image" : "video";
    currentClip.label = file.name.slice(0, 80);
    if (!reattaching && isVideo) {
      currentClip.duration = Math.max(0.25, Math.min(projectDurationLimit(currentProject) - currentClip.start, duration));
      currentClip.sourceIn = 0;
      currentClip.sourceOut = duration;
    } else if (!reattaching && isImage) {
      currentClip.duration = 6;
    }
    timelineAssets.set(clip.id, { projectId, type: currentClip.assetType, name: file.name, file, url, element, started: false, keyCanvas: null });
    currentProject.durationSeconds = Math.min(projectDurationLimit(currentProject), Math.max(currentProject.durationSeconds || 0, currentClip.start + currentClip.duration));
    selectedTimelineClipId = clip.id;
    renderTimelineEditor();
    renderPreviewAtTime(currentClip.start * 1000);
    setExportStatus("Added " + file.name + " to the " + track.name + " track. Media remains local to this browser session.");
  }


  function setAssetLibraryStatus(message, isError = false) {
    const target = byId("media-asset-library-status");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("error-text", isError);
  }

  function projectReferencesAsset(assetId) {
    return projects.some((project) => (project.tracks || []).some((track) =>
      (track.clips || []).some((clip) => clip.assetId === assetId)
    ));
  }

  function renderAssetLibrary(records) {
    const target = byId("media-asset-library-list");
    if (!target) return;
    target.replaceChildren();
    const selection = selectedTimelineClip();
    if (!records.length) {
      target.append(makeElement("p", "small muted", "No saved assets yet. Add an image, video or audio file above to keep a reusable copy in this browser."));
      return;
    }
    for (const record of records) {
      const card = makeElement("article", "media-library-asset");
      const header = makeElement("div", "media-library-asset-heading");
      const name = makeElement("strong", "media-library-asset-name", record.name);
      const meta = makeElement("span", "small muted", record.kind.toUpperCase() + " · " + formatMediaAssetSize(record.size));
      header.append(name, meta);
      card.append(header);
      if (record.tags?.length) card.append(makeElement("p", "media-library-tags", record.tags.map((tag) => "#" + tag).join("  ")));
      const actions = makeElement("div", "media-library-actions");
      const attach = makeElement("button", "item-action", "Attach to selected clip");
      attach.type = "button";
      const selectionCanAttach = Boolean(selection && currentProject?.status === "draft" &&
        (selection.track.kind === "audio" ? record.kind === "audio" : record.kind !== "audio"));
      attach.disabled = !selectionCanAttach;
      attach.addEventListener("click", async () => {
        const selected = selectedTimelineClip();
        if (!selected || currentProject?.status !== "draft") {
          setAssetLibraryStatus("Select a clip in a draft project before attaching a library asset.", true);
          return;
        }
        const compatible = selected.track.kind === "audio" ? record.kind === "audio" : record.kind !== "audio";
        if (!compatible) {
          setAssetLibraryStatus(selected.track.kind === "audio"
            ? "Audio tracks accept audio assets only."
            : "Add audio files to an Audio track.", true);
          return;
        }
        attach.disabled = true;
        try {
          const saved = await assetLibrary.get(record.id);
          if (!saved?.blob) throw new Error("This saved asset is unavailable in this browser. Import the file again.");
          const file = new File([saved.blob], saved.name, {
            type: saved.mimeType,
            lastModified: Date.parse(saved.updatedAt || saved.createdAt) || Date.now()
          });
          await loadTimelineAsset(selected.clip, file, saved.id);
          await assetLibrary.markUsed(saved.id);
          setAssetLibraryStatus("Attached " + saved.name + " to " + selected.track.name + ". The saved copy remains in this browser's library.");
          await refreshAssetLibrary();
        } catch (error) {
          setAssetLibraryStatus(error.message || "The saved asset could not be attached.", true);
          attach.disabled = false;
        }
      });
      actions.append(attach);
      const referenced = projectReferencesAsset(record.id);
      const remove = makeElement("button", "item-action media-library-delete", referenced ? "In use" : "Remove");
      remove.type = "button";
      remove.disabled = referenced;
      remove.title = referenced ? "Remove this asset from any saved project before deleting it." : "Delete this saved browser-local asset";
      remove.addEventListener("click", async () => {
        if (projectReferencesAsset(record.id)) {
          setAssetLibraryStatus("This asset is referenced by a saved project. Remove or replace those clips before deleting it.", true);
          return;
        }
        if (!window.confirm("Remove " + record.name + " from this browser's asset library? Saved projects using this asset may need the file attached again.")) return;
        remove.disabled = true;
        try {
          await assetLibrary.remove(record.id);
          setAssetLibraryStatus("Removed " + record.name + " from this browser's asset library.");
          await refreshAssetLibrary();
        } catch (error) {
          setAssetLibraryStatus(error.message || "The asset could not be removed.", true);
          remove.disabled = false;
        }
      });
      actions.append(remove);
      card.append(actions);
      target.append(card);
    }
  }

  async function refreshAssetLibrary() {
    const target = byId("media-asset-library-list");
    if (!target) return;
    try {
      const query = byId("media-asset-library-search")?.value || "";
      const kind = byId("media-asset-library-kind")?.value || "all";
      const tag = byId("media-asset-library-tag-filter")?.value || "";
      const records = await assetLibrary.list({ query, kind, tag });
      renderAssetLibrary(records);
      setAssetLibraryStatus(records.length + " saved asset(s) in this browser. Files stay on this device and are not uploaded or synced.");
    } catch (error) {
      target.replaceChildren();
      setAssetLibraryStatus(error.message || "The local asset library is unavailable.", true);
    }
  }

  async function restoreLibraryAssets(project) {
    if (!project?.id || typeof File !== "function") return;
    const projectId = project.id;
    const clips = (project.tracks || []).flatMap((track) => track.clips || []);
    for (const clip of clips) {
      if (!clip.assetId || !clip.assetName || timelineAssets.has(clip.id)) continue;
      if (currentProject?.id !== projectId) return;
      try {
        const saved = await assetLibrary.get(clip.assetId);
        if (!saved?.blob) continue;
        const file = new File([saved.blob], saved.name, {
          type: saved.mimeType,
          lastModified: Date.parse(saved.updatedAt || saved.createdAt) || Date.now()
        });
        await loadTimelineAsset(clip, file, saved.id);
        await assetLibrary.markUsed(saved.id);
      } catch (error) {
        setAssetLibraryStatus("A saved library asset could not be restored: " + (error.message || "open the clip and re-attach its file"), true);
      }
    }
    await refreshAssetLibrary();
  }

  async function savePendingAssetToLibrary() {
    const button = byId("media-asset-library-save");
    if (!pendingAssetLibraryFile) {
      setAssetLibraryStatus("Choose a file before saving it to the library.", true);
      return;
    }
    button.disabled = true;
    try {
      const tags = byId("media-asset-library-tags")?.value || "";
      const saved = await assetLibrary.save(pendingAssetLibraryFile, tags);
      pendingAssetLibraryFile = null;
      byId("media-asset-library-file").value = "";
      byId("media-asset-library-tags").value = "";
      setAssetLibraryStatus("Saved " + saved.name + " in this browser's reusable asset library.");
      await refreshAssetLibrary();
    } catch (error) {
      setAssetLibraryStatus(error.message || "The file could not be saved to the asset library.", true);
    } finally {
      button.disabled = false;
    }
  }

  function addTimelineTrack(kind) {
    if (!currentProject || currentProject.status !== "draft") return;
    if (!["video", "overlay", "audio"].includes(kind)) return;
    if (currentProject.tracks.length >= 8) {
      toast("A project can contain up to 8 tracks.", true);
      return;
    }
    const count = currentProject.tracks.filter((track) => track.kind === kind).length + 1;
    const track = {
      id: "track-" + crypto.randomUUID(),
      name: (kind === "video" ? "Video" : kind === "overlay" ? "Overlay" : "Audio") + " " + count,
      kind,
      visible: true,
      muted: false,
      clips: []
    };
    currentProject.tracks.push(track);
    renderTimelineEditor();
    setExportStatus(track.name + " created. Add local media to start editing.");
  }

  function addTimelineClip(trackId) {
    if (!currentProject || currentProject.status !== "draft") return null;
    const track = currentProject.tracks.find((item) => item.id === trackId);
    if (!track) return null;
    const start = track.clips.length
      ? Math.max(...track.clips.map((item) => item.start + item.duration))
      : 0;
    const id = "clip-" + crypto.randomUUID();
    const remaining = projectDurationLimit(currentProject) - start;
    if (remaining < 0.25) {
      toast("This project has reached its maximum timeline duration.", true);
      return null;
    }
    const duration = Math.max(0.25, Math.min(remaining, 6));
    const clip = {
      id,
      assetId: null,
      assetName: "",
      assetType: track.kind === "audio" ? "audio" : "video",
      label: "New clip",
      start,
      duration,
      sourceIn: 0,
      sourceOut: null,
      speed: 1,
      volume: 1,
      fit: "cover",
      transform: { x: 0, y: 0, scale: 1, opacity: 1, rotation: 0 },
      keyframes: [
        { time: 0, x: 0, y: 0, scale: 1, opacity: 1, rotation: 0, easing: "linear", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
        { time: duration, x: 0, y: 0, scale: 1, opacity: 1, rotation: 0, easing: "linear", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } }
      ],
      speedRamp: [
        { time: 0, speed: 1, easing: "linear", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
        { time: duration, speed: 1, easing: "linear", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } }
      ],
      chromaKey: { enabled: false, color: "#00ff00", similarity: 0.34, softness: 0.12 },
      mask: { shape: "none", x: 0, y: 0, width: 1, height: 1, feather: 0, invert: false },
      visible: true,
      muted: false
    };
    track.clips.push(clip);
    selectedTimelineClipId = clip.id;
    renderTimelineEditor();
    return clip;
  }

  function selectedTimelineClip() {
    if (!currentProject || !selectedTimelineClipId) return null;
    for (const track of currentProject.tracks) {
      const clip = track.clips.find((item) => item.id === selectedTimelineClipId);
      if (clip) return { track, clip };
    }
    return null;
  }

  function renderTimelineInspector() {
    const target = byId("media-timeline-inspector");
    if (!target) return;
    target.replaceChildren();
    const selection = selectedTimelineClip();
    if (!selection) {
      target.append(makeElement("p", "small muted", "Select a clip to trim, split, animate, key or retime it."));
      return;
    }
    const { track, clip } = selection;
    const section = (title) => {
      const box = makeElement("section", "timeline-inspector-section");
      box.append(makeElement("strong", "timeline-inspector-title", title));
      target.append(box);
      return box;
    };
    const field = (parent, label, value, path, options = {}) => {
      const wrapper = makeElement("label", "media-field timeline-control");
      wrapper.append(makeElement("span", "", label));
      const input = makeElement("input", "media-scene-input");
      input.type = options.type || "number";
      input.value = value ?? "";
      if (options.min !== undefined) input.min = String(options.min);
      if (options.max !== undefined) input.max = String(options.max);
      if (options.step !== undefined) input.step = String(options.step);
      input.dataset.timelineField = path;
      input.dataset.clipId = clip.id;
      wrapper.append(input);
      parent.append(wrapper);
      return input;
    };
    const select = (parent, label, value, path, choices) => {
      const wrapper = makeElement("label", "media-field timeline-control");
      wrapper.append(makeElement("span", "", label));
      const input = makeElement("select", "media-scene-input");
      for (const [choiceValue, choiceLabel] of choices) {
        const option = makeElement("option", "", choiceLabel);
        option.value = choiceValue;
        input.append(option);
      }
      input.value = value;
      input.dataset.timelineField = path;
      input.dataset.clipId = clip.id;
      wrapper.append(input);
      parent.append(wrapper);
      return input;
    };
    const toggle = (parent, label, value, path) => {
      const wrapper = makeElement("label", "timeline-toggle");
      const input = makeElement("input");
      input.type = "checkbox";
      input.checked = value === true;
      input.dataset.timelineField = path;
      input.dataset.clipId = clip.id;
      wrapper.append(input, makeElement("span", "", label));
      parent.append(wrapper);
    };
    const range = (parent, label, value, path, min, max, step = 0.01) => {
      const wrapper = makeElement("label", "media-field timeline-control");
      wrapper.append(makeElement("span", "", label));
      const input = makeElement("input", "media-scene-input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.dataset.timelineField = path;
      input.dataset.clipId = clip.id;
      wrapper.append(input);
      parent.append(wrapper);
    };
    const actions = makeElement("div", "timeline-action-row");
    const splitAt = makeElement("input", "media-scene-input timeline-split-input");
    splitAt.type = "number";
    splitAt.min = "0.25";
    splitAt.max = String(Math.max(0.25, clip.duration - 0.25));
    splitAt.step = "0.05";
    splitAt.value = String(Math.round(clip.duration * 0.5 * 100) / 100);
    splitAt.dataset.splitAt = "true";
    const split = makeElement("button", "item-action", "Split clip");
    split.type = "button";
    split.dataset.timelineAction = "split";
    split.dataset.clipId = clip.id;
    const remove = makeElement("button", "item-action media-delete", "Delete clip");
    remove.type = "button";
    remove.dataset.timelineAction = "delete";
    remove.dataset.clipId = clip.id;
    actions.append(splitAt, split, remove);
    const timing = section("Clip timing and trimming");
    field(timing, "Timeline start (s)", clip.start, "start", { min: 0, max: projectDurationLimit(), step: 0.05 });
    field(timing, "Clip duration (s)", clip.duration, "duration", { min: 0.25, max: projectDurationLimit(), step: 0.05 });
    field(timing, "Source in (s)", clip.sourceIn, "sourceIn", { min: 0, max: 36000, step: 0.05 });
    field(timing, "Source out (s)", clip.sourceOut ?? "", "sourceOut", { min: 0, max: 36000, step: 0.05 });
    field(timing, "Base speed (×)", clip.speed, "speed", { min: 0.25, max: 4, step: 0.05 });
    if (track.kind === "audio") field(timing, "Clip volume", clip.volume ?? 1, "volume", { min: 0, max: 1.5, step: 0.05 });
    select(timing, "Fit", clip.fit || "cover", "fit", [["cover", "Fill / cover"], ["contain", "Fit inside"]]);
    target.append(actions);

    toggle(timing, "Show clip", clip.visible !== false, "visible");
    if (track.kind === "audio") toggle(timing, "Mute this audio clip", clip.muted === true, "muted");

    const keying = section("Green screen / chroma key");
    toggle(keying, "Enable chroma key", clip.chromaKey?.enabled, "chromaKey.enabled");
    const colorField = makeElement("label", "media-field timeline-control");
    colorField.append(makeElement("span", "", "Key colour"));
    const color = makeElement("input");
    color.type = "color";
    color.value = clip.chromaKey?.color || "#00ff00";
    color.dataset.timelineField = "chromaKey.color";
    color.dataset.clipId = clip.id;
    colorField.append(color);
    keying.append(colorField);
    range(keying, "Similarity", clip.chromaKey?.similarity ?? 0.34, "chromaKey.similarity", 0.01, 1, 0.01);
    range(keying, "Edge softness", clip.chromaKey?.softness ?? 0.12, "chromaKey.softness", 0, 1, 0.01);

    const maskBox = section("Shape mask");
    select(maskBox, "Mask shape", clip.mask?.shape || "none", "mask.shape", [
      ["none", "No mask"], ["rectangle", "Rectangle"], ["ellipse", "Ellipse / circle"], ["rounded", "Rounded rectangle"]
    ]);
    toggle(maskBox, "Invert mask", clip.mask?.invert === true, "mask.invert");
    field(maskBox, "Mask X", clip.mask?.x ?? 0, "mask.x", { min: -1, max: 1, step: 0.01 });
    field(maskBox, "Mask Y", clip.mask?.y ?? 0, "mask.y", { min: -1, max: 1, step: 0.01 });
    range(maskBox, "Mask width", clip.mask?.width ?? 1, "mask.width", 0.05, 2, 0.01);
    range(maskBox, "Mask height", clip.mask?.height ?? 1, "mask.height", 0.05, 2, 0.01);
    range(maskBox, "Mask feather", clip.mask?.feather ?? 0, "mask.feather", 0, 0.5, 0.01);

    const speedBox = section("Speed ramp");
    const speedAdd = makeElement("button", "item-action", "Add speed point");
    speedAdd.type = "button";
    speedAdd.dataset.timelineAction = "add-speed-point";
    speedAdd.dataset.clipId = clip.id;
    speedBox.append(speedAdd);
    clip.speedRamp.forEach((point, index) => {
      const row = makeElement("div", "timeline-point-editor");
      row.append(makeElement("span", "timeline-point-label", "Speed point " + (index + 1)));
      field(row, "Time", point.time, "speedRamp." + index + ".time", { min: 0, max: clip.duration, step: 0.05 });
      field(row, "Speed ×", point.speed, "speedRamp." + index + ".speed", { min: 0.25, max: 4, step: 0.05 });
      select(row, "Curve", point.easing || "linear", "speedRamp." + index + ".easing", [
        ["linear", "Linear"], ["ease-in", "Ease in"], ["ease-out", "Ease out"],
        ["ease-in-out", "Ease in/out"], ["hold", "Hold"], ["cubic-bezier", "Custom Bezier"]
      ]);
      if (point.easing === "cubic-bezier") {
        for (const key of ["x1", "y1", "x2", "y2"]) {
          field(row, key.toUpperCase(), point.curve?.[key] ?? 0.25, "speedRamp." + index + ".curve." + key, { min: 0, max: 1, step: 0.01 });
        }
      }
      speedBox.append(row);
    });

    const keyframes = section("Transform keyframes");
    const keyAdd = makeElement("button", "item-action", "Add keyframe");
    keyAdd.type = "button";
    keyAdd.dataset.timelineAction = "add-keyframe";
    keyAdd.dataset.clipId = clip.id;
    keyframes.append(keyAdd);
    clip.keyframes.forEach((point, index) => {
      const row = makeElement("div", "timeline-point-editor");
      row.append(makeElement("span", "timeline-point-label", "Keyframe " + (index + 1)));
      for (const [label, key, min, max, step] of [
        ["Time (s)", "time", 0, clip.duration, 0.05],
        ["X", "x", -2, 2, 0.01], ["Y", "y", -2, 2, 0.01],
        ["Scale", "scale", 0.1, 4, 0.05], ["Opacity", "opacity", 0, 1, 0.05],
        ["Rotation°", "rotation", -360, 360, 1]
      ]) field(row, label, point[key] ?? 0, "keyframes." + index + "." + key, { min, max, step });
      select(row, "Curve", point.easing || "linear", "keyframes." + index + ".easing", [
        ["linear", "Linear"], ["ease-in", "Ease in"], ["ease-out", "Ease out"],
        ["ease-in-out", "Ease in/out"], ["hold", "Hold"], ["cubic-bezier", "Custom Bezier"]
      ]);
      if (point.easing === "cubic-bezier") {
        for (const key of ["x1", "y1", "x2", "y2"]) {
          field(row, key.toUpperCase(), point.curve?.[key] ?? 0.25, "keyframes." + index + ".curve." + key, { min: 0, max: 1, step: 0.01 });
        }
      }
      keyframes.append(row);
    });
    if (clip.assetId && clip.assetName && !timelineAssets.has(clip.id)) {
      const attach = makeElement("label", "item-action timeline-add-clip", "Re-attach " + clip.assetName);
      const input = makeElement("input");
      input.type = "file";
      input.accept = clip.assetType === "audio" ? "audio/*" : clip.assetType === "image" ? "image/*" : "video/*";
      input.addEventListener("change", async (event) => {
        try { await loadTimelineAsset(clip, event.target.files?.[0]); }
        catch (error) { toast(error.message, true); }
      });
      attach.append(input);
      target.append(attach);
    }
    target.append(makeElement("p", "small muted", "Asset files stay on this device. After reopening a saved project, re-attach local files to their timeline clips."));
  }

  function renderTimelineEditor() {
    const root = byId("media-timeline-tracks");
    if (!root || !currentProject) return;
    root.replaceChildren();
    const total = Math.max(1, currentProject.durationSeconds || 1);
    for (const track of currentProject.tracks || []) {
      const row = makeElement("section", "timeline-track-row");
      const header = makeElement("div", "timeline-track-header");
      header.append(makeElement("strong", "", track.name));
      header.append(makeElement("span", "timeline-track-kind", track.kind.toUpperCase()));
      const visible = makeElement("label", "timeline-toggle");
      const visibleInput = makeElement("input");
      visibleInput.type = "checkbox";
      visibleInput.checked = track.kind === "audio" ? track.muted !== true : track.visible !== false;
      visibleInput.dataset.trackId = track.id;
      visibleInput.dataset.trackField = track.kind === "audio" ? "muted" : "visible";
      visible.append(visibleInput, makeElement("span", "", track.kind === "audio" ? "Enabled" : "Visible"));
      header.append(visible);
      const addLabel = makeElement("label", "item-action timeline-add-clip", "＋ Add media");
      const file = makeElement("input");
      file.type = "file";
      file.accept = track.kind === "audio" ? "audio/*" : track.kind === "overlay" ? "image/*,video/*" : "video/*";
      file.disabled = currentProject.status !== "draft";
      file.addEventListener("change", async (event) => {
        const clip = addTimelineClip(track.id);
        try {
          if (clip) await loadTimelineAsset(clip, event.target.files?.[0]);
        } catch (error) {
          if (clip) track.clips = track.clips.filter((item) => item.id !== clip.id);
          renderTimelineEditor();
          toast(error.message, true);
        }
      });
      addLabel.append(file);
      header.append(addLabel);
      row.append(header);

      const lane = makeElement("div", "timeline-track-lane");
      for (const clip of track.clips.slice().sort((a, b) => a.start - b.start)) {
        const button = makeElement("button", "timeline-clip-block" + (selectedTimelineClipId === clip.id ? " selected" : ""));
        button.type = "button";
        button.dataset.clipId = clip.id;
        button.style.left = (clip.start / total * 100) + "%";
        button.style.width = Math.max(1.2, clip.duration / total * 100) + "%";
        button.style.touchAction = "none";
        const leftHandle = makeElement("span", "timeline-clip-handle left");
        leftHandle.dataset.dragEdge = "left";
        leftHandle.setAttribute("aria-label", "Trim clip start");
        const rightHandle = makeElement("span", "timeline-clip-handle right");
        rightHandle.dataset.dragEdge = "right";
        rightHandle.setAttribute("aria-label", "Trim clip end");
        button.append(leftHandle);
        const asset = timelineAssets.get(clip.id);
        button.append(makeElement("strong", "", clip.label || asset?.name || "Clip"));
        const timeLabel = makeElement("span", "timeline-clip-time",
          Number(clip.start).toFixed(1) + "s · " + Number(clip.duration).toFixed(1) + "s");
        button.append(timeLabel);
        if (clip.assetId && !asset) button.append(makeElement("small", "", "Re-attach media"));
        button.append(rightHandle);
        button.addEventListener("pointerdown", (event) => {
          if (currentProject.status !== "draft" || event.button > 0) return;
          event.preventDefault();
          selectedTimelineClipId = clip.id;
          const edge = event.target?.closest?.("[data-drag-edge]")?.dataset?.dragEdge || "move";
          const rect = lane.getBoundingClientRect();
          if (!rect.width) return;
          const pointerId = event.pointerId;
          const startX = event.clientX;
          const initial = {
            start: clip.start,
            duration: clip.duration,
            sourceIn: clip.sourceIn || 0,
            sourceOut: clip.sourceOut,
            speed: clip.speed || 1
          };
          button.setPointerCapture(pointerId);
          button.classList.add("dragging");
          const onMove = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            const delta = (moveEvent.clientX - startX) / rect.width * total;
            if (edge === "move") {
              clip.start = Math.max(0, Math.min(projectDurationLimit(currentProject) - initial.duration, initial.start + delta));
            } else if (edge === "left") {
              const boundedDelta = Math.max(-Math.min(initial.sourceIn, initial.start),
                Math.min(initial.duration - 0.25, delta));
              clip.start = Math.max(0, initial.start + boundedDelta);
              clip.duration = Math.max(0.25, initial.duration - boundedDelta);
              clip.sourceIn = Math.max(0, initial.sourceIn + (boundedDelta >= 0
                ? integrateClipSpeed({ ...clip, duration: initial.duration }, boundedDelta)
                : -integrateClipSpeed({ ...clip, duration: initial.duration }, -boundedDelta)));
              if (initial.sourceOut !== null && initial.sourceOut !== undefined) clip.sourceOut = initial.sourceOut;
            } else if (edge === "right") {
              clip.duration = Math.max(0.25, Math.min(projectDurationLimit(currentProject) - initial.start, initial.duration + delta));
              if (initial.sourceOut !== null && initial.sourceOut !== undefined) {
                clip.sourceOut = initial.sourceIn + integrateClipSpeed({ ...clip, duration: initial.duration }, clip.duration);
              }
            }
            clip.keyframes = clip.keyframes.map((point) => ({ ...point, time: Math.max(0, Math.min(clip.duration, point.time)) }));
            clip.speedRamp = clip.speedRamp.map((point) => ({ ...point, time: Math.max(0, Math.min(clip.duration, point.time)) }));
            button.style.left = (clip.start / total * 100) + "%";
            button.style.width = Math.max(1.2, clip.duration / total * 100) + "%";
            timeLabel.textContent = Number(clip.start).toFixed(1) + "s · " + Number(clip.duration).toFixed(1) + "s";
            currentProject.durationSeconds = Math.min(projectDurationLimit(currentProject), Math.max(0,
              ...currentProject.tracks.flatMap((item) => item.clips.map((candidate) => candidate.start + candidate.duration))
            ));
          };
          const onEnd = (endEvent) => {
            if (endEvent.pointerId !== pointerId) return;
            button.classList.remove("dragging");
            button.removeEventListener("pointermove", onMove);
            button.removeEventListener("pointerup", onEnd);
            button.removeEventListener("pointercancel", onEnd);
            renderTimelineEditor();
            renderPreviewAtTime(clip.start * 1000);
          };
          button.addEventListener("pointermove", onMove);
          button.addEventListener("pointerup", onEnd);
          button.addEventListener("pointercancel", onEnd);
        });
        button.addEventListener("click", () => {
          selectedTimelineClipId = clip.id;
          renderTimelineEditor();
          renderPreviewAtTime(clip.start * 1000);
        });
        lane.append(button);
      }
      row.append(lane);
      root.append(row);
    }
    renderTimelineInspector();
    for (const id of ["media-timeline-add-video", "media-timeline-add-overlay", "media-timeline-add-audio"]) {
      const button = byId(id);
      if (button) button.disabled = currentProject.status !== "draft" || currentProject.tracks.length >= 8;
    }
  }

  function updateTimelineField(event) {
    const target = event.target;
    const path = target?.dataset?.timelineField;
    const clipId = target?.dataset?.clipId;
    if (!path || !clipId || !currentProject) return;
    const selection = (() => {
      for (const track of currentProject.tracks) {
        const clip = track.clips.find((item) => item.id === clipId);
        if (clip) return { track, clip };
      }
      return null;
    })();
    if (!selection) return;
    const emptySourceOut = path === "sourceOut" && target.value === "";
    const value = target.type === "checkbox" ? target.checked
      : target.type === "number" || target.type === "range" ? Number(target.value)
        : target.value;
    const parts = path.split(".");
    let object = selection.clip;
    for (let index = 0; index < parts.length - 1; index++) {
      const part = parts[index];
      const arrayIndex = /^\d+$/.test(part) ? Number(part) : part;
      object = object[arrayIndex];
      if (!object) return;
    }
    const last = parts[parts.length - 1];
    object[last] = emptySourceOut ? null : value;
    if (["start", "duration", "sourceIn", "sourceOut", "speed", "volume"].includes(path)) {
      selection.clip[path] = emptySourceOut ? null : value;
    }
    currentProject.durationSeconds = Math.min(projectDurationLimit(currentProject), Math.max(0,
      ...currentProject.tracks.flatMap((track) => track.clips.map((item) => item.start + item.duration))
    ));
    renderPreviewAtTime(selection.clip.start * 1000);
  }

  function splitSelectedTimelineClip(clipId, splitAt) {
    const selection = (() => {
      for (const track of currentProject.tracks) {
        const clip = track.clips.find((item) => item.id === clipId);
        if (clip) return { track, clip };
      }
      return null;
    })();
    if (!selection) return;
    const { track, clip } = selection;
    const at = Number(splitAt);
    if (!Number.isFinite(at) || at <= 0.25 || at >= clip.duration - 0.25) {
      toast("Split point must be at least 0.25 seconds from either edge.", true);
      return;
    }
    const sampledSpeed = sampleClipSpeed(clip, at);
    const transform = sampleClipTransform(clip, at);
    const sourceSplit = clip.sourceIn + integrateClipSpeed(clip, at);
    const second = structuredClone(clip);
    second.id = "clip-" + crypto.randomUUID();
    second.label = (clip.label || "Clip") + " · B";
    second.start = clip.start + at;
    second.duration = clip.duration - at;
    second.sourceIn = sourceSplit;
    second.keyframes = [
      { time: 0, ...transform, easing: "linear", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
      ...clip.keyframes.filter((point) => point.time > at).map((point) => ({ ...point, time: point.time - at }))
    ];
    second.speedRamp = [
      { time: 0, speed: sampledSpeed, easing: "linear", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
      ...clip.speedRamp.filter((point) => point.time > at).map((point) => ({ ...point, time: point.time - at }))
    ];
    clip.duration = at;
    clip.sourceOut = sourceSplit;
    clip.keyframes = [
      ...clip.keyframes.filter((point) => point.time < at),
      { time: at, ...transform, easing: "linear", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } }
    ];
    clip.speedRamp = [
      ...clip.speedRamp.filter((point) => point.time < at),
      { time: at, speed: sampledSpeed, easing: "linear", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } }
    ];
    track.clips.push(second);
    const asset = timelineAssets.get(clipId);
    if (asset) {
      timelineAssets.set(second.id, { ...asset, started: false, keyCanvas: null });
    }
    selectedTimelineClipId = second.id;
    renderTimelineEditor();
    renderPreviewAtTime(second.start * 1000);
  }

  function handleTimelineAction(event) {
    const button = event.target?.closest?.("[data-timeline-action]");
    if (!button || !currentProject || currentProject.status !== "draft") return;
    const clipId = button.dataset.clipId;
    const selection = selectedTimelineClip();
    if (button.dataset.timelineAction === "split") {
      const value = byId("media-timeline-inspector")?.querySelector("[data-split-at]")?.value;
      splitSelectedTimelineClip(clipId, value);
    } else if (button.dataset.timelineAction === "delete") {
      for (const track of currentProject.tracks) {
        const found = track.clips.find((clip) => clip.id === clipId);
        if (found) {
          track.clips = track.clips.filter((clip) => clip.id !== clipId);
          const asset = timelineAssets.get(clipId);
          if (asset?.url) URL.revokeObjectURL(asset.url);
          asset?.element?.pause?.();
          timelineAssets.delete(clipId);
          activeTimelineClipIds.delete(clipId);
          currentProject.durationSeconds = Math.min(projectDurationLimit(currentProject), Math.max(0,
            ...currentProject.tracks.flatMap((item) => item.clips.map((candidate) => candidate.start + candidate.duration))
          ));
          selectedTimelineClipId = null;
          renderTimelineEditor();
          renderPreviewAtTime(0);
          return;
        }
      }
    } else if (button.dataset.timelineAction === "add-keyframe" && selection) {
      const clip = selection.clip;
      if (clip.keyframes.length >= 16) return toast("A clip supports up to 16 keyframes.", true);
      const time = Math.round(clip.duration * 0.5 * 100) / 100;
      const value = sampleClipTransform(clip, time);
      clip.keyframes.push({ time, ...value, easing: "cubic-bezier", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } });
      clip.keyframes.sort((a, b) => a.time - b.time);
      renderTimelineEditor();
    } else if (button.dataset.timelineAction === "add-speed-point" && selection) {
      const clip = selection.clip;
      if (clip.speedRamp.length >= 8) return toast("A clip supports up to 8 speed points.", true);
      const time = Math.round(clip.duration * 0.5 * 100) / 100;
      clip.speedRamp.push({ time, speed: 2, easing: "cubic-bezier", curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } });
      clip.speedRamp.sort((a, b) => a.time - b.time);
      renderTimelineEditor();
    }
  }

  function syncSceneTimeline(project) {
    const main = project.tracks?.find((track) => track.id === "track-main-video");
    if (!main) return;
    const scenesById = new Map(project.scenes.map((scene) => [scene.id, scene]));
    main.clips = main.clips.filter((clip) => !clip.sceneId || scenesById.has(clip.sceneId));
    for (const clip of main.clips) {
      const scene = clip.sceneId ? scenesById.get(clip.sceneId) : null;
      if (scene) clip.label = scene.heading;
    }
    project.durationSeconds = Math.min(projectDurationLimit(project), Math.max(0,
      ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration))
    ));
  }

  function addSceneTimelineClip(project, scene) {
    const main = project.tracks?.find((track) => track.id === "track-main-video");
    if (!main || main.clips.some((clip) => clip.sceneId === scene.id)) return;
    const start = Math.max(0, ...main.clips.map((clip) => clip.start + clip.duration));
    const remaining = projectDurationLimit(project) - start;
    if (remaining < 0.25) return;
    main.clips.push({
      id: "clip-" + scene.id,
      sceneId: scene.id,
      assetId: null,
      assetName: "",
      assetType: "scene",
      label: scene.heading,
      start,
      duration: Math.min(scene.durationSeconds, remaining),
      sourceIn: 0,
      sourceOut: null,
      speed: 1,
      speedRamp: [],
      keyframes: [],
      chromaKey: { enabled: false, color: "#00ff00", similarity: 0.34, softness: 0.12 }
    });
    syncSceneTimeline(project);
  }

  function reorderMainSceneClips(project) {
    const main = project.tracks?.find((track) => track.id === "track-main-video");
    if (!main) return;
    let cursor = 0;
    for (const scene of project.scenes) {
      const group = main.clips.filter((item) => item.sceneId === scene.id);
      if (!group.length) continue;
      const groupStart = Math.min(...group.map((clip) => clip.start));
      const groupEnd = Math.max(...group.map((clip) => clip.start + clip.duration));
      const groupDuration = Math.max(0, groupEnd - groupStart);
      for (const clip of group) {
        clip.start = cursor + (clip.start - groupStart);
      }
      cursor += groupDuration;
    }
    syncSceneTimeline(project);
  }

  function seekTimelineAssets(elapsedMs) {
    if (!currentProject) return;
    const time = Math.max(0, elapsedMs / 1000);
    for (const track of currentProject.tracks || []) {
      if (track.kind === "audio" || track.visible === false) continue;
      for (const clip of track.clips) {
        if (clip.assetType !== "video" || !clip.assetId) continue;
        const asset = timelineAssets.get(clip.id);
        const video = asset?.element;
        if (!video) continue;
        const localTime = Math.max(0, Math.min(clip.duration, time - clip.start));
        video.pause();
        if (asset) asset.started = false;
        if (time < clip.start || time >= clip.start + clip.duration) continue;
        const sourceTime = (clip.sourceIn || 0) + integrateClipSpeed(clip, localTime);
        const maxTime = clip.sourceOut === null ? Number.MAX_SAFE_INTEGER : clip.sourceOut;
        const targetTime = Math.max(0, Math.min(maxTime, sourceTime));
        try {
          if (Math.abs(video.currentTime - targetTime) > 0.04) {
            video.currentTime = targetTime;
            if (!asset.seekHandler) {
              asset.seekHandler = () => {
                if (previewing || !currentProject) return;
                const canvas = byId("media-preview-canvas");
                const ctx = canvas?.getContext("2d");
                if (ctx) drawTimelineFrame(ctx, canvas.width, canvas.height, currentProject, previewTimeMs);
              };
              video.addEventListener("seeked", asset.seekHandler);
            }
          }
        } catch { /* Some media sources cannot seek until metadata is ready. */ }
      }
    }
  }

  function activateTimelineClipAssets(elapsedMs) {
    if (!currentProject) return;
    const seconds = elapsedMs / 1000;
    const activeNow = new Set();
    for (const track of currentProject.tracks || []) {
      if (track.kind === "audio" || track.visible === false) continue;
      for (const clip of track.clips) {
        if (clip.assetType !== "video" || !clip.assetId) continue;
        const asset = timelineAssets.get(clip.id);
        const video = asset?.element;
        if (!video || seconds < clip.start || seconds >= clip.start + clip.duration) {
          if (video && activeTimelineClipIds.has(clip.id)) {
            video.pause();
            asset.started = false;
          }
          continue;
        }
        activeNow.add(clip.id);
        const localTime = seconds - clip.start;
        video.playbackRate = sampleClipSpeed(clip, localTime);
        if (!asset.started) {
          const sourceTime = (clip.sourceIn || 0) + integrateClipSpeed(clip, localTime);
          try { video.currentTime = clip.sourceOut === null ? sourceTime : Math.min(sourceTime, clip.sourceOut); }
          catch { /* metadata is not ready yet */ }
          asset.started = true;
          video.play().catch(() => {});
        }
        if (clip.sourceOut !== null && Number.isFinite(clip.sourceOut) && video.currentTime >= clip.sourceOut) {
          video.pause();
        }
      }
    }
    for (const id of activeTimelineClipIds) {
      if (!activeNow.has(id)) {
        const asset = timelineAssets.get(id);
        asset?.element?.pause?.();
        if (asset) asset.started = false;
      }
    }
    activeTimelineClipIds.clear();
    for (const id of activeNow) activeTimelineClipIds.add(id);
  }

  function keyedFrameForAsset(asset, width, height, key) {
    const element = asset?.element;
    if (!element) return null;
    const sourceWidth = element.videoWidth || element.naturalWidth || 0;
    const sourceHeight = element.videoHeight || element.naturalHeight || 0;
    if (!sourceWidth || !sourceHeight) return null;
    const maxWidth = Math.min(480, sourceWidth);
    const ratio = maxWidth / sourceWidth;
    const keyCanvas = asset.keyCanvas || document.createElement("canvas");
    asset.keyCanvas = keyCanvas;
    keyCanvas.width = Math.max(1, Math.round(sourceWidth * ratio));
    keyCanvas.height = Math.max(1, Math.round(sourceHeight * ratio));
    const keyContext = keyCanvas.getContext("2d", { willReadFrequently: true });
    if (!keyContext) return element;
    keyContext.clearRect(0, 0, keyCanvas.width, keyCanvas.height);
    keyContext.drawImage(element, 0, 0, keyCanvas.width, keyCanvas.height);
    try {
      const frame = keyContext.getImageData(0, 0, keyCanvas.width, keyCanvas.height);
      const data = frame.data;
      const hex = String(key.color || "#00ff00").replace("#", "");
      const kr = parseInt(hex.slice(0, 2), 16);
      const kg = parseInt(hex.slice(2, 4), 16);
      const kb = parseInt(hex.slice(4, 6), 16);
      const threshold = Math.max(6, Math.min(180, Number(key.similarity ?? 0.34) * 105));
      const softness = Math.max(1, Number(key.softness ?? 0.12) * 90);
      for (let index = 0; index < data.length; index += 4) {
        const dr = data[index] - kr;
        const dg = data[index + 1] - kg;
        const db = data[index + 2] - kb;
        const distance = Math.sqrt(dr * dr + dg * dg + db * db);
        const alpha = Math.max(0, Math.min(1, (distance - threshold) / softness));
        data[index + 3] = Math.round(data[index + 3] * alpha);
        if (alpha < 1 && kg > kr && kg > kb) {
          data[index + 1] = Math.min(data[index + 1], Math.round((data[index] + data[index + 2]) * 0.5 + 16));
        }
      }
      keyContext.putImageData(frame, 0, 0);
      return keyCanvas;
    } catch {
      return element;
    }
  }

  function applyTimelineMask(asset, source, mask) {
    if (!mask || mask.shape === "none") return source;
    const originalWidth = source.width || source.videoWidth || source.naturalWidth || 0;
    const originalHeight = source.height || source.videoHeight || source.naturalHeight || 0;
    if (!originalWidth || !originalHeight) return source;
    const scale = Math.min(1, 480 / originalWidth);
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const maskCanvas = asset.maskCanvas || document.createElement("canvas");
    asset.maskCanvas = maskCanvas;
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskContext = maskCanvas.getContext("2d");
    if (!maskContext) return source;
    maskContext.clearRect(0, 0, width, height);
    if (mask.invert) {
      maskContext.fillStyle = "#fff";
      maskContext.fillRect(0, 0, width, height);
      maskContext.globalCompositeOperation = "destination-out";
    }
    const centerX = width * (0.5 + Number(mask.x || 0) * 0.5);
    const centerY = height * (0.5 + Number(mask.y || 0) * 0.5);
    const maskWidth = width * Math.max(0.05, Math.min(2, Number(mask.width || 1)));
    const maskHeight = height * Math.max(0.05, Math.min(2, Number(mask.height || 1)));
    const left = centerX - maskWidth / 2;
    const top = centerY - maskHeight / 2;
    const featherPx = Math.max(0, Math.min(0.5, Number(mask.feather || 0))) * Math.min(width, height);
    maskContext.save();
    maskContext.fillStyle = "#fff";
    if (featherPx > 0) {
      maskContext.shadowColor = "#fff";
      maskContext.shadowBlur = featherPx;
    }
    maskContext.beginPath();
    if (mask.shape === "ellipse") {
      maskContext.ellipse(centerX, centerY, maskWidth / 2, maskHeight / 2, 0, 0, Math.PI * 2);
    } else if (mask.shape === "rounded" && typeof maskContext.roundRect === "function") {
      maskContext.roundRect(left, top, maskWidth, maskHeight, Math.min(maskWidth, maskHeight) * 0.12);
    } else {
      maskContext.rect(left, top, maskWidth, maskHeight);
    }
    maskContext.fill();
    maskContext.restore();
    maskContext.globalCompositeOperation = "source-over";

    const output = asset.compositeCanvas || document.createElement("canvas");
    asset.compositeCanvas = output;
    output.width = width;
    output.height = height;
    const outputContext = output.getContext("2d");
    if (!outputContext) return source;
    outputContext.clearRect(0, 0, width, height);
    outputContext.drawImage(source, 0, 0, width, height);
    outputContext.globalCompositeOperation = "destination-in";
    outputContext.drawImage(maskCanvas, 0, 0);
    outputContext.globalCompositeOperation = "source-over";
    return output;
  }

  function drawTimelineOverlays(ctx, width, height, project, elapsedMs) {
    const time = elapsedMs / 1000;
    for (const track of project.tracks || []) {
      if (track.kind === "audio" || track.visible === false) continue;
      for (const clip of track.clips) {
        if (!clip.visible || clip.assetType === "scene" || !clip.assetId) continue;
        if (time < clip.start || time >= clip.start + clip.duration) continue;
        const asset = timelineAssets.get(clip.id);
        if (!asset?.element || (asset.type === "video" && asset.element.readyState < 2)) continue;
        const element = asset.element;
        if (asset.type === "video" && clip.sourceOut !== null && Number.isFinite(clip.sourceOut) &&
            element.currentTime >= clip.sourceOut) continue;
        const sourceWidth = element.videoWidth || element.naturalWidth || 0;
        const sourceHeight = element.videoHeight || element.naturalHeight || 0;
        if (!sourceWidth || !sourceHeight) continue;
        const localTime = time - clip.start;
        const transform = sampleClipTransform(clip, localTime);
        const boxWidth = width * Math.max(0.1, Math.min(4, transform.scale));
        const boxHeight = height * Math.max(0.1, Math.min(4, transform.scale));
        const sourceRatio = sourceWidth / sourceHeight;
        const boxRatio = boxWidth / boxHeight;
        let drawWidth = boxWidth;
        let drawHeight = boxHeight;
        if ((clip.fit || "cover") === "contain") {
          if (sourceRatio > boxRatio) drawHeight = boxWidth / sourceRatio;
          else drawWidth = boxHeight * sourceRatio;
        } else if (sourceRatio > boxRatio) {
          drawWidth = boxHeight * sourceRatio;
        } else {
          drawHeight = boxWidth / sourceRatio;
        }
        let source = element;
        if (clip.chromaKey?.enabled) source = keyedFrameForAsset(asset, width, height, clip.chromaKey) || element;
        if (clip.mask?.shape && clip.mask.shape !== "none") source = applyTimelineMask(asset, source, clip.mask) || source;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity));
        ctx.translate(width * (0.5 + transform.x), height * (0.5 + transform.y));
        ctx.rotate(transform.rotation * Math.PI / 180);
        ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        ctx.restore();
      }
    }
  }

  function activateVideoForScene(sceneId) {
    if (activeVideoSceneId === sceneId) return;
    activeVideoSceneId = sceneId || null;
    for (const [id, asset] of sceneAssets.entries()) {
      if (asset.type !== "video") continue;
      if (id === sceneId) {
        try { asset.element.currentTime = 0; } catch { /* metadata may not be ready */ }
        asset.element.play().catch(() => {
          // A blocked local video remains visible as a still frame where available.
        });
      } else {
        asset.element.pause();
      }
    }
  }

  function pauseSceneVideos() {
    activeVideoSceneId = null;
    for (const asset of sceneAssets.values()) {
      if (asset.type === "video") asset.element.pause();
    }
  }

  function renderProjectList() {
    const target = byId("media-project-list");
    if (!target) return;
    target.replaceChildren();
    if (!projects.length) {
      target.append(makeElement("div", "empty-state", "No media projects yet. Create a storyboard above to begin."));
      return;
    }
    for (const project of projects) {
      const card = makeElement("article", "media-project-card");
      const heading = makeElement("div", "media-project-heading");
      const title = makeElement("strong", "", project.title);
      const badge = makeElement("span", "media-state " + (project.status === "approved" ? "approved" : "draft"), project.status);
      heading.append(title, badge);
      const meta = makeElement("p", "small muted", [
        project.formatLabel,
        project.platform,
        project.language,
        formatDurationLabel(project.durationSeconds),
        project.scenes.length + " scenes"
      ].join(" · "));
      const open = makeElement("button", "item-action", "Open storyboard");
      open.type = "button";
      open.addEventListener("click", () => selectProject(project.id));
      const remove = makeElement("button", "item-action media-delete", "Delete");
      remove.type = "button";
      remove.addEventListener("click", () => deleteProject(project.id));
      const actions = makeElement("div", "media-card-actions");
      actions.append(open, remove);
      card.append(heading, meta, actions);
      target.append(card);
    }
  }

  function moveScene(index, offset) {
    if (!currentProject || currentProject.status !== "draft") return;
    const destination = index + offset;
    if (destination < 0 || destination >= currentProject.scenes.length) return;
    [currentProject.scenes[index], currentProject.scenes[destination]] =
      [currentProject.scenes[destination], currentProject.scenes[index]];
    currentProject.scenes.forEach((scene, order) => { scene.order = order + 1; });
    reorderMainSceneClips(currentProject);
    renderSceneEditors();
    renderPreview(currentProject, destination);
  }

  function renderSceneEditors() {
    const target = byId("media-editor-scenes");
    if (!target || !currentProject) return;
    target.replaceChildren();
    currentProject.scenes.forEach((scene, index) => {
      const card = makeElement("article", "media-scene-editor");
      const heading = makeElement("div", "media-scene-heading");
      const duration = makeElement("label", "media-duration-field");
      heading.append(makeElement("strong", "", "Scene " + (index + 1)));
      duration.append(makeElement("span", "", "Seconds"));
      const durationInput = makeElement("input", "media-scene-input");
      durationInput.type = "number";
      durationInput.min = "3";
      durationInput.max = String(sceneDurationLimit(currentProject));
      durationInput.step = "1";
      durationInput.value = String(scene.durationSeconds);
      durationInput.dataset.field = "durationSeconds";
      durationInput.disabled = currentProject.format === "square-carousel";
      duration.append(durationInput);
      const moveControls = makeElement("div", "media-scene-order");
      const moveUp = makeElement("button", "item-action", "↑");
      moveUp.type = "button";
      moveUp.title = "Move scene up";
      moveUp.setAttribute("aria-label", "Move scene " + (index + 1) + " up");
      moveUp.disabled = currentProject.status !== "draft" || index === 0;
      moveUp.addEventListener("click", () => moveScene(index, -1));
      const moveDown = makeElement("button", "item-action", "↓");
      moveDown.type = "button";
      moveDown.title = "Move scene down";
      moveDown.setAttribute("aria-label", "Move scene " + (index + 1) + " down");
      moveDown.disabled = currentProject.status !== "draft" || index === currentProject.scenes.length - 1;
      moveDown.addEventListener("click", () => moveScene(index, 1));
      moveControls.append(moveUp, moveDown);
      heading.append(duration, moveControls);
      card.append(heading);
      card.append(makeField("Scene heading", scene.heading, "heading"));
      card.append(makeField("Voiceover script", scene.voiceover, "voiceover", "textarea"));
      card.append(makeField("On-screen text", scene.onScreenText, "onScreenText", "textarea"));
      card.append(makeField("Visual direction", scene.visualPrompt, "visualPrompt", "textarea"));
      card.append(makeSelectField("Visual type", scene.visualType || "auto", "visualType", VISUAL_CHOICES));
      card.append(makeSelectField("Stick-figure pose", scene.figurePose || "point", "figurePose", POSE_CHOICES));
      card.append(makeSelectField("Motion", scene.animation || "rise", "animation", ANIMATION_CHOICES));
      card.append(makeSelectField("Background", scene.background || "midnight", "background", BACKGROUND_CHOICES));
      card.append(makeSelectField("Transition into scene", scene.transition || "fade", "transition", TRANSITION_CHOICES));
      card.append(makeSelectField("Camera movement", scene.cameraMotion || "static", "cameraMotion", CAMERA_CHOICES));
      const grade = scene.grade || {};
      const gradePanel = makeElement("div", "media-grade-controls");
      gradePanel.append(makeElement("strong", "media-grade-title", "Colour grading"));
      gradePanel.append(makeRangeField("Brightness", grade.brightness ?? 100, "grade.brightness", 50, 150, 1, "%"));
      gradePanel.append(makeRangeField("Contrast", grade.contrast ?? 100, "grade.contrast", 50, 150, 1, "%"));
      gradePanel.append(makeRangeField("Saturation", grade.saturation ?? 100, "grade.saturation", 0, 180, 1, "%"));
      gradePanel.append(makeRangeField("Soft focus", grade.blur ?? 0, "grade.blur", 0, 12, 0.5, " px"));
      card.append(gradePanel);
      const assetField = makeElement("label", "media-field");
      assetField.append(makeElement("span", "", "Optional local image or video"));
      const assetInput = makeElement("input", "media-scene-input");
      assetInput.type = "file";
      assetInput.accept = "image/*,video/*";
      assetInput.disabled = currentProject.status !== "draft";
      assetInput.setAttribute("aria-label", "Choose a local image or video for scene " + (index + 1));
      assetInput.addEventListener("change", async (event) => {
        try { await setSceneAsset(scene, event.target.files?.[0] || null); }
        catch (error) {
          event.target.value = "";
          toast(error.message, true);
        }
      });
      const asset = sceneAssets.get(scene.id);
      assetField.append(assetInput, makeElement("span", "small muted", asset ? asset.name : "No file selected; this scene uses generated motion graphics."));
      if (asset) {
        const clearAsset = makeElement("button", "item-action media-remove-scene", "Remove local asset");
        clearAsset.type = "button";
        clearAsset.disabled = currentProject.status !== "draft";
        clearAsset.addEventListener("click", () => {
          disposeSceneAsset(scene.id);
          renderSceneEditors();
          renderPreview(currentProject, index);
        });
        assetField.append(clearAsset);
      }
      card.append(assetField);
      if (currentProject.status === "draft") {
        const remove = makeElement("button", "item-action media-remove-scene", "Remove scene");
        remove.type = "button";
        remove.disabled = currentProject.scenes.length <= MIN_SCENES;
        remove.addEventListener("click", () => {
          disposeSceneAsset(scene.id);
          currentProject.scenes.splice(index, 1);
          currentProject.scenes.forEach((item, order) => { item.order = order + 1; });
          syncSceneTimeline(currentProject);
          renderSceneEditors();
          renderPreview(currentProject, 0);
        });
        card.append(remove);
      } else {
        card.querySelectorAll("input, textarea, select, button").forEach((control) => { control.disabled = true; });
      }
      target.append(card);
    });
    const count = byId("media-scene-count");
    if (count) count.textContent = currentProject.scenes.length + " / " + MAX_SCENES + " scenes";
    const add = byId("media-add-scene");
    if (add) add.disabled = currentProject.status !== "draft" || currentProject.scenes.length >= MAX_SCENES;
    renderTimelineEditor();
  }

  function setEditorControls() {
    const editable = currentProject?.status === "draft";
    const approved = currentProject?.status === "approved";
    for (const id of ["media-editor-project-title", "media-editor-audience", "media-editor-visual-style", "media-editor-tone"]) {
      const element = byId(id);
      if (element) element.disabled = !editable;
    }
    for (const id of ["media-save-button", "media-approve-button", "media-add-scene"]) {
      const element = byId(id);
      if (element) element.disabled = !editable;
    }
    for (const id of ["media-export-json", "media-export-script", "media-export-captions", "media-export-webm", "media-export-png"]) {
      const element = byId(id);
      if (element) element.disabled = !approved || exporting;
    }
    const cancelButton = byId("media-export-cancel");
    if (cancelButton) cancelButton.disabled = !exporting;
    for (const id of ["media-audio-file", "media-music-file", "media-audio-volume", "media-music-volume"]) {
      const element = byId(id);
      if (element) element.disabled = exporting;
    }
    const exportButton = byId("media-export-webm");
    const hasTimelineAudio = Boolean(currentProject?.tracks?.some((track) =>
      track.kind === "audio" && track.muted !== true && track.clips.some((clip) => timelineAssets.has(clip.id))
    ));
    if (exportButton) exportButton.textContent = audioFile || musicFile || hasTimelineAudio
      ? "Export video + mixed audio" : "Export video (silent)";
    const timelineRoot = byId("media-timeline-tracks");
    if (timelineRoot) timelineRoot.querySelectorAll("input, select").forEach((control) => {
      control.disabled = !editable || exporting;
    });
    const timelineInspector = byId("media-timeline-inspector");
    if (timelineInspector) timelineInspector.querySelectorAll("input, select, button").forEach((control) => {
      control.disabled = !editable || exporting;
    });
    for (const id of ["media-timeline-add-video", "media-timeline-add-overlay", "media-timeline-add-audio"]) {
      const control = byId(id);
      if (control) control.disabled = !editable || exporting || (currentProject?.tracks?.length || 0) >= 8;
    }
    const status = byId("media-export-status");
    if (status) status.textContent = approved
      ? "Approved storyboard. Export files are generated locally in this browser."
      : "Approve the storyboard before exporting. Approval does not publish or upload anything.";
  }

  function selectProject(id) {
    const selected = projects.find((item) => item.id === id);
    if (!selected) return;
    stopPreview();
    if (selectedProjectId && selectedProjectId !== id) {
      releaseProjectAssets(selectedProjectId);
      setAudioTrack(null);
      setMusicTrack(null);
    }
    selectedProjectId = id;
    currentProject = structuredClone(selected);
    byId("media-editor").classList.remove("hidden");
    byId("media-editor-project-title").value = currentProject.title;
    byId("media-editor-audience").value = currentProject.audience || "";
    byId("media-editor-tone").value = currentProject.tone || "clear";
    byId("media-editor-visual-style").value = currentProject.visualStyle || "cinematic-motion";
    byId("media-editor-title").textContent = currentProject.title;
    byId("media-editor-meta").textContent = currentProject.formatLabel + " · " +
      currentProject.width + " × " + currentProject.height + " · " +
      formatDurationLabel(currentProject.durationSeconds) + " · " + currentProject.status;
    byId("media-generation-note").textContent = currentProject.generationNote || "";
    renderSceneEditors();
    renderTimelineEditor();
    renderPreview(currentProject, 0);
    setEditorControls();
    refreshAssetLibrary();
    restoreLibraryAssets(currentProject);
  }

  function wrapCanvasText(ctx, value, maxWidth, maxLines) {
    const words = String(value || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? line + " " + word : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const shortened = lines.slice(0, maxLines);
      shortened[maxLines - 1] = shortened[maxLines - 1].replace(/[.,;:!?]$/, "") + "…";
      return shortened;
    }
    return lines;
  }

  function drawStickFigure(ctx, width, height, scene, progress, opacity) {
    const unit = Math.min(width, height);
    const centerX = width > height ? width * 0.78 : width * 0.5;
    const groundY = height * 0.86;
    const animation = scene.animation || "rise";
    const pose = scene.figurePose || "point";
    const phase = progress * Math.PI * 2;
    const bob = animation === "bounce" ? Math.abs(Math.sin(phase * 2)) * unit * 0.018
      : animation === "rise" ? (1 - Math.min(1, progress * 2)) * unit * 0.06 : 0;
    const scale = animation === "bounce" ? 0.94 + Math.abs(Math.sin(phase * 2)) * 0.08 : 1;
    const torso = 0.29;
    const armLength = 0.23;
    const legLength = 0.28;
    let leftArm = 2.35;
    let rightArm = 0.78;
    let leftLeg = 1.92;
    let rightLeg = 1.22;
    if (pose === "walk" || animation === "walk") {
      const swing = Math.sin(phase) * 0.58;
      leftArm = 2.0 + swing;
      rightArm = 1.14 - swing;
      leftLeg = 1.55 + swing;
      rightLeg = 1.58 - swing;
    } else if (pose === "point") {
      rightArm = -0.62 + (animation === "gesture" ? Math.sin(phase) * 0.12 : 0);
      leftArm = 2.55;
    } else if (pose === "think") {
      rightArm = 3.88;
      leftArm = 2.45;
    } else if (pose === "celebrate") {
      leftArm = 4.05;
      rightArm = 5.38;
      leftLeg = 1.9;
      rightLeg = 1.25;
    }
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(centerX, groundY - bob);
    ctx.scale(unit * 0.72 * scale, unit * 0.72 * scale);
    ctx.strokeStyle = "#f7e6c7";
    ctx.fillStyle = "#f7e6c7";
    ctx.lineWidth = 0.018;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.ellipse(0, 0.008, 0.23, 0.025, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(2, 5, 12, 0.38)";
    ctx.fill();
    ctx.fillStyle = "#f7e6c7";
    ctx.beginPath();
    ctx.arc(0, -0.79, 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-0.028, -0.80, 0.008, 0, Math.PI * 2);
    ctx.arc(0.028, -0.80, 0.008, 0, Math.PI * 2);
    ctx.fillStyle = "#17202b";
    ctx.fill();
    ctx.strokeStyle = "#f7e6c7";
    ctx.beginPath();
    ctx.moveTo(0, -0.69);
    ctx.lineTo(0, -0.69 + torso);
    ctx.stroke();
    const shoulderY = -0.61;
    const hipY = -0.40;
    const drawLimb = (x, y, angle, length) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
    };
    drawLimb(0, shoulderY, leftArm, armLength);
    drawLimb(0, shoulderY, rightArm, armLength);
    drawLimb(0, hipY, leftLeg, legLength);
    drawLimb(0, hipY, rightLeg, legLength);
    ctx.restore();
  }

  function drawDiagram(ctx, width, height, scene, opacity) {
    const unit = Math.min(width, height);
    const y = height * 0.68;
    const boxWidth = Math.min(width * 0.31, unit * 0.38);
    const boxHeight = unit * 0.20;
    const left = width * 0.15;
    const right = width - left - boxWidth;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.lineWidth = Math.max(2, unit * 0.004);
    ctx.strokeStyle = "#f0cf9f";
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (const x of [left, right]) {
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y - boxHeight / 2, boxWidth, boxHeight, unit * 0.025);
      } else {
        ctx.rect(x, y - boxHeight / 2, boxWidth, boxHeight);
      }
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#f7e6c7";
    ctx.font = "600 " + Math.round(unit * 0.032) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("INPUT", left + boxWidth / 2, y + unit * 0.01);
    ctx.fillText("RESULT", right + boxWidth / 2, y + unit * 0.01);
    ctx.strokeStyle = "#e8c28f";
    ctx.beginPath();
    ctx.moveTo(left + boxWidth + unit * 0.035, y);
    ctx.lineTo(right - unit * 0.035, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(right - unit * 0.075, y - unit * 0.035);
    ctx.lineTo(right - unit * 0.035, y);
    ctx.lineTo(right - unit * 0.075, y + unit * 0.035);
    ctx.stroke();
    ctx.textAlign = "start";
    ctx.restore();
  }

  function drawScene(ctx, width, height, project, index, progress = 0, opacity = 1) {
    const scene = project.scenes[index];
    if (!scene) return;
    const palettes = {
      midnight: ["#07111f", "#172840", "#4b2e32"],
      sunset: ["#321b35", "#9a4d48", "#edac73"],
      paper: ["#f4ead8", "#d7c8b0", "#9d9a8e"],
      mint: ["#0e3435", "#27786c", "#b5bb8a"],
      violet: ["#211b47", "#55418c", "#b16b9d"]
    };
    const palette = palettes[scene.background] || palettes.midnight;
    ctx.save();
    ctx.globalAlpha = opacity;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette[0]);
    gradient.addColorStop(0.56, palette[1]);
    gradient.addColorStop(1, palette[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const p = Math.max(0, Math.min(1, progress));
    const motion = scene.cameraMotion || "static";
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    if (motion === "ken-burns") {
      zoom = 1.035 + p * 0.14;
      offsetX = -0.018 * p;
      offsetY = -0.012 * p;
    } else if (motion === "push-in") {
      zoom = 1 + p * 0.2;
    } else if (motion === "pull-out") {
      zoom = 1.2 - p * 0.2;
    } else if (motion === "pan-left") {
      zoom = 1.12;
      offsetX = 0.05 - p * 0.1;
    } else if (motion === "pan-right") {
      zoom = 1.12;
      offsetX = -0.05 + p * 0.1;
    } else if (motion === "drift-up") {
      zoom = 1.12;
      offsetY = 0.045 - p * 0.09;
    }
    ctx.save();
    ctx.translate(width / 2 + offsetX * width, height / 2 + offsetY * height);
    ctx.scale(zoom, zoom);
    ctx.translate(-width / 2, -height / 2);

    const grade = scene.grade || {};
    const brightness = Math.max(50, Math.min(150, Number(grade.brightness ?? 100)));
    const contrast = Math.max(50, Math.min(150, Number(grade.contrast ?? 100)));
    const saturation = Math.max(0, Math.min(180, Number(grade.saturation ?? 100)));
    const blur = Math.max(0, Math.min(12, Number(grade.blur ?? 0)));
    ctx.filter = "brightness(" + brightness + "%) contrast(" + contrast + "%) saturate(" +
      saturation + "%) blur(" + blur + "px)";

    const asset = sceneAssets.get(scene.id);
    const assetElement = asset?.element;
    const assetWidth = asset?.type === "video" ? assetElement?.videoWidth : assetElement?.naturalWidth;
    const assetHeight = asset?.type === "video" ? assetElement?.videoHeight : assetElement?.naturalHeight;
    if (assetWidth > 0 && assetHeight > 0) {
      const coverScale = Math.max(width / assetWidth, height / assetHeight);
      const drawWidth = assetWidth * coverScale;
      const drawHeight = assetHeight * coverScale;
      ctx.globalAlpha = opacity * 0.52;
      ctx.drawImage(assetElement, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      ctx.globalAlpha = opacity * 0.48;
      ctx.fillStyle = scene.background === "paper" ? "#f5ead6" : "#06101f";
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = opacity;
    }

    const unit = Math.min(width, height);
    const light = scene.background === "paper" ? "rgba(56,48,40,0.10)" : "rgba(255,255,255,0.14)";
    ctx.globalAlpha = opacity * 0.22;
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(width * (0.82 - progress * 0.06), height * 0.2, unit * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = opacity * 0.12;
    ctx.strokeStyle = scene.background === "paper" ? "#655d51" : "#f2d5a8";
    ctx.lineWidth = Math.max(2, unit * 0.003);
    for (let n = 1; n <= 4; n++) {
      ctx.beginPath();
      ctx.arc(width * 0.18, height * 0.76, unit * (0.08 + n * 0.035), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = opacity;

    const isPaper = scene.background === "paper";
    const foreground = isPaper ? "#263342" : "#f8f3eb";
    const accent = isPaper ? "#87613d" : "#e8c28f";
    const muted = isPaper ? "rgba(38,51,66,0.76)" : "rgba(248,243,235,0.82)";
    const visualType = scene.visualType === "auto"
      ? (project.visualStyle === "stick-figure-story" ? "stick-figure" : "diagram")
      : scene.visualType;
    const margin = width * 0.1;
    ctx.fillStyle = accent;
    ctx.font = "700 " + Math.round(unit * 0.021) + "px system-ui, sans-serif";
    ctx.fillText("JARVIS STUDIO", margin, height * 0.1);
    ctx.fillStyle = isPaper ? "rgba(38,51,66,0.58)" : "rgba(255,255,255,0.58)";
    ctx.font = "500 " + Math.round(unit * 0.018) + "px system-ui, sans-serif";
    ctx.fillText("SCENE " + (index + 1) + " / " + project.scenes.length, margin, height * 0.145);

    const titleWidth = visualType === "stick-figure" && width > height ? width * 0.56 : width - margin * 2;
    ctx.fillStyle = foreground;
    ctx.font = "700 " + Math.round(unit * (width > height ? 0.068 : 0.061)) + "px system-ui, sans-serif";
    const titleLines = wrapCanvasText(ctx, scene.onScreenText || scene.heading, titleWidth, width > height ? 3 : 4);
    const titleLineHeight = unit * 0.085;
    let y = visualType === "stick-figure" ? height * 0.34 : height * 0.39;
    for (const line of titleLines) {
      ctx.fillText(line, margin, y);
      y += titleLineHeight;
    }

    ctx.fillStyle = muted;
    ctx.font = "400 " + Math.round(unit * 0.026) + "px system-ui, sans-serif";
    const supporting = scene.voiceover || scene.visualPrompt;
    const supportLines = wrapCanvasText(ctx, supporting, titleWidth, width > height ? 4 : 4);
    y += unit * 0.025;
    for (const line of supportLines) {
      ctx.fillText(line, margin, y);
      y += unit * 0.041;
    }

    if (visualType === "stick-figure") {
      drawStickFigure(ctx, width, height, scene, progress, opacity);
    } else if (visualType === "diagram") {
      drawDiagram(ctx, width, height, scene, opacity);
    } else if (visualType === "quote") {
      ctx.globalAlpha = opacity * 0.28;
      ctx.fillStyle = accent;
      ctx.font = "700 " + Math.round(unit * 0.3) + "px Georgia, serif";
      ctx.fillText("“", margin, height * 0.78);
      ctx.globalAlpha = opacity;
    }

    const barY = height * 0.91;
    ctx.fillStyle = isPaper ? "rgba(38,51,66,0.18)" : "rgba(255,255,255,0.22)";
    ctx.fillRect(margin, barY, width - margin * 2, Math.max(4, unit * 0.006));
    ctx.fillStyle = accent;
    ctx.fillRect(margin, barY, (width - margin * 2) * Math.max(0, Math.min(1, progress)), Math.max(4, unit * 0.006));
    ctx.fillStyle = isPaper ? "rgba(38,51,66,0.62)" : "rgba(255,255,255,0.68)";
    ctx.font = "500 " + Math.round(unit * 0.016) + "px system-ui, sans-serif";
    ctx.fillText(project.title, margin, height * 0.955);
    ctx.restore(); // Restore the camera transform.
    ctx.restore(); // Restore the scene opacity and drawing state.
  }

  function sceneAtTime(project, elapsedMs) {
    const totalMs = Math.max(0, (project.durationSeconds || 0) * 1000);
    const bounded = Math.max(0, Math.min(totalMs, elapsedMs));
    const mainTrack = project.tracks?.find((track) => track.id === "track-main-video");
    if (mainTrack) {
      if (mainTrack.visible === false) return { index: -1, previousIndex: -1, sceneElapsedMs: 0, progress: 0, totalMs };
      const time = bounded / 1000;
      const clips = mainTrack.clips
        .filter((clip) => clip.sceneId && clip.visible !== false)
        .slice()
        .sort((a, b) => a.start - b.start);
      const activeIndex = clips.findIndex((clip) => time >= clip.start && time < clip.start + clip.duration);
      if (activeIndex < 0) return { index: -1, previousIndex: -1, sceneElapsedMs: 0, progress: 0, totalMs };
      const clip = clips[activeIndex];
      const index = project.scenes.findIndex((scene) => scene.id === clip.sceneId);
      if (index < 0) return { index: -1, previousIndex: -1, sceneElapsedMs: 0, progress: 0, totalMs };
      const scene = project.scenes[index];
      const localTime = Math.max(0, time - clip.start);
      const sourceTime = Math.max(0, Number(clip.sourceIn || 0) + integrateClipSpeed(clip, localTime));
      const sceneElapsedMs = Math.min(scene.durationSeconds * 1000, sourceTime * 1000);
      let previousIndex = -1;
      for (let cursor = activeIndex - 1; cursor >= 0; cursor--) {
        const previous = project.scenes.findIndex((item) => item.id === clips[cursor].sceneId);
        if (previous >= 0 && previous !== index) {
          previousIndex = previous;
          break;
        }
      }
      return {
        index,
        previousIndex,
        sceneElapsedMs,
        progress: Math.min(1, sceneElapsedMs / Math.max(1, scene.durationSeconds * 1000)),
        totalMs
      };
    }

    const sceneDurationMs = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds * 1000, 0);
    const legacyTime = Math.max(0, Math.min(sceneDurationMs, bounded));
    let cursor = 0;
    for (let index = 0; index < project.scenes.length; index++) {
      const durationMs = project.scenes[index].durationSeconds * 1000;
      if (legacyTime < cursor + durationMs || index === project.scenes.length - 1) {
        return {
          index,
          previousIndex: index - 1,
          sceneElapsedMs: Math.min(durationMs, Math.max(0, legacyTime - cursor)),
          progress: Math.min(1, Math.max(0, (legacyTime - cursor) / durationMs)),
          totalMs
        };
      }
      cursor += durationMs;
    }
    return { index: -1, previousIndex: -1, sceneElapsedMs: 0, progress: 0, totalMs };
  }

  function drawTimelineFrame(ctx, width, height, project, elapsedMs) {
    const frame = sceneAtTime(project, elapsedMs);
    const { index, previousIndex, sceneElapsedMs, progress } = frame;
    const scene = index >= 0 ? project.scenes[index] : null;
    const transitionMs = 650;
    const transitionProgress = Math.min(1, sceneElapsedMs / transitionMs);
    const transition = scene?.transition || "cut";
    ctx.clearRect(0, 0, width, height);
    if (!scene) {
      ctx.fillStyle = "#06101f";
      ctx.fillRect(0, 0, width, height);
    } else if (previousIndex < 0 || sceneElapsedMs >= transitionMs || transition === "cut") {
      drawScene(ctx, width, height, project, index, progress);
    } else if (transition === "fade") {
      drawScene(ctx, width, height, project, previousIndex, 1, 1 - transitionProgress);
      drawScene(ctx, width, height, project, index, progress, transitionProgress);
    } else if (transition === "slide") {
      ctx.save();
      ctx.translate(-width * transitionProgress, 0);
      drawScene(ctx, width, height, project, previousIndex, 1);
      ctx.restore();
      ctx.save();
      ctx.translate(width * (1 - transitionProgress), 0);
      drawScene(ctx, width, height, project, index, progress);
      ctx.restore();
    } else if (transition === "wipe") {
      drawScene(ctx, width, height, project, previousIndex, 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width * transitionProgress, height);
      ctx.clip();
      drawScene(ctx, width, height, project, index, progress);
      ctx.restore();
    } else if (transition === "zoom") {
      drawScene(ctx, width, height, project, previousIndex, 1);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(0.88 + transitionProgress * 0.12, 0.88 + transitionProgress * 0.12);
      ctx.translate(-width / 2, -height / 2);
      drawScene(ctx, width, height, project, index, progress);
      ctx.restore();
    } else {
      drawScene(ctx, width, height, project, index, progress);
    }
    drawTimelineOverlays(ctx, width, height, project, elapsedMs);
  }

  function renderPreviewAtTime(elapsedMs) {
    const canvas = byId("media-preview-canvas");
    if (!canvas || !currentProject?.scenes?.length) return;
    previewTimeMs = Math.max(0, Math.min(currentProject.durationSeconds * 1000, elapsedMs));
    seekTimelineAssets(previewTimeMs);
    const playhead = byId("media-timeline-playhead");
    const playheadValue = byId("media-timeline-playhead-value");
    if (playhead) {
      playhead.max = String(Math.max(0.25, currentProject.durationSeconds || 1));
      playhead.value = String(previewTimeMs / 1000);
    }
    if (playheadValue) playheadValue.textContent = (previewTimeMs / 1000).toFixed(2) + "s";
    const size = FORMATS[currentProject.format] || FORMATS["vertical-short"];
    canvas.width = Math.min(size.width, 960);
    canvas.height = Math.round(canvas.width * size.height / size.width);
    if (canvas.height > 960) {
      canvas.height = 960;
      canvas.width = Math.round(canvas.height * size.width / size.height);
    }
    const ctx = canvas.getContext("2d");
    if (ctx) drawTimelineFrame(ctx, canvas.width, canvas.height, currentProject, Math.max(0, elapsedMs));
  }

  function renderPreview(project, index = 0) {
    const scene = project.scenes[index];
    const main = project.tracks?.find((track) => track.id === "track-main-video");
    const clip = main?.clips.find((item) => item.sceneId === scene?.id);
    renderPreviewAtTime(clip ? clip.start * 1000 + 1 : 0);
  }

  async function startTimelinePreviewAudio(offsetMs) {
    const audioTracks = (currentProject?.tracks || []).filter((track) => track.kind === "audio" && track.visible !== false && track.muted !== true);
    const clips = audioTracks.flatMap((track) => track.clips
      .filter((clip) => clip.visible !== false && clip.muted !== true && clip.assetType === "audio" && timelineAssets.get(clip.id)?.file)
      .map((clip) => ({ clip, track })));
    const hasGlobalAudio = Boolean(audioFile || musicFile);
    if (!clips.length && !hasGlobalAudio) return 0;
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return 0;
    const context = new AudioContextType();
    previewAudioContext = context;
    previewAudioSources = [];
    await context.resume();
    const loadBuffer = async (file) => {
      let buffer = previewAudioBuffers.get(file);
      if (!buffer) {
        buffer = await context.decodeAudioData(await file.arrayBuffer());
        previewAudioBuffers.set(file, buffer);
      }
      return buffer;
    };
    const filesToDecode = [...new Set([
      ...clips.map(({ clip }) => timelineAssets.get(clip.id)?.file),
      audioFile,
      musicFile
    ].filter(Boolean))];
    await Promise.all(filesToDecode.map(loadBuffer));
    if (!previewing || previewAudioContext !== context || context.state === "closed") return 0;
    const timelineStart = Math.max(0, offsetMs / 1000);
    const scheduleAt = context.currentTime + 0.06;
    const scheduleFile = async (file, startAt, offset, options = {}) => {
      const buffer = await loadBuffer(file);
      if (!previewing || previewAudioContext !== context || context.state === "closed") return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = options.loop === true;
      const gain = context.createGain();
      gain.gain.value = Math.max(0, Math.min(1.5, Number(options.volume ?? 1)));
      source.connect(gain);
      gain.connect(context.destination);
      if (options.rampClip) {
        const clip = options.rampClip;
        const localStart = options.localStart || 0;
        source.playbackRate.setValueAtTime(sampleClipSpeed(clip, localStart), startAt);
        const steps = Math.max(1, Math.ceil((clip.duration - localStart) * 20));
        for (let step = 1; step <= steps; step++) {
          const localTime = localStart + (clip.duration - localStart) * step / steps;
          source.playbackRate.setValueAtTime(sampleClipSpeed(clip, localTime), startAt + (localTime - localStart));
        }
      }
      if (options.endAt !== undefined) source.stop(options.endAt);
      source.start(startAt, Math.max(0, Math.min(Math.max(0, buffer.duration - 0.01), offset)));
      previewAudioSources.push(source);
    };

    for (const { clip } of clips) {
      const clipEnd = clip.start + clip.duration;
      if (timelineStart >= clipEnd) continue;
      const localStart = Math.max(0, timelineStart - clip.start);
      const delay = Math.max(0, clip.start - timelineStart);
      const startAt = scheduleAt + delay;
      const sourceTime = Math.max(0, Number(clip.sourceIn || 0) + integrateClipSpeed(clip, localStart));
      const availableEnd = clip.sourceOut === null ? undefined : Number(clip.sourceOut);
      const clipEndAt = scheduleAt + delay + (clip.duration - localStart);
      await scheduleFile(timelineAssets.get(clip.id).file, startAt, sourceTime, {
        volume: clip.volume ?? 1,
        rampClip: clip,
        localStart,
        endAt: clipEndAt
      });
      if (!previewing || previewAudioContext !== context) return;
      if (availableEnd !== undefined && availableEnd <= sourceTime) continue;
    }
    if (audioFile) {
      const buffer = await loadBuffer(audioFile);
      if (previewing && previewAudioContext === context && timelineStart < buffer.duration) {
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = Math.max(0, Math.min(1.5, Number(byId("media-audio-volume")?.value ?? 1)));
        source.connect(gain);
        gain.connect(context.destination);
        source.start(scheduleAt, timelineStart);
        previewAudioSources.push(source);
      }
    }
    if (musicFile) {
      const buffer = await loadBuffer(musicFile);
      if (previewing && previewAudioContext === context && buffer.duration > 0) {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = context.createGain();
        const requested = Math.max(0, Math.min(1.5, Number(byId("media-music-volume")?.value ?? 0.65)));
        gain.gain.value = requested * (audioFile ? 0.32 : 1);
        source.connect(gain);
        gain.connect(context.destination);
        source.start(scheduleAt, timelineStart % buffer.duration);
        previewAudioSources.push(source);
      }
    }
    return 60;
  }

  function stopPreview() {
    previewing = false;
    pauseSceneVideos();
    for (const source of previewAudioSources) {
      try { source.stop(); } catch { /* source may already have ended */ }
    }
    previewAudioSources = [];
    if (previewAudioContext && previewAudioContext.state !== "closed") {
      const context = previewAudioContext;
      previewAudioContext = null;
      context.close().catch(() => {});
    }
    for (const id of activeTimelineClipIds) {
      const asset = timelineAssets.get(id);
      asset?.element?.pause?.();
      if (asset) asset.started = false;
    }
    activeTimelineClipIds.clear();
    if (previewFrame) cancelAnimationFrame(previewFrame);
    previewFrame = 0;
    const button = byId("media-preview-button");
    if (button) button.textContent = "Preview storyboard";
  }

  async function playPreview() {
    if (!currentProject) return;
    if (previewing) {
      stopPreview();
      return;
    }
    previewing = true;
    const totalMs = Math.max(1, currentProject.durationSeconds * 1000);
    previewTimeMs = previewTimeMs >= totalMs ? 0 : previewTimeMs;
    byId("media-preview-button").textContent = "Stop preview";
    let audioLeadMs = 0;
    try { audioLeadMs = await startTimelinePreviewAudio(previewTimeMs) || 0; }
    catch (error) { setExportStatus("Timeline audio preview could not start: " + error.message, true); }
    if (!previewing) return;
    previewStartedAt = performance.now() + audioLeadMs - previewTimeMs;
    const tick = (now) => {
      if (!previewing || !currentProject) return;
      const elapsed = (now - previewStartedAt) % totalMs;
      previewTimeMs = elapsed;
      if (now - lastPlayheadUpdate > 100) {
        const playhead = byId("media-timeline-playhead");
        const value = byId("media-timeline-playhead-value");
        if (playhead) playhead.value = String(elapsed / 1000);
        if (value) value.textContent = (elapsed / 1000).toFixed(2) + "s";
        lastPlayheadUpdate = now;
      }
      const current = sceneAtTime(currentProject, elapsed);
      activateVideoForScene(currentProject.scenes[current.index]?.id);
      activateTimelineClipAssets(elapsed);
      const canvas = byId("media-preview-canvas");
      const ctx = canvas?.getContext("2d");
      if (ctx) drawTimelineFrame(ctx, canvas.width, canvas.height, currentProject, elapsed);
      previewFrame = requestAnimationFrame(tick);
    };
    previewFrame = requestAnimationFrame(tick);
  }

  function readSceneEditors() {
    const cards = [...byId("media-editor-scenes").querySelectorAll(".media-scene-editor")];
    return cards.map((card, index) => {
      const value = (field) => card.querySelector('[data-field="' + field + '"]')?.value || "";
      return {
        ...currentProject.scenes[index],
        heading: value("heading"),
        voiceover: value("voiceover"),
        onScreenText: value("onScreenText"),
        visualPrompt: value("visualPrompt"),
        visualType: value("visualType"),
        figurePose: value("figurePose"),
        animation: value("animation"),
        background: value("background"),
        transition: value("transition"),
        cameraMotion: value("cameraMotion"),
        grade: {
          brightness: Number(value("grade.brightness")),
          contrast: Number(value("grade.contrast")),
          saturation: Number(value("grade.saturation")),
          blur: Number(value("grade.blur"))
        },
        durationSeconds: Number(value("durationSeconds"))
      };
    });
  }

  async function refresh() {
    const data = await api("/api/media/projects");
    projects = Array.isArray(data.projects) ? data.projects : [];
    renderProjectList();
    if (currentProject) {
      const refreshed = projects.find((item) => item.id === currentProject.id);
      if (refreshed) selectProject(refreshed.id);
      else {
        releaseProjectAssets(currentProject.id);
        currentProject = null;
        selectedProjectId = null;
        setAudioTrack(null);
        setMusicTrack(null);
        byId("media-editor").classList.add("hidden");
      }
    }
  }

  async function saveProject() {
    if (!currentProject || currentProject.status !== "draft") return;
    const payload = {
      title: byId("media-editor-project-title").value,
      audience: byId("media-editor-audience").value,
      tone: byId("media-editor-tone").value,
      visualStyle: byId("media-editor-visual-style").value,
      scenes: readSceneEditors(),
      tracks: currentProject.tracks
    };
    syncSceneTimeline(currentProject);
    currentProject.tracks = structuredClone(currentProject.tracks);
    const result = await api("/api/media/projects/" + encodeURIComponent(currentProject.id), {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    currentProject = result.project;
    projects = projects.map((item) => item.id === currentProject.id ? currentProject : item);
    renderProjectList();
    selectProject(currentProject.id);
    toast("Storyboard changes saved.");
  }

  async function approveProject() {
    if (!currentProject || currentProject.status !== "draft") return;
    await saveProject();
    const result = await api("/api/media/projects/" + encodeURIComponent(currentProject.id) + "/approve", {
      method: "POST",
      body: JSON.stringify({})
    });
    currentProject = result.project;
    projects = projects.map((item) => item.id === currentProject.id ? currentProject : item);
    renderProjectList();
    selectProject(currentProject.id);
    toast("Storyboard approved. Export is now enabled; nothing was published.");
  }

  async function deleteProject(id) {
    if (!window.confirm("Delete this media project from your JARVIS workspace?")) return;
    await api("/api/media/projects/" + encodeURIComponent(id), { method: "DELETE" });
    projects = projects.filter((item) => item.id !== id);
    releaseProjectAssets(id);
    if (currentProject?.id === id) {
      currentProject = null;
      selectedProjectId = null;
      setAudioTrack(null);
      byId("media-editor").classList.add("hidden");
      stopPreview();
    }
    renderProjectList();
    toast("Media project deleted.");
  }

  function buildSrt(project) {
    let cursor = 0;
    const time = (seconds) => {
      const total = Math.round(seconds * 1000);
      const hours = Math.floor(total / 3600000);
      const minutes = Math.floor((total % 3600000) / 60000);
      const secs = Math.floor((total % 60000) / 1000);
      const millis = total % 1000;
      return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":") +
        "," + String(millis).padStart(3, "0");
    };
    return project.scenes.map((scene, index) => {
      const start = cursor;
      cursor += scene.durationSeconds;
      return (index + 1) + "\n" + time(start) + " --> " + time(cursor) + "\n" +
        (scene.voiceover || scene.onScreenText).replace(/\s+/g, " ").trim() + "\n";
    }).join("\n");
  }

  function approvedProject() {
    if (!currentProject || currentProject.status !== "approved") {
      throw new Error("Approve the storyboard before exporting.");
    }
    return currentProject;
  }

  function exportProjectJson() {
    const project = approvedProject();
    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      project,
      localAssetManifest: project.scenes.map((scene) => {
        const asset = sceneAssets.get(scene.id);
        return asset ? { sceneId: scene.id, fileName: asset.name, type: asset.type } : null;
      }).filter(Boolean),
      audioTrack: audioFile ? { fileName: audioFile.name, sizeBytes: audioFile.size } : null,
      exportNotes: {
        video: "The local browser renderer exports the storyboard as a video file when MediaRecorder supports MP4 or WebM.",
        audio: "A user-selected local audio file may be mixed into the video export. Audio files are not uploaded to the JARVIS server.",
        assets: "Scene image/video files are selected locally and embedded into the video export. The project JSON contains only an asset manifest, not the file bytes. Use assets you own or have permission to use."
      }
    };
    downloadText(cleanFileName(project.title) + "-project.json", JSON.stringify(bundle, null, 2), "application/json");
  }

  function exportScript() {
    const project = approvedProject();
    const sections = [
      project.title,
      "Format: " + project.formatLabel,
      "Platform: " + project.platform,
      "Language: " + project.language,
      "Estimated duration: " + project.durationSeconds + " seconds",
      ""
    ];
    project.scenes.forEach((scene, index) => {
      sections.push("SCENE " + (index + 1) + " — " + scene.heading);
      sections.push("ON SCREEN: " + scene.onScreenText);
      sections.push("VOICEOVER: " + scene.voiceover);
      sections.push("VISUAL DIRECTION: " + scene.visualPrompt);
      sections.push("");
    });
    sections.push("Review note: Verify factual claims and asset rights before publishing.");
    downloadText(cleanFileName(project.title) + "-script.txt", sections.join("\n"), "text/plain;charset=utf-8");
  }

  function exportCaptions() {
    const project = approvedProject();
    downloadText(cleanFileName(project.title) + ".srt", buildSrt(project), "application/x-subrip;charset=utf-8");
  }

  async function exportSlides() {
    const project = approvedProject();
    setExportBusy(true, "Rendering slide images…");
    try {
      const size = FORMATS[project.format] || FORMATS["vertical-short"];
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx || typeof canvas.toBlob !== "function") throw new Error("This browser cannot export slide images.");
      for (let index = 0; index < project.scenes.length; index++) {
        drawScene(ctx, canvas.width, canvas.height, project, index, 1);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("The browser could not create a slide image.");
        downloadBlob(cleanFileName(project.title) + "-scene-" + String(index + 1).padStart(2, "0") + ".png", blob);
      }
      setExportStatus("Slide images exported. Your browser may ask where to save multiple files.");
    } catch (error) {
      setExportStatus(error.message, true);
    } finally {
      setExportBusy(false);
    }
  }

  function setExportStatus(message, isError = false) {
    const target = byId("media-export-status");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("error-text", isError);
  }

  function setExportBusy(value, message) {
    exporting = value;
    if (message) setExportStatus(message);
    setEditorControls();
  }

  async function exportWebm() {
    const project = approvedProject();
    if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
      throw new Error("Video export is not supported by this browser. Export the storyboard, script, captions or scene PNGs instead.");
    }
    const size = FORMATS[project.format] || FORMATS["vertical-short"];
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(size.width, project.format === "long-form" ? 1280 : 720);
    canvas.height = Math.round(canvas.width * size.height / size.width);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The browser could not create a video canvas.");

    let audioContext = null;
    const audioSources = [];
    const scheduledAudioSources = new Set();
    let audioDestination = null;
    let canvasStream = null;
    let stream = null;
    let animation = 0;
    let recorder = null;
    const totalMs = Math.max(1, project.durationSeconds * 1000);
    const chunks = [];
    const timelineAudioClips = (project.tracks || []).filter((track) => track.kind === "audio" && track.visible !== false && track.muted !== true)
      .flatMap((track) => track.clips.filter((clip) => !clip.muted && clip.visible !== false && clip.assetType === "audio" && timelineAssets.get(clip.id)?.file));
    const hasAudio = Boolean(audioFile || musicFile || timelineAudioClips.length);

    cancelExportRequested = false;
    const longForm = project.durationSeconds > 180;
    setExportBusy(true, longForm
      ? "Long-form export may take up to the video duration in real time. Use a desktop browser, keep this tab open and in the foreground, and do not close the page. Imported media remains local."
      : hasAudio
        ? "Preparing voiceover and background music, then rendering locally. Keep this tab open until export finishes."
        : "Rendering motion graphics without audio. Add voiceover or background music to create a mixed soundtrack.");

    try {
      canvasStream = canvas.captureStream(20);
      let audioTracks = [];
      if (hasAudio) {
        const AudioContextType = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextType || typeof MediaStream === "undefined") {
          throw new Error("This browser cannot mix local audio tracks into video. Remove the audio tracks and export silent motion graphics.");
        }
        audioContext = new AudioContextType();
        await audioContext.resume();
        audioDestination = audioContext.createMediaStreamDestination();
        const sources = [
          { file: audioFile, volumeId: "media-audio-volume", loop: false, role: "voiceover" },
          { file: musicFile, volumeId: "media-music-volume", loop: true, role: "music" }
        ].filter((track) => track.file);
        for (const track of sources) {
          const decoded = await audioContext.decodeAudioData(await track.file.arrayBuffer());
          const source = audioContext.createBufferSource();
          source.buffer = decoded;
          source.loop = track.loop;
          const gain = audioContext.createGain();
          const control = byId(track.volumeId);
          const requestedVolume = Math.max(0, Math.min(1.5, Number(control?.value ?? 1)));
          // Keep background music under narration without requiring a separate side-chain compressor.
          const effectiveVolume = track.role === "music" && audioFile ? requestedVolume * 0.32 : requestedVolume;
          gain.gain.value = effectiveVolume;
          source.connect(gain);
          gain.connect(audioDestination);
          audioSources.push(source);
        }

        for (const clip of timelineAudioClips) {
          const asset = timelineAssets.get(clip.id);
          if (!asset?.file) continue;
          const decoded = await audioContext.decodeAudioData(await asset.file.arrayBuffer());
          const source = audioContext.createBufferSource();
          source.buffer = decoded;
          const gain = audioContext.createGain();
          gain.gain.value = Math.max(0, Math.min(1.5, Number(clip.volume ?? 1)));
          source.connect(gain);
          gain.connect(audioDestination);
          const startAt = audioContext.currentTime + 0.2 + Math.max(0, clip.start);
          const initialRate = sampleClipSpeed(clip, 0);
          source.playbackRate.setValueAtTime(initialRate, startAt);
          const sampleCount = Math.max(2, Math.ceil(clip.duration * 12));
          for (let index = 1; index <= sampleCount; index++) {
            const localTime = clip.duration * index / sampleCount;
            source.playbackRate.setValueAtTime(sampleClipSpeed(clip, localTime), startAt + localTime);
          }
          const sourceOffset = Math.max(0, Number(clip.sourceIn || 0));
          const availableSourceDuration = clip.sourceOut === null
            ? Math.max(0.05, decoded.duration - sourceOffset)
            : Math.max(0.05, Number(clip.sourceOut) - sourceOffset);
          source.start(startAt, sourceOffset, availableSourceDuration);
          source.stop(startAt + Math.max(0.05, clip.duration));
          audioSources.push(source);
          scheduledAudioSources.add(source);
        }
        audioTracks = audioDestination.stream.getAudioTracks();
      }
      stream = typeof MediaStream !== "undefined"
        ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
        : canvasStream;
      const mediaTypes = hasAudio
        ? [
            { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: ".mp4" },
            { mime: "video/webm;codecs=vp9,opus", extension: ".webm" },
            { mime: "video/webm;codecs=vp8,opus", extension: ".webm" },
            { mime: "video/webm", extension: ".webm" }
          ]
        : [
            { mime: "video/mp4;codecs=avc1.42E01E", extension: ".mp4" },
            { mime: "video/webm;codecs=vp9", extension: ".webm" },
            { mime: "video/webm;codecs=vp8", extension: ".webm" },
            { mime: "video/webm", extension: ".webm" }
          ];
      const selectedType = typeof MediaRecorder.isTypeSupported === "function"
        ? mediaTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate.mime))
        : null;
      const mimeType = selectedType?.mime;
      const extension = selectedType?.extension || ".webm";
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      const finished = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data?.size) chunks.push(event.data);
        });
        recorder.addEventListener("error", () => reject(new Error("The browser stopped the video export unexpectedly.")), { once: true });
        recorder.addEventListener("stop", () => {
          resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
        }, { once: true });
      });

      activateVideoForScene(project.scenes[0]?.id);
      const startedAt = performance.now();
      recorder.start(500);
      for (const source of audioSources) {
        if (!scheduledAudioSources.has(source)) source.start();
      }
      const renderResult = await new Promise((resolve) => {
        const frame = (now) => {
          if (cancelExportRequested) {
            if (recorder?.state !== "inactive") recorder.stop();
            resolve({ cancelled: true });
            return;
          }
          const elapsed = Math.min(totalMs, now - startedAt);
          drawTimelineFrame(ctx, canvas.width, canvas.height, project, elapsed);
          const current = sceneAtTime(project, elapsed);
          activateVideoForScene(project.scenes[current.index]?.id);
          activateTimelineClipAssets(elapsed);
          setExportStatus("Rendering scene " + Math.max(0, current.index + 1) + " of " + project.scenes.length +
            " · " + formatDurationLabel(elapsed / 1000) + " / " + formatDurationLabel(project.durationSeconds) +
            (hasAudio ? " · voiceover/music mixed locally" : " · no audio track") + "…");
          if (elapsed >= totalMs) {
            if (recorder?.state !== "inactive") recorder.stop();
            resolve({ cancelled: false });
            return;
          }
          animation = requestAnimationFrame(frame);
        };
        animation = requestAnimationFrame(frame);
      });
      if (renderResult.cancelled) {
        try { await finished; } catch { /* cancellation still reports a cancelled export */ }
        throw new Error("Video export cancelled. No file was downloaded.");
      }
      const blob = await finished;
      const suffix = hasAudio ? "-mixed-audio" + extension : extension;
      downloadBlob(cleanFileName(project.title) + suffix, blob);
      setExportStatus("Video export finished as " + extension.slice(1).toUpperCase() +
        (hasAudio ? " with the selected local audio mix." : " without audio.") +
        " Preview the downloaded file before using it.");
    } finally {
      if (animation) cancelAnimationFrame(animation);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      pauseSceneVideos();
      for (const id of activeTimelineClipIds) {
        const asset = timelineAssets.get(id);
        asset?.element?.pause?.();
        if (asset) asset.started = false;
      }
      activeTimelineClipIds.clear();
      for (const mediaStream of [stream, canvasStream, audioDestination?.stream]) {
        mediaStream?.getTracks().forEach((track) => track.stop());
      }
      for (const source of audioSources) {
        try { source.stop(); } catch { /* source may already have ended */ }
      }
      if (audioContext && audioContext.state !== "closed") await audioContext.close().catch(() => {});
      setExportBusy(false);
    }
  }

  function setAudioTrack(file) {
    const preview = byId("media-audio-preview");
    if (audioObjectUrl) {
      URL.revokeObjectURL(audioObjectUrl);
      audioObjectUrl = null;
    }
    audioFile = null;
    if (!file) {
      preview?.pause();
      if (preview) {
        preview.removeAttribute("src");
        preview.classList.add("hidden");
        preview.load();
      }
      setExportStatus(musicFile
        ? "Background music remains selected. Add a voiceover to create a layered mix."
        : "No audio tracks selected. The next video export will be silent.");
      setEditorControls();
      return;
    }
    if (!String(file.type || "").toLowerCase().startsWith("audio/")) {
      throw new Error("Choose an audio file such as MP3, WAV, M4A or OGG.");
    }
    if (file.size > 60 * 1024 * 1024) {
      throw new Error("Audio files must be 60 MiB or smaller for in-browser export.");
    }
    audioFile = file;
    audioObjectUrl = URL.createObjectURL(file);
    if (preview) {
      preview.src = audioObjectUrl;
      preview.classList.remove("hidden");
      preview.load();
    }
    setExportStatus("Local audio selected: " + file.name + ". It will be mixed into the next WebM export on this device.");
    setEditorControls();
  }

  function setMusicTrack(file) {
    const preview = byId("media-music-preview");
    if (musicObjectUrl) {
      URL.revokeObjectURL(musicObjectUrl);
      musicObjectUrl = null;
    }
    musicFile = null;
    if (!file) {
      preview?.pause();
      if (preview) {
        preview.removeAttribute("src");
        preview.classList.add("hidden");
        preview.load();
      }
      setExportStatus(audioFile
        ? "Voiceover track ready. Add background music for a layered audio mix."
        : "No audio tracks selected. The next video export will be silent.");
      setEditorControls();
      return;
    }
    if (!String(file.type || "").toLowerCase().startsWith("audio/")) {
      throw new Error("Choose an audio file such as MP3, WAV, M4A or OGG for background music.");
    }
    if (file.size > 60 * 1024 * 1024) {
      throw new Error("Music files must be 60 MiB or smaller for in-browser export.");
    }
    musicFile = file;
    musicObjectUrl = URL.createObjectURL(file);
    if (preview) {
      preview.src = musicObjectUrl;
      preview.classList.remove("hidden");
      preview.load();
    }
    setExportStatus("Local background music selected: " + file.name + ". It loops to the video duration and is mixed locally.");
    setEditorControls();
  }

  async function createFromPrompt(message, intent) {
    if (!intent || !intent.brief) throw new Error("Describe the video or animation you want to make.");
    await refresh();
    const result = await api("/api/media/drafts", {
      method: "POST",
      body: JSON.stringify({
        title: intent.title,
        brief: intent.brief,
        format: intent.format,
        platform: intent.platform,
        language: intent.language,
        tone: intent.tone,
        audience: intent.audience,
        visualStyle: intent.visualStyle
      })
    });
    projects.unshift(result.project);
    renderProjectList();
    selectProject(result.project.id);
    setStatus("Created a private draft from your instruction. Review each scene, adjust its motion and audio, then approve it before export.");
    return result.project;
  }

  function addScene() {
    if (!currentProject || currentProject.status !== "draft") return;
    if (currentProject.scenes.length >= MAX_SCENES) return;
    if (projectDurationLimit(currentProject) - currentProject.durationSeconds < 3) {
      toast("This project has reached its maximum duration. Shorten another scene or clip first.", true);
      return;
    }
    currentProject.scenes.push({
      id: "local-" + Date.now(),
      heading: "New scene",
      voiceover: "Add your narration for this scene.",
      onScreenText: "New idea",
      visualPrompt: "Describe a simple visual that supports the narration.",
      durationSeconds: Math.min(currentProject.format === "long-form" ? 40 : 8, sceneDurationLimit(currentProject), projectDurationLimit(currentProject) - currentProject.durationSeconds),
      visualType: byId("media-editor-visual-style").value === "stick-figure-story" ? "stick-figure" : "auto",
      figurePose: "walk",
      animation: "walk",
      background: "midnight",
      transition: "fade",
      order: currentProject.scenes.length + 1
    });
    addSceneTimelineClip(currentProject, currentProject.scenes[currentProject.scenes.length - 1]);
    renderSceneEditors();
    renderTimelineEditor();
    renderPreview(currentProject, currentProject.scenes.length - 1);
  }

  function initialize() {
    if (initialized) return;
    initialized = true;

    byId("media-asset-library-file")?.addEventListener("change", (event) => {
      pendingAssetLibraryFile = event.target.files?.[0] || null;
      if (pendingAssetLibraryFile) {
        setAssetLibraryStatus("Ready to save " + pendingAssetLibraryFile.name + ". Add optional tags, then press Save to library.");
      }
    });
    byId("media-asset-library-save")?.addEventListener("click", savePendingAssetToLibrary);
    byId("media-asset-library-search")?.addEventListener("input", refreshAssetLibrary);
    byId("media-asset-library-kind")?.addEventListener("change", refreshAssetLibrary);
    byId("media-asset-library-tag-filter")?.addEventListener("input", refreshAssetLibrary);

    byId("media-create-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = byId("media-create-submit");
      button.disabled = true;
      setStatus("Preparing your storyboard…");
      try {
        const payload = {
          title: byId("media-title").value,
          brief: byId("media-brief").value,
          format: byId("media-format").value,
          platform: byId("media-platform").value,
          language: byId("media-language").value,
          tone: byId("media-tone").value,
          audience: byId("media-audience").value,
          visualStyle: byId("media-visual-style").value
        };
        const result = await api("/api/media/drafts", { method: "POST", body: JSON.stringify(payload) });
        projects.unshift(result.project);
        renderProjectList();
        byId("media-create-form").reset();
        setStatus("Storyboard created. Open it below to edit, review and approve.");
        selectProject(result.project.id);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });

    const updateSceneField = (event) => {
      const field = event.target?.dataset?.field;
      const card = event.target?.closest?.(".media-scene-editor");
      if (!field || !card || !currentProject) return;
      const cards = [...byId("media-editor-scenes").querySelectorAll(".media-scene-editor")];
      const index = cards.indexOf(card);
      if (index < 0 || !currentProject.scenes[index]) return;
      if (field === "durationSeconds") {
        const boundedDuration = Math.max(3, Math.min(sceneDurationLimit(currentProject), Number(event.target.value) || 8));
        currentProject.scenes[index].durationSeconds = boundedDuration;
        event.target.value = String(boundedDuration);
        const main = currentProject.tracks.find((track) => track.id === "track-main-video");
        const clip = main?.clips.find((item) => item.sceneId === currentProject.scenes[index].id);
        if (clip) clip.duration = boundedDuration;
      }
      if (field.startsWith("grade.")) {
        const gradeField = field.slice("grade.".length);
        currentProject.scenes[index].grade ||= { brightness: 100, contrast: 100, saturation: 100, blur: 0 };
        currentProject.scenes[index].grade[gradeField] = Number(event.target.value);
      } else {
        if (field !== "durationSeconds") currentProject.scenes[index][field] = event.target.value;
      }
      syncSceneTimeline(currentProject);
      currentProject.durationSeconds = Math.min(projectDurationLimit(currentProject), Math.max(0,
        ...currentProject.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration))
      ));
      renderTimelineEditor();
      renderPreview(currentProject, index);
    };
    byId("media-editor-scenes")?.addEventListener("input", updateSceneField);
    byId("media-editor-scenes")?.addEventListener("change", updateSceneField);
    byId("media-timeline-tracks")?.addEventListener("input", (event) => {
      if (event.target?.dataset?.timelineField) updateTimelineField(event);
    });
    byId("media-timeline-tracks")?.addEventListener("change", (event) => {
      if (event.target?.dataset?.trackField) {
        const track = currentProject?.tracks.find((item) => item.id === event.target.dataset.trackId);
        if (track) track[event.target.dataset.trackField] = event.target.dataset.trackField === "muted" ? !event.target.checked : event.target.checked;
        renderPreviewAtTime(0);
      } else if (event.target?.dataset?.timelineField) {
        updateTimelineField(event);
        renderTimelineEditor();
      }
    });
    byId("media-timeline-playhead")?.addEventListener("input", (event) => {
      if (previewing) stopPreview();
      renderPreviewAtTime(Number(event.target.value) * 1000);
    });
    byId("media-timeline-inspector")?.addEventListener("input", updateTimelineField);
    byId("media-timeline-inspector")?.addEventListener("change", (event) => {
      if (event.target?.dataset?.timelineField) {
        updateTimelineField(event);
        renderTimelineEditor();
      }
    });
    byId("media-timeline-inspector")?.addEventListener("click", handleTimelineAction);
    byId("media-timeline-add-video")?.addEventListener("click", () => addTimelineTrack("video"));
    byId("media-timeline-add-overlay")?.addEventListener("click", () => addTimelineTrack("overlay"));
    byId("media-timeline-add-audio")?.addEventListener("click", () => addTimelineTrack("audio"));
    byId("media-add-scene")?.addEventListener("click", addScene);
    byId("media-save-button")?.addEventListener("click", async () => {
      const button = byId("media-save-button");
      button.disabled = true;
      try { await saveProject(); }
      catch (error) { toast(error.message, true); }
      finally { setEditorControls(); }
    });
    byId("media-approve-button")?.addEventListener("click", async () => {
      const button = byId("media-approve-button");
      button.disabled = true;
      try { await approveProject(); }
      catch (error) { toast(error.message, true); }
      finally { setEditorControls(); }
    });
    byId("media-preview-button")?.addEventListener("click", playPreview);
    byId("media-editor-close")?.addEventListener("click", () => {
      currentProject = null;
      stopPreview();
      byId("media-editor").classList.add("hidden");
    });
    byId("media-export-json")?.addEventListener("click", () => {
      try { exportProjectJson(); } catch (error) { setExportStatus(error.message, true); }
    });
    byId("media-export-script")?.addEventListener("click", () => {
      try { exportScript(); } catch (error) { setExportStatus(error.message, true); }
    });
    byId("media-export-captions")?.addEventListener("click", () => {
      try { exportCaptions(); } catch (error) { setExportStatus(error.message, true); }
    });
    byId("media-export-png")?.addEventListener("click", () => exportSlides());
    byId("media-export-webm")?.addEventListener("click", async () => {
      try { await exportWebm(); }
      catch (error) { setExportStatus(error.message, true); setExportBusy(false); }
    });
    byId("media-export-cancel")?.addEventListener("click", () => {
      if (!exporting) return;
      cancelExportRequested = true;
      setExportStatus("Stopping the local render and discarding the incomplete file…");
    });
    byId("media-audio-file")?.addEventListener("change", (event) => {
      try { setAudioTrack(event.target.files?.[0] || null); }
      catch (error) {
        event.target.value = "";
        setAudioTrack(null);
        setMusicTrack(null);
        setExportStatus(error.message, true);
      }
    });
    byId("media-audio-volume")?.addEventListener("input", (event) => {
      setExportStatus("Export volume: " + Math.round(Number(event.target.value) * 100) + "%.");
    });
    byId("media-music-file")?.addEventListener("change", (event) => {
      try { setMusicTrack(event.target.files?.[0] || null); }
      catch (error) {
        event.target.value = "";
        setMusicTrack(null);
        setExportStatus(error.message, true);
      }
    });
    byId("media-music-volume")?.addEventListener("input", (event) => {
      const requested = Math.round(Number(event.target.value) * 100);
      const note = audioFile ? " (auto-lowered under voiceover)" : "";
      setExportStatus("Background music level: " + requested + "%" + note + ".");
    });
  }

  async function open() {
    initialize();
    try {
      await refresh();
      setStatus("Media workspace ready. Drafts stay private until you export them.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  return { open, refresh, createFromPrompt };
}
