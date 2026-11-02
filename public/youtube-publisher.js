export function createYouTubePublisher({ api, toast }) {
  const state = {
    initialized: false,
    status: null,
    projects: [],
    preview: null,
    file: null,
    publications: []
  };
  const byId = (id) => document.getElementById(id);

  function setStatus(message, isError = false) {
    const target = byId("youtube-status");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("error-text", isError);
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function cleanBytes(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 0) return "Unknown size";
    if (size < 1024 * 1024) return Math.max(1, Math.round(size / 1024)) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  function approvedProjects() {
    return state.projects.filter((project) => project.status === "approved");
  }

  function selectedProject() {
    return approvedProjects().find((project) => project.id === byId("youtube-project")?.value) || null;
  }

  function renderStatus() {
    const status = state.status || {};
    const connected = status.canUpload === true;
    const connect = byId("youtube-connect-button");
    if (connect) {
      connect.disabled = !status.canConnect || connected || status.googleIntegrationEnabled === false;
      connect.textContent = connected ? "YouTube upload permission connected" : "Connect Google for YouTube uploads";
    }
    const label = byId("youtube-connection-state");
    if (label) label.textContent = connected
      ? "Connected · YouTube upload permission active"
      : status.connected
        ? "Google connected · YouTube permission not granted"
        : status.canConnect
          ? "Google OAuth is configured · Not connected"
          : "Google OAuth setup is incomplete";
    const note = byId("youtube-connection-note");
    if (note) note.textContent = status.googleIntegrationEnabled === false
      ? "Google services are disabled in JARVIS. Enable the Google integration before connecting YouTube."
      : connected
        ? "JARVIS holds the encrypted Google refresh token on the server. The browser never receives Google credentials."
        : "Connecting requests the YouTube upload permission. Google will show the account and permission screen before anything is connected.";
    const form = byId("youtube-preview-form");
    if (form) form.querySelectorAll("input, select, textarea, button").forEach((control) => {
      if (control.id === "youtube-connect-button") return;
      control.disabled = !connected || Boolean(state.preview);
    });
    if (connect && !status.canConnect) connect.title = "Configure Google OAuth and the existing token encryption key in the server hosting settings.";
    renderProjectOptions();
    renderHistory();
    renderPreview();
  }

  function renderProjectOptions() {
    const select = byId("youtube-project");
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    const placeholder = make("option", "", "Choose an approved Media Studio project");
    placeholder.value = "";
    select.append(placeholder);
    for (const project of approvedProjects()) {
      const option = make("option", "", project.title);
      option.value = project.id;
      select.append(option);
    }
    if (approvedProjects().some((project) => project.id === previous)) select.value = previous;
    const hasProjects = approvedProjects().length > 0;
    select.disabled = !state.status?.canUpload || Boolean(state.preview) || !hasProjects;
    const hint = byId("youtube-project-hint");
    if (hint) hint.textContent = hasProjects
      ? "Only storyboards already approved in Media Studio can be published."
      : "Approve a storyboard in Media Studio before preparing a YouTube upload.";
  }

  function renderPreview() {
    const panel = byId("youtube-preview-panel");
    const form = byId("youtube-preview-form");
    if (!panel || !form) return;
    panel.replaceChildren();
    if (!state.preview) {
      panel.classList.add("hidden");
      form.classList.remove("hidden");
      return;
    }
    const preview = state.preview;
    panel.classList.remove("hidden");
    form.classList.add("hidden");
    const heading = make("h3", "", "Review the exact upload");
    const warning = make("p", "small muted",
      "This is a saved preview only. No video bytes have been sent to YouTube yet.");
    const details = make("dl", "youtube-preview-details");
    const rows = [
      ["Title", preview.title],
      ["File", preview.fileName + " · " + cleanBytes(preview.contentLength)],
      ["Privacy", preview.privacyStatus.toUpperCase()],
      ["Audience declaration", preview.madeForKids ? "Made for kids" : "Not made for kids"],
      ...(preview.privacyStatus === "public" ? [["Parent/guardian review", preview.guardianReviewed ? "Confirmed" : "Not confirmed"]] : []),
      ["Expires", new Date(preview.expiresAt).toLocaleString()]
    ];
    for (const [label, value] of rows) {
      const term = make("dt", "", label);
      const description = make("dd", "", value);
      details.append(term, description);
    }
    const phrase = make("p", "youtube-confirm-phrase", "Type PUBLISH to unlock the upload button.");
    const inputLabel = make("label", "youtube-field");
    inputLabel.append(make("span", "", "Confirmation phrase"));
    const input = make("input", "youtube-control");
    input.id = "youtube-confirmation";
    input.autocomplete = "off";
    input.placeholder = "Type PUBLISH";
    input.maxLength = 12;
    input.addEventListener("input", updateConfirmButton);
    inputLabel.append(input);
    const actions = make("div", "youtube-actions");
    const upload = make("button", "primary", "Confirm and upload video");
    upload.type = "button";
    upload.id = "youtube-upload-button";
    upload.disabled = true;
    upload.addEventListener("click", uploadCurrentPreview);
    const cancel = make("button", "item-action", "Cancel preview");
    cancel.type = "button";
    cancel.addEventListener("click", cancelPreview);
    actions.append(upload, cancel);
    const note = make("p", "youtube-status-note",
      "After confirmation JARVIS streams this file to YouTube. It does not save a permanent server-side copy. An interrupted upload is never retried automatically.");
    panel.append(heading, warning, details, phrase, inputLabel, actions, note);
  }

  function updateConfirmButton() {
    const button = byId("youtube-upload-button");
    const input = byId("youtube-confirmation");
    if (button) button.disabled = input?.value.trim() !== "PUBLISH" || !state.file || !state.preview;
  }

  function renderHistory() {
    const target = byId("youtube-history");
    if (!target) return;
    target.replaceChildren();
    if (!state.publications.length) {
      target.append(make("div", "empty-state", "No YouTube publication attempts yet."));
      return;
    }
    for (const item of state.publications) {
      const card = make("article", "youtube-history-card");
      const title = make("strong", "", item.title || "YouTube upload");
      const meta = make("p", "small muted", [
        item.privacyStatus ? item.privacyStatus.toUpperCase() : "",
        item.status || "unknown",
        item.uploadStatus || "",
        item.uploadedAt ? new Date(item.uploadedAt).toLocaleString() : new Date(item.createdAt).toLocaleString()
      ].filter(Boolean).join(" · "));
      card.append(title, meta);
      if (item.error) card.append(make("p", "small error-text", item.error));
      if (item.videoUrl && item.status === "uploaded") {
        const link = make("a", "youtube-video-link", "Open video on YouTube");
        link.href = item.videoUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        card.append(link);
      }
      if (item.status === "pending_confirmation") {
        const cancel = make("button", "item-action", "Cancel pending preview");
        cancel.type = "button";
        cancel.addEventListener("click", async () => {
          cancel.disabled = true;
          try {
            await api("/api/youtube/previews/" + encodeURIComponent(item.id) + "/cancel", {
              method: "POST",
              body: JSON.stringify({})
            });
            await refresh();
            setStatus("Pending preview cancelled. No video was uploaded.");
          } catch (error) {
            toast(error.message, true);
            cancel.disabled = false;
          }
        });
        card.append(cancel);
      }
      target.append(card);
    }
  }

  async function refresh() {
    const [status, media] = await Promise.all([
      api("/api/youtube/status"),
      api("/api/media/projects")
    ]);
    state.status = status;
    state.projects = Array.isArray(media.projects) ? media.projects : [];
    state.publications = Array.isArray(status.publications) ? status.publications : [];
    renderStatus();
  }

  async function connectGoogle() {
    const button = byId("youtube-connect-button");
    button.disabled = true;
    try {
      const data = await api("/api/integrations/google_drive/oauth/start", {
        method: "POST",
        body: JSON.stringify({ capability: "youtube_upload" })
      });
      window.location.href = data.launchUrl;
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
  }

  async function createPreview(event) {
    event.preventDefault();
    const project = selectedProject();
    if (!project) {
      setStatus("Choose an approved Media Studio project first.", true);
      return;
    }
    const file = byId("youtube-file")?.files?.[0];
    if (!file) {
      setStatus("Choose a video file first.", true);
      return;
    }
    if (file.size > (state.status?.maxUploadBytes || 0)) {
      setStatus("The selected video is larger than the JARVIS upload limit.", true);
      return;
    }
    const button = byId("youtube-preview-button");
    button.disabled = true;
    setStatus("Saving a time-limited upload preview…");
    try {
      const previewResult = await api("/api/youtube/previews", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          title: byId("youtube-title").value,
          description: byId("youtube-description").value,
          tags: byId("youtube-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
          categoryId: byId("youtube-category").value,
          privacyStatus: byId("youtube-privacy").value,
          madeForKids: byId("youtube-made-for-kids").value === "true"
            ? true
            : byId("youtube-made-for-kids").value === "false" ? false : null,
          guardianReviewed: byId("youtube-public-review")?.checked === true,
          fileName: file.name,
          contentType: file.type,
          contentLength: file.size,
          reviewed: byId("youtube-reviewed").checked,
          rightsConfirmed: byId("youtube-rights").checked
        })
      });
      state.file = file;
      state.preview = previewResult.preview;
      renderPreview();
      setStatus("Preview saved. Check the title, file, privacy and audience declaration, then type PUBLISH to continue.");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function cancelPreview() {
    if (!state.preview) return;
    try {
      await api("/api/youtube/previews/" + encodeURIComponent(state.preview.id) + "/cancel", {
        method: "POST",
        body: JSON.stringify({})
      });
      state.preview = null;
      state.file = null;
      byId("youtube-preview-form").reset();
      byId("youtube-public-review-wrap")?.classList.add("hidden");
      renderPreview();
      await refresh();
      setStatus("Preview cancelled. No video was uploaded.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function uploadCurrentPreview() {
    const preview = state.preview;
    const file = state.file;
    if (!preview || !file || byId("youtube-confirmation")?.value.trim() !== "PUBLISH") return;
    const privacy = preview.privacyStatus;
    const warning = privacy === "public"
      ? "This video will be PUBLIC and may be visible to anyone immediately after YouTube makes it available."
      : privacy === "unlisted"
        ? "Anyone with the unlisted video link may be able to view and share it."
        : "The video will be uploaded as PRIVATE.";
    if (!window.confirm("Upload this approved video to YouTube?\n\n" + preview.title + "\nPrivacy: " + privacy.toUpperCase() + "\n" + warning + "\n\nJARVIS will stream the video to the Google account you connected.")) return;
    if (privacy === "public" && !window.confirm("Final public publishing confirmation: this video can be seen by the public. Continue?")) return;

    const button = byId("youtube-upload-button");
    button.disabled = true;
    setStatus("Streaming the video to YouTube. Keep this page open until YouTube responds…");
    try {
      const response = await fetch("/api/youtube/publications/" + encodeURIComponent(preview.id) + "/upload", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": file.type,
          "X-Jarvis-Confirmation": "PUBLISH"
        },
        body: file
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || "YouTube did not confirm the upload. Check YouTube Studio before trying again.");
        error.status = response.status;
        error.publication = payload.publication || null;
        throw error;
      }
      state.preview = null;
      state.file = null;
      byId("youtube-preview-form").reset();
      byId("youtube-public-review-wrap")?.classList.add("hidden");
      await refresh();
      setStatus("YouTube accepted the video. It may continue processing before it becomes visible.");
      toast("YouTube upload accepted.");
    } catch (error) {
      if (error.status !== 400 && error.status !== 415) {
        state.preview = null;
        state.file = null;
        await refresh().catch(() => {});
      }
      setStatus(error.message + (error.status === 400 || error.status === 415
        ? " Cancel this preview and create a new one after correcting the file."
        : " JARVIS did not retry the upload."), true);
    } finally {
      if (button.isConnected) button.disabled = true;
    }
  }

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    byId("youtube-connect-button")?.addEventListener("click", connectGoogle);
    byId("youtube-refresh-button")?.addEventListener("click", () => refresh().catch((error) => setStatus(error.message, true)));
    byId("youtube-preview-form")?.addEventListener("submit", createPreview);
    byId("youtube-privacy")?.addEventListener("change", () => {
      byId("youtube-public-review-wrap")?.classList.toggle("hidden", byId("youtube-privacy").value !== "public");
      if (byId("youtube-privacy").value !== "public" && byId("youtube-public-review")) {
        byId("youtube-public-review").checked = false;
      }
    });
    byId("youtube-project")?.addEventListener("change", () => {
      const project = selectedProject();
      if (!project) return;
      byId("youtube-title").value = project.title.slice(0, 100);
      if (!byId("youtube-description").value) byId("youtube-description").value = project.brief.slice(0, 5000);
    });
    byId("youtube-file")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      state.file = file || null;
      const hint = byId("youtube-file-hint");
      if (hint) hint.textContent = file
        ? file.name + " · " + cleanBytes(file.size) + " · " + (file.type || "Unknown MIME type")
        : "MP4, WebM or QuickTime · maximum 256 MiB";
    });
  }

  async function open() {
    initialize();
    try {
      await refresh();
      setStatus("Publishing is disabled until Google grants the YouTube upload permission.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  return { open, refresh };
}
