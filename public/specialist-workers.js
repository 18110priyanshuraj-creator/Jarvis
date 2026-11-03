export function createSpecialistWorkersWorkspace({ api, toast }) {
  const $ = (selector) => document.querySelector(selector);
  let workers = [];
  let runs = [];
  let dispatching = false;

  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function renderWorkers() {
    const target = $("#specialist-worker-catalog");
    if (!target) return;
    target.replaceChildren();
    if (!workers.length) {
      target.append(element("p", "small muted", "The specialist catalogue could not be loaded."));
      return;
    }
    for (const worker of workers) {
      const row = element("article", "list-item specialist-worker-item");
      const main = element("div", "list-item-main");
      const title = element("strong", "", worker.name);
      const status = element("span", "workflow-status workflow-status-" + worker.status, worker.status);
      const purpose = element("p", "", worker.purpose);
      const boundary = element("p", "small muted", worker.boundary);
      const permissions = element("p", "list-item-meta", "Scope: " + worker.permissions.join(" · "));
      main.append(title, status, purpose, boundary, permissions);
      row.append(main);
      target.append(row);
    }
  }

  function renderRuns() {
    const target = $("#specialist-worker-runs");
    if (!target) return;
    target.replaceChildren();
    if (!runs.length) {
      target.append(element("p", "small muted", "No specialist runs yet."));
      return;
    }
    for (const run of runs) {
      const row = element("article", "list-item specialist-run-item");
      const main = element("div", "list-item-main");
      const title = element("strong", "", run.goal);
      const status = element("span", "workflow-status workflow-status-" + run.status, run.status.replace(/_/g, " "));
      const meta = element("p", "list-item-meta", new Date(run.createdAt).toLocaleString() + " · " + run.steps.length + " workers");
      const summary = element("p", "", run.summary);
      const steps = element("ol", "specialist-run-steps");
      for (const step of run.steps) {
        const worker = workers.find((item) => item.id === step.workerId);
        const name = worker ? worker.name : step.workerId;
        const result = step.result && step.result.summary ? ": " + step.result.summary : "";
        steps.append(element("li", "", name + " — " + step.status.replace(/_/g, " ") + result));
      }
      main.append(title, status, meta, summary, steps);
      if (run.status === "waiting_for_user") main.append(element("p", "small muted", "No downstream worker ran. Resolve the approval requirement and submit a new, appropriately scoped task."));
      if (run.status === "needs_review") main.append(element("p", "small muted", "Review the recorded checkpoints. JARVIS will not replay unfinished steps automatically."));
      row.append(main);
      target.append(row);
    }
  }

  async function load() {
    const data = await api("/api/workers");
    workers = Array.isArray(data.workers) ? data.workers : [];
    runs = Array.isArray(data.runs) ? data.runs : [];
    renderWorkers();
    renderRuns();
    return data;
  }

  function init() {
    const form = $("#specialist-dispatch-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (dispatching) return;
      const goal = $("#specialist-dispatch-goal")?.value.trim() || "";
      const button = $("#specialist-dispatch-button");
      if (!goal) {
        toast("Describe the task before dispatching the specialists.", true);
        return;
      }
      dispatching = true;
      if (button) button.disabled = true;
      try {
        const data = await api("/api/workers/dispatch", { method: "POST", body: JSON.stringify({ goal }) });
        $("#specialist-dispatch-goal").value = "";
        await load();
        const run = data.run;
        if (run.status === "completed") toast("Specialist work completed and its evidence was verified.");
        else if (run.status === "waiting_for_user") toast("Specialist work paused for your approval.");
        else toast("Specialist run status: " + run.status.replace(/_/g, " "));
      } catch (error) {
        toast(error.message || "Specialist dispatch failed.", true);
      } finally {
        dispatching = false;
        if (button) button.disabled = false;
      }
    });
  }

  return { init, load };
}
