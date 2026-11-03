export function createAutoHealWorkspace({ api, toast }) {
  const state = { incidents: [], proposals: [], history: [], status: null, revision: 1 };
  const $ = (selector) => document.querySelector(selector);

  function makeButton(label, handler, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item-action";
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", handler);
    return button;
  }

  function render() {
    const status = $("#autoheal-policy-status");
    if (status && state.status) {
      const cfg = state.status.config;
      status.textContent = "Mode: " + state.status.mode +
        " · Revision " + state.revision +
        " · Step timeout " + (cfg.workflowStepTimeoutMs / 1000) + "s" +
        " · Manual retry cap " + cfg.maxManualRetryAttempts +
        " · Automatic repairs/retries: disabled";
    }
    const incidents = $("#autoheal-incidents-list");
    const proposals = $("#autoheal-proposals-list");
    if (!incidents || !proposals) return;
    incidents.replaceChildren();
    proposals.replaceChildren();

    if (!state.incidents.length) {
      incidents.append(empty("No recorded workflow failure incidents. Select Inspect workflows to refresh from saved runs."));
    }
    for (const incident of [...state.incidents].reverse()) {
      const row = document.createElement("article");
      row.className = "list-item";
      const main = document.createElement("div");
      main.className = "list-item-main";
      const title = document.createElement("strong");
      title.textContent = incident.failureCode.replaceAll("_", " ") + " · " + incident.category;
      const detail = document.createElement("p");
      detail.textContent = incident.message;
      const meta = document.createElement("div");
      meta.className = "list-item-meta";
      meta.textContent = "Run " + incident.runId + " · Step: " + (incident.stepTitle || "Unknown") +
        " · Attempts: " + incident.attempts + " · " + incident.status;
      main.append(title, detail, meta);
      const actions = document.createElement("div");
      actions.className = "workflow-actions";
      const propose = makeButton("Create tested proposal", async () => {
        propose.disabled = true;
        try {
          await api("/api/auto-heal/incidents/" + encodeURIComponent(incident.id) + "/propose", {
            method: "POST", body: JSON.stringify({})
          });
          await load();
          toast("A bounded repair proposal is ready for review. Runtime settings have not changed.");
        } catch (error) {
          toast(error.message, true);
          propose.disabled = false;
        }
      }, incident.failureCode !== "timeout" || incident.status === "dismissed" ||
        state.proposals.some((item) => item.incidentId === incident.id && ["tested", "applied"].includes(item.status)));
      actions.append(propose);
      row.append(main, actions);
      incidents.append(row);
    }

    if (!state.proposals.length) proposals.append(empty("No repair proposals yet. Only supported timeout incidents can produce a bounded proposal."));
    for (const proposal of [...state.proposals].reverse()) {
      const row = document.createElement("article");
      row.className = "list-item";
      const main = document.createElement("div");
      main.className = "list-item-main";
      const title = document.createElement("strong");
      title.textContent = proposal.summary;
      const detail = document.createElement("p");
      detail.textContent = "Before: " + (proposal.before.workflowStepTimeoutMs / 1000) +
        "s · Proposed: " + (proposal.after.workflowStepTimeoutMs / 1000) +
        "s · Retry cap remains " + proposal.after.maxManualRetryAttempts;
      const checks = document.createElement("div");
      checks.className = "list-item-meta";
      checks.textContent = "Validation: " + (proposal.validation.passed ? "passed" : "failed") +
        " · " + proposal.validation.checks.filter((item) => item.passed).length +
        "/" + proposal.validation.checks.length + " checks · " + proposal.status;
      main.append(title, detail, checks);
      const actions = document.createElement("div");
      actions.className = "workflow-actions";
      if (proposal.status === "tested") {
        actions.append(makeButton("Approve and apply", async () => {
          if (!confirm("Apply this tested repair? It changes only the workflow step timeout and can be rolled back.")) return;
          try {
            await api("/api/auto-heal/proposals/" + encodeURIComponent(proposal.id) + "/approve", {
              method: "POST",
              body: JSON.stringify({ expectedRevision: state.revision, confirm: true })
            });
            await load();
            toast("Approved repair applied. Review its recorded history.");
          } catch (error) { toast(error.message, true); }
        }));
      }
      if (proposal.status === "applied") {
        actions.append(makeButton("Roll back", async () => {
          if (!confirm("Roll back this repair to its previous runtime timeout?")) return;
          try {
            await api("/api/auto-heal/proposals/" + encodeURIComponent(proposal.id) + "/rollback", {
              method: "POST",
              body: JSON.stringify({ expectedRevision: state.revision, confirm: true })
            });
            await load();
            toast("Repair rolled back to its previous configuration.");
          } catch (error) { toast(error.message, true); }
        }));
      }
      row.append(main, actions);
      proposals.append(row);
    }
    if (state.history.length) {
      const historyTitle = document.createElement("h4");
      historyTitle.textContent = "Change history";
      proposals.append(historyTitle);
      for (const entry of [...state.history].reverse()) {
        const item = document.createElement("div");
        item.className = "list-item-meta";
        item.textContent = "Revision " + entry.revision + " · " + entry.action +
          " · " + (entry.before.workflowStepTimeoutMs / 1000) + "s → " +
          (entry.after.workflowStepTimeoutMs / 1000) + "s · " + new Date(entry.createdAt).toLocaleString();
        proposals.append(item);
      }
    }
  }

  function empty(message) {
    const node = document.createElement("div");
    node.className = "empty-state";
    node.textContent = message;
    return node;
  }

  async function load() {
    const data = await api("/api/auto-heal");
    state.incidents = data.state?.incidents || [];
    state.proposals = data.state?.proposals || [];
    state.history = data.state?.history || [];
    state.revision = data.state?.revision || 1;
    state.status = data.status || null;
    render();
    return data;
  }

  function init() {
    $("#autoheal-inspect-button")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api("/api/auto-heal/inspect", { method: "POST", body: JSON.stringify({}) });
        await load();
        toast("Workflow incidents refreshed from saved runs.");
      } catch (error) { toast(error.message, true); }
      finally { button.disabled = false; }
    });
  }

  async function safeLoad() {
    try { await load(); }
    catch (error) {
      const status = $("#autoheal-policy-status");
      if (status) status.textContent = "Auto-heal status unavailable: " + error.message;
    }
  }

  return { init, load: safeLoad, render };
}
