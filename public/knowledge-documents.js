export function createKnowledgeDocuments({ api, toast }) {
  const $ = (selector) => document.querySelector(selector);
  const state = { items: [], total: 0, counts: {}, collections: [], query: "", collection: "", review: "all", warning: "" };

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function makeMessage(message) {
    const node = document.createElement("p");
    node.className = "small muted";
    node.textContent = message;
    return node;
  }

  async function refresh() {
    const params = new URLSearchParams();
    if (state.query) params.set("q", state.query);
    if (state.collection) params.set("collection", state.collection);
    if (state.review !== "all") params.set("review", state.review);
    const suffix = params.toString() ? "?" + params.toString() : "";
    const [data, storage] = await Promise.all([
      api("/api/knowledge/documents" + suffix),
      api("/api/knowledge/documents/status")
    ]);
    state.items = Array.isArray(data.items) ? data.items : [];
    state.total = Number(data.total) || 0;
    state.counts = data.counts || {};
    state.collections = Array.isArray(data.collections) ? data.collections : [];
    state.warning = storage.warning || "";
    const filter = $("#knowledge-documents-collection-filter");
    if (filter) {
      const selected = state.collection;
      filter.replaceChildren(new Option("All collections", ""));
      for (const collection of state.collections) filter.add(new Option(collection, collection));
      filter.value = selected;
    }
    render();
  }

  function render() {
    const target = $("#knowledge-documents-list");
    if (!target) return;
    target.replaceChildren();
    const summary = $("#knowledge-documents-summary");
    if (summary) {
      const c = state.counts;
      summary.textContent = (c.total || 0) + " documents · " +
        (c.searchable || 0) + " text-indexed · " + (c.attachments || 0) +
        " metadata-only attachments · " + (c.unreviewed || 0) + " awaiting review.";
    }
    const warning = $("#knowledge-documents-warning");
    if (warning) {
      warning.textContent = state.warning;
      warning.classList.toggle("hidden", !state.warning);
    }
    if (!state.items.length) {
      target.append(makeMessage(state.query
        ? "No documents match this search and filter."
        : "Your document library is empty. Add a text document or an attachment above."));
      return;
    }

    for (const item of state.items) {
      const row = document.createElement("article");
      row.className = "list-item knowledge-document-item";
      const main = document.createElement("div");
      main.className = "list-item-main";
      const title = document.createElement("strong");
      title.textContent = item.title || item.fileName;
      const meta = document.createElement("div");
      meta.className = "list-item-meta";
      const review = item.reviewStatus === "user-reviewed" ? "Reviewed by you"
        : item.reviewStatus === "rejected" ? "Rejected" : "Needs review";
      const indexing = item.indexingMode === "text" ? "Text indexed" : "Attachment only";
      meta.textContent = [
        item.fileName,
        item.mimeType,
        formatBytes(item.byteSize),
        item.collection,
        review,
        indexing,
        item.createdAt ? new Date(item.createdAt).toLocaleString() : ""
      ].filter(Boolean).join(" · ");
      main.append(title, meta);
      if (item.description) main.append(makeMessage(item.description));
      if (Array.isArray(item.tags) && item.tags.length) {
        main.append(makeMessage("Tags: " + item.tags.join(", ")));
      }
      if (item.indexingMode === "metadata-only" && !item.description) {
        main.append(makeMessage("File stored safely, but its contents are not indexed in this phase. Add a description to make it easier to find."));
      }

      const editDetails = document.createElement("details");
      editDetails.className = "knowledge-document-edit";
      const editSummary = document.createElement("summary");
      editSummary.textContent = "Edit collection, tags or description";
      const editForm = document.createElement("form");
      editForm.className = "knowledge-document-edit-form";
      const collectionInput = document.createElement("input");
      collectionInput.type = "text";
      collectionInput.maxLength = 60;
      collectionInput.value = item.collection || "Unsorted";
      collectionInput.setAttribute("aria-label", "Document collection");
      collectionInput.placeholder = "Collection";
      const tagsInput = document.createElement("input");
      tagsInput.type = "text";
      tagsInput.maxLength = 500;
      tagsInput.value = (item.tags || []).join(", ");
      tagsInput.setAttribute("aria-label", "Document tags");
      tagsInput.placeholder = "Comma-separated tags";
      const descriptionInput = document.createElement("textarea");
      descriptionInput.rows = 2;
      descriptionInput.maxLength = 1000;
      descriptionInput.value = item.description || "";
      descriptionInput.setAttribute("aria-label", "Document description");
      descriptionInput.placeholder = "Description or transcript note";
      const saveMetadata = document.createElement("button");
      saveMetadata.type = "submit";
      saveMetadata.className = "item-action";
      saveMetadata.textContent = "Save details";
      editForm.append(collectionInput, tagsInput, descriptionInput, saveMetadata);
      editForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveMetadata.disabled = true;
        try {
          await api("/api/knowledge/documents/" + encodeURIComponent(item.id), {
            method: "PATCH",
            body: JSON.stringify({
              collection: collectionInput.value.trim(),
              tags: tagsInput.value,
              description: descriptionInput.value.trim()
            })
          });
          await refresh();
          toast("Document details updated.");
        } catch (error) {
          toast(error.message, true);
          saveMetadata.disabled = false;
        }
      });
      editDetails.append(editSummary, editForm);
      main.append(editDetails);
      if (item.extractedText) {
        const preview = document.createElement("details");
        const summaryNode = document.createElement("summary");
        summaryNode.textContent = "Text preview";
        const content = document.createElement("p");
        content.className = "knowledge-document-preview";
        content.textContent = item.extractedText.slice(0, 1400);
        preview.append(summaryNode, content);
        main.append(preview);
      }

      const actions = document.createElement("div");
      actions.className = "device-actions";
      if (item.reviewStatus === "unreviewed") {
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "item-action";
        approve.textContent = "Review + approve";
        approve.addEventListener("click", async () => {
          approve.disabled = true;
          try {
            await api("/api/knowledge/documents/" + encodeURIComponent(item.id), {
              method: "PATCH",
              body: JSON.stringify({ reviewStatus: "user-reviewed", confirmReview: true })
            });
            await refresh();
            toast("Document approved for relevant assistant retrieval. This is your review, not an independent fact-check.");
          } catch (error) {
            approve.disabled = false;
            toast(error.message, true);
          }
        });
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "item-action";
        reject.textContent = "Reject";
        reject.addEventListener("click", async () => {
          reject.disabled = true;
          try {
            await api("/api/knowledge/documents/" + encodeURIComponent(item.id), {
              method: "PATCH",
              body: JSON.stringify({ reviewStatus: "rejected", reviewNote: "Rejected in Knowledge Manager." })
            });
            await refresh();
            toast("Document rejected and excluded from assistant context.");
          } catch (error) {
            reject.disabled = false;
            toast(error.message, true);
          }
        });
        actions.append(approve, reject);
      } else {
        const reopen = document.createElement("button");
        reopen.type = "button";
        reopen.className = "item-action";
        reopen.textContent = "Reset review";
        reopen.addEventListener("click", async () => {
          reopen.disabled = true;
          try {
            await api("/api/knowledge/documents/" + encodeURIComponent(item.id), {
              method: "PATCH",
              body: JSON.stringify({ reviewStatus: "unreviewed" })
            });
            await refresh();
            toast("Document returned to review and excluded from assistant context.");
          } catch (error) {
            reopen.disabled = false;
            toast(error.message, true);
          }
        });
        actions.append(reopen);
      }

      const download = document.createElement("button");
      download.type = "button";
      download.className = "item-action";
      download.textContent = "Download";
      download.addEventListener("click", async () => {
        download.disabled = true;
        try {
          const response = await fetch("/api/knowledge/documents/" + encodeURIComponent(item.id) + "/download", {
            credentials: "same-origin",
            cache: "no-store"
          });
          if (response.status === 401) {
            await api("/api/session");
            throw new Error("Your session expired. Please sign in again.");
          }
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || "The document could not be downloaded.");
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = item.fileName || "document";
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
        } catch (error) {
          toast(error.message, true);
        } finally {
          download.disabled = false;
        }
      });
      actions.append(download);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "item-action";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!window.confirm("Delete this file and its document-library record?")) return;
        remove.disabled = true;
        try {
          await api("/api/knowledge/documents/" + encodeURIComponent(item.id), { method: "DELETE" });
          await refresh();
          toast("Document deleted.");
        } catch (error) {
          remove.disabled = false;
          toast(error.message, true);
        }
      });
      actions.append(remove);
      row.append(main, actions);
      target.append(row);
    }
  }

  $("#knowledge-documents-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = $("#knowledge-documents-file").files?.[0];
    if (!file) {
      toast("Choose a document first.", true);
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const headers = {
        "Content-Type": "application/octet-stream",
        "X-Jarvis-Filename": encodeURIComponent(file.name),
        "X-Jarvis-Mime-Type": file.type || ({
          txt: "text/plain", md: "text/markdown", markdown: "text/markdown",
          csv: "text/csv", json: "application/json", pdf: "application/pdf",
          jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
          mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
          weba: "audio/webm", mp4: "video/mp4", webm: "video/webm"
        })[file.name.split(".").pop().toLowerCase()] || "application/octet-stream",
        "X-Jarvis-Title": encodeURIComponent($("#knowledge-documents-title").value.trim()),
        "X-Jarvis-Collection": encodeURIComponent($("#knowledge-documents-collection").value.trim()),
        "X-Jarvis-Tags": encodeURIComponent($("#knowledge-documents-tags").value.trim()),
        "X-Jarvis-Description": encodeURIComponent($("#knowledge-documents-description").value.trim())
      };
      const result = await api("/api/knowledge/documents", {
        method: "POST",
        headers,
        body: file
      });
      await refresh();
      form.reset();
      toast(result.duplicate ? "That file is already in your document library." : "Document uploaded. Review it before using it in assistant context.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("#knowledge-documents-search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.query = $("#knowledge-documents-search").value.trim();
    state.collection = $("#knowledge-documents-collection-filter").value;
    state.review = $("#knowledge-documents-review-filter").value;
    try { await refresh(); } catch (error) { toast(error.message, true); }
  });

  $("#knowledge-documents-collection-filter").addEventListener("change", async (event) => {
    state.collection = event.currentTarget.value;
    try { await refresh(); } catch (error) { toast(error.message, true); }
  });
  $("#knowledge-documents-review-filter").addEventListener("change", async (event) => {
    state.review = event.currentTarget.value;
    try { await refresh(); } catch (error) { toast(error.message, true); }
  });

  return { refresh };
}
