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
  let initialized = false;
  let previewFrame = 0;
  let previewStartedAt = 0;
  let previewing = false;
  let exporting = false;

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

  function renderSceneEditors() {
    const target = byId("media-editor-scenes");
    if (!target || !currentProject) return;
    target.replaceChildren();
    currentProject.scenes.forEach((scene, index) => {
      const card = makeElement("article", "media-scene-editor");
      const heading = makeElement("div", "media-scene-heading");
      heading.append(makeElement("strong", "", "Scene " + (index + 1)));
      const duration = makeElement("label", "media-duration-field");
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
      heading.append(duration);
      card.append(heading);
      card.append(makeField("Scene heading", scene.heading, "heading"));
      card.append(makeField("Voiceover script", scene.voiceover, "voiceover", "textarea"));
      card.append(makeField("On-screen text", scene.onScreenText, "onScreenText", "textarea"));
      card.append(makeField("Visual direction", scene.visualPrompt, "visualPrompt", "textarea"));
      if (currentProject.status === "draft") {
        const remove = makeElement("button", "item-action media-remove-scene", "Remove scene");
        remove.type = "button";
        remove.disabled = currentProject.scenes.length <= MIN_SCENES;
        remove.addEventListener("click", () => {
          currentProject.scenes.splice(index, 1);
          renderSceneEditors();
          renderPreview(currentProject, 0);
        });
        card.append(remove);
      } else {
        card.querySelectorAll("input, textarea").forEach((control) => { control.disabled = true; });
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
    for (const id of ["media-editor-project-title", "media-editor-audience", "media-editor-tone"]) {
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
    const status = byId("media-export-status");
    if (status) status.textContent = approved
      ? "Approved storyboard. Export files are generated locally in this browser."
      : "Approve the storyboard before exporting. Approval does not publish or upload anything.";
  }

  function selectProject(id) {
    const selected = projects.find((item) => item.id === id);
    if (!selected) return;
    stopPreview();
    currentProject = structuredClone(selected);
    byId("media-editor").classList.remove("hidden");
    byId("media-editor-project-title").value = currentProject.title;
    byId("media-editor-audience").value = currentProject.audience || "";
    byId("media-editor-tone").value = currentProject.tone || "clear";
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

  function drawScene(ctx, width, height, project, index, progress = 0) {
    const scene = project.scenes[index];
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#07111f");
    gradient.addColorStop(0.56, "#172840");
    gradient.addColorStop(1, "#4b2e32");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#e6bd86";
    ctx.beginPath();
    ctx.arc(width * (0.82 - progress * 0.06), height * 0.2, unit * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#f2d5a8";
    ctx.lineWidth = Math.max(2, unit * 0.003);
    for (let n = 1; n <= 4; n++) {
      ctx.beginPath();
      ctx.arc(width * 0.18, height * 0.76, unit * (0.08 + n * 0.035), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const margin = width * 0.1;
    ctx.fillStyle = "#e8c28f";
    ctx.font = "700 " + Math.round(unit * 0.021) + "px system-ui, sans-serif";
    ctx.fillText("JARVIS STUDIO", margin, height * 0.1);
    ctx.fillStyle = "rgba(255,255,255,0.48)";
    ctx.font = "500 " + Math.round(unit * 0.018) + "px system-ui, sans-serif";
    ctx.fillText("SCENE " + (index + 1) + " / " + project.scenes.length, margin, height * 0.145);

    ctx.fillStyle = "#f8f3eb";
    ctx.font = "700 " + Math.round(unit * (width > height ? 0.068 : 0.061)) + "px system-ui, sans-serif";
    const titleLines = wrapCanvasText(ctx, scene.onScreenText || scene.heading, width - margin * 2, width > height ? 3 : 5);
    const titleLineHeight = unit * 0.085;
    let y = height * 0.39;
    for (const line of titleLines) {
      ctx.fillText(line, margin, y);
      y += titleLineHeight;
    }

    ctx.fillStyle = "rgba(248,243,235,0.82)";
    ctx.font = "400 " + Math.round(unit * 0.027) + "px system-ui, sans-serif";
    const supporting = scene.voiceover || scene.visualPrompt;
    const supportLines = wrapCanvasText(ctx, supporting, width - margin * 2, width > height ? 4 : 7);
    y += unit * 0.035;
    for (const line of supportLines) {
      ctx.fillText(line, margin, y);
      y += unit * 0.043;
    }

    const barY = height * 0.91;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(margin, barY, width - margin * 2, Math.max(4, unit * 0.006));
    ctx.fillStyle = "#e8c28f";
    ctx.fillRect(margin, barY, (width - margin * 2) * Math.max(0, Math.min(1, progress)), Math.max(4, unit * 0.006));
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "500 " + Math.round(unit * 0.016) + "px system-ui, sans-serif";
    ctx.fillText(project.title, margin, height * 0.955);
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
    const ctx = canvas.getContext("2d");
    if (ctx) drawScene(ctx, canvas.width, canvas.height, project, Math.min(index, project.scenes.length - 1), 0);
  }

  function stopPreview() {
    previewing = false;
    if (previewFrame) cancelAnimationFrame(previewFrame);
    previewFrame = 0;
    const button = byId("media-preview-button");
    if (button) button.textContent = "Preview storyboard";
  }

  function playPreview() {
    if (!currentProject) return;
    if (previewing) {
      stopPreview();
      return;
    }
    previewing = true;
    previewStartedAt = performance.now();
    byId("media-preview-button").textContent = "Stop preview";
    const tick = (now) => {
      if (!previewing || !currentProject) return;
      const index = Math.floor((now - previewStartedAt) / 2200) % currentProject.scenes.length;
      const progress = ((now - previewStartedAt) % 2200) / 2200;
      const canvas = byId("media-preview-canvas");
      const ctx = canvas?.getContext("2d");
      if (ctx) drawScene(ctx, canvas.width, canvas.height, currentProject, index, progress);
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
        currentProject = null;
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
      throw new Error("WebM export is not supported by this browser. Export the storyboard, script, captions or slide PNGs instead.");
    }
    const size = FORMATS[project.format] || FORMATS["vertical-short"];
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(size.width, 720);
    canvas.height = Math.round(canvas.width * size.height / size.width);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The browser could not create a video canvas.");
    const stream = canvas.captureStream(15);
    const mimeTypes = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    const mimeType = mimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks = [];
    let animation = 0;
    const totalMs = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds * 1000, 0);
    const sceneStarts = [];
    let running = 0;
    project.scenes.forEach((scene) => {
      sceneStarts.push(running);
      running += scene.durationSeconds * 1000;
    });

    setExportBusy(true, "Rendering a silent WebM at real time. Keep this tab open until the export finishes.");
    const finished = new Promise((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener("error", () => reject(new Error("The browser stopped the video export unexpectedly.")), { once: true });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
      }, { once: true });
    });

    try {
      const startedAt = performance.now();
      recorder.start(500);
      await new Promise((resolve) => {
        const frame = (now) => {
          const elapsed = Math.min(totalMs, now - startedAt);
          let index = project.scenes.length - 1;
          for (let i = 0; i < sceneStarts.length; i++) {
            if (elapsed < sceneStarts[i] + project.scenes[i].durationSeconds * 1000) {
              index = i;
              break;
            }
          }
          const sceneElapsed = elapsed - sceneStarts[index];
          const sceneProgress = sceneElapsed / (project.scenes[index].durationSeconds * 1000);
          drawScene(ctx, canvas.width, canvas.height, project, index, sceneProgress);
          setExportStatus("Rendering scene " + (index + 1) + " of " + project.scenes.length + "…");
          if (elapsed >= totalMs) {
            recorder.stop();
            resolve();
            return;
          }
          animation = requestAnimationFrame(frame);
        };
        animation = requestAnimationFrame(frame);
      });
      const blob = await finished;
      downloadBlob(cleanFileName(project.title) + ".webm", blob);
      setExportStatus("WebM export finished. This file contains motion graphics and no audio track; use the script or SRT captions for voiceover editing.");
    } finally {
      if (animation) cancelAnimationFrame(animation);
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      setExportBusy(false);
    }
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
          audience: byId("media-audience").value
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

  return { open, refresh };
}
