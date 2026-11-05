const FORMATS = {
  "vertical-short": { width: 720, height: 1280 },
  "landscape-explainer": { width: 1280, height: 720 },
  "square-carousel": { width: 1080, height: 1080 }
};
const MAX_SCENES = 12;
const MIN_SCENES = 2;

export function createMediaWorkspace({ api, toast }) {
  let projects = [];
  let currentProject = null;
  let selectedProjectId = null;
  let initialized = false;
  let previewFrame = 0;
  let previewStartedAt = 0;
  let previewing = false;
  let exporting = false;
  let audioFile = null;
  let audioObjectUrl = null;
  const sceneAssets = new Map();

  const byId = (id) => document.getElementById(id);

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
      control.max = "30";
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
  }

  async function setSceneAsset(scene, file) {
    const projectId = currentProject?.id;
    if (!projectId || !scene?.id) return;
    disposeSceneAsset(scene.id);
    if (!file) {
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

  async function playSceneVideos() {
    const videos = [...sceneAssets.values()].filter((asset) => asset.type === "video");
    await Promise.all(videos.map(async (asset) => {
      try {
        await asset.element.play();
      } catch {
        // A blocked local video remains visible as a still frame where available.
      }
    }));
  }

  function pauseSceneVideos() {
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
        project.durationSeconds + " sec",
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
      durationInput.max = "30";
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
      card.append(assetField);
      if (currentProject.status === "draft") {
        const remove = makeElement("button", "item-action media-remove-scene", "Remove scene");
        remove.type = "button";
        remove.disabled = currentProject.scenes.length <= MIN_SCENES;
        remove.addEventListener("click", () => {
          disposeSceneAsset(scene.id);
          currentProject.scenes.splice(index, 1);
          currentProject.scenes.forEach((item, order) => { item.order = order + 1; });
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
    const audioInput = byId("media-audio-file");
    if (audioInput) audioInput.disabled = exporting;
    const volume = byId("media-audio-volume");
    if (volume) volume.disabled = exporting;
    const exportButton = byId("media-export-webm");
    if (exportButton) exportButton.textContent = audioFile ? "Export video + audio" : "Export video (silent)";
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
      currentProject.durationSeconds + " seconds · " + currentProject.status;
    byId("media-generation-note").textContent = currentProject.generationNote || "";
    renderSceneEditors();
    renderPreview(currentProject, 0);
    setEditorControls();
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
    ctx.restore();
  }

  function sceneAtTime(project, elapsedMs) {
    const totalMs = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds * 1000, 0);
    const bounded = Math.max(0, Math.min(totalMs, elapsedMs));
    let cursor = 0;
    for (let index = 0; index < project.scenes.length; index++) {
      const durationMs = project.scenes[index].durationSeconds * 1000;
      if (bounded < cursor + durationMs || index === project.scenes.length - 1) {
        return { index, sceneElapsedMs: Math.min(durationMs, bounded - cursor), progress: Math.min(1, Math.max(0, (bounded - cursor) / durationMs)), totalMs };
      }
      cursor += durationMs;
    }
    return { index: 0, sceneElapsedMs: 0, progress: 0, totalMs };
  }

  function drawTimelineFrame(ctx, width, height, project, elapsedMs) {
    const frame = sceneAtTime(project, elapsedMs);
    const { index, sceneElapsedMs, progress } = frame;
    const scene = project.scenes[index];
    const transitionMs = 650;
    const transitionProgress = Math.min(1, sceneElapsedMs / transitionMs);
    const transition = scene.transition || "fade";
    ctx.clearRect(0, 0, width, height);
    if (index === 0 || sceneElapsedMs >= transitionMs || transition === "cut") {
      drawScene(ctx, width, height, project, index, progress);
      return;
    }
    const previousIndex = index - 1;
    if (transition === "fade") {
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
  }

  function renderPreview(project, index = 0) {
    const canvas = byId("media-preview-canvas");
    if (!canvas || !project?.scenes?.length) return;
    const size = FORMATS[project.format] || FORMATS["vertical-short"];
    canvas.width = Math.min(size.width, 960);
    canvas.height = Math.round(canvas.width * size.height / size.width);
    if (canvas.height > 960) {
      canvas.height = 960;
      canvas.width = Math.round(canvas.height * size.width / size.height);
    }
    let startMs = 0;
    for (let cursor = 0; cursor < Math.min(index, project.scenes.length); cursor++) {
      startMs += project.scenes[cursor].durationSeconds * 1000;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) drawTimelineFrame(ctx, canvas.width, canvas.height, project, startMs + 1);
  }

  function stopPreview() {
    previewing = false;
    pauseSceneVideos();
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
    await playSceneVideos();
    if (!previewing) return;
    previewStartedAt = performance.now();
    byId("media-preview-button").textContent = "Stop preview";
    const totalMs = currentProject.scenes.reduce((sum, scene) => sum + scene.durationSeconds * 1000, 0);
    const tick = (now) => {
      if (!previewing || !currentProject) return;
      const elapsed = (now - previewStartedAt) % totalMs;
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
      scenes: readSceneEditors()
    };
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
      exportNotes: {
        video: "Use Export WebM to render a silent motion-graphic video in this browser.",
        audio: "Voiceover is supplied as a script and captions; no audio is recorded or generated.",
        assets: "Visual directions are prompts only. Add media assets only when you have the rights to use them."
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
      throw new Error("WebM export is not supported by this browser. Export the storyboard, script, captions or scene PNGs instead.");
    }
    const size = FORMATS[project.format] || FORMATS["vertical-short"];
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(size.width, 720);
    canvas.height = Math.round(canvas.width * size.height / size.width);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The browser could not create a video canvas.");

    let audioContext = null;
    let audioSource = null;
    let audioDestination = null;
    let canvasStream = null;
    let stream = null;
    let animation = 0;
    let recorder = null;
    const totalMs = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds * 1000, 0);
    const chunks = [];

    setExportBusy(true, audioFile
      ? "Preparing the local audio track and rendering the video. Keep this tab open until export finishes."
      : "Rendering motion graphics without an audio track. Add a local audio file above to include voiceover or music.");

    try {
      canvasStream = canvas.captureStream(20);
      let audioTracks = [];
      if (audioFile) {
        const AudioContextType = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextType || typeof MediaStream === "undefined") {
          throw new Error("This browser cannot mix a local audio track into WebM. Remove the audio file and export silent motion graphics.");
        }
        audioContext = new AudioContextType();
        await audioContext.resume();
        const decoded = await audioContext.decodeAudioData(await audioFile.arrayBuffer());
        audioDestination = audioContext.createMediaStreamDestination();
        audioSource = audioContext.createBufferSource();
        audioSource.buffer = decoded;
        const gain = audioContext.createGain();
        gain.gain.value = Math.max(0, Math.min(1.5, Number(byId("media-audio-volume")?.value || 1)));
        audioSource.connect(gain);
        gain.connect(audioDestination);
        audioTracks = audioDestination.stream.getAudioTracks();
      }
      stream = typeof MediaStream !== "undefined"
        ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
        : canvasStream;
      const mimeTypes = audioFile
        ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      const mimeType = mimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
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

      await playSceneVideos();
      const startedAt = performance.now();
      recorder.start(500);
      if (audioSource) audioSource.start();
      await new Promise((resolve) => {
        const frame = (now) => {
          const elapsed = Math.min(totalMs, now - startedAt);
          drawTimelineFrame(ctx, canvas.width, canvas.height, project, elapsed);
          const current = sceneAtTime(project, elapsed);
          setExportStatus("Rendering scene " + (current.index + 1) + " of " + project.scenes.length +
            (audioFile ? " · audio mixed locally" : " · no audio track") + "…");
          if (elapsed >= totalMs) {
            if (recorder?.state !== "inactive") recorder.stop();
            resolve();
            return;
          }
          animation = requestAnimationFrame(frame);
        };
        animation = requestAnimationFrame(frame);
      });
      const blob = await finished;
      const suffix = audioFile ? "-with-audio.webm" : ".webm";
      downloadBlob(cleanFileName(project.title) + suffix, blob);
      setExportStatus(audioFile
        ? "Video export finished with the selected local audio track. Preview the downloaded file before using it."
        : "Silent video export finished. Add a local voiceover or music track to export a version with audio.");
    } finally {
      if (animation) cancelAnimationFrame(animation);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      pauseSceneVideos();
      for (const mediaStream of [stream, canvasStream, audioDestination?.stream]) {
        mediaStream?.getTracks().forEach((track) => track.stop());
      }
      try { audioSource?.stop(); } catch { /* source may already have ended */ }
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
      setExportStatus("No audio track selected. The next WebM export will be silent.");
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
    currentProject.scenes.push({
      id: "local-" + Date.now(),
      heading: "New scene",
      voiceover: "Add your narration for this scene.",
      onScreenText: "New idea",
      visualPrompt: "Describe a simple visual that supports the narration.",
      durationSeconds: 8,
      visualType: byId("media-editor-visual-style").value === "stick-figure-story" ? "stick-figure" : "auto",
      figurePose: "walk",
      animation: "walk",
      background: "midnight",
      transition: "fade",
      order: currentProject.scenes.length + 1
    });
    renderSceneEditors();
    renderPreview(currentProject, currentProject.scenes.length - 1);
  }

  function initialize() {
    if (initialized) return;
    initialized = true;

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

    byId("media-editor-scenes")?.addEventListener("input", (event) => {
      const field = event.target?.dataset?.field;
      const card = event.target?.closest?.(".media-scene-editor");
      if (!field || !card || !currentProject) return;
      const cards = [...byId("media-editor-scenes").querySelectorAll(".media-scene-editor")];
      const index = cards.indexOf(card);
      if (index < 0 || !currentProject.scenes[index]) return;
      currentProject.scenes[index][field] = field === "durationSeconds"
        ? Number(event.target.value)
        : event.target.value;
      renderPreview(currentProject, index);
    });
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
    byId("media-audio-file")?.addEventListener("change", (event) => {
      try { setAudioTrack(event.target.files?.[0] || null); }
      catch (error) {
        event.target.value = "";
        setAudioTrack(null);
        setExportStatus(error.message, true);
      }
    });
    byId("media-audio-volume")?.addEventListener("input", (event) => {
      setExportStatus("Export volume: " + Math.round(Number(event.target.value) * 100) + "%.");
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
