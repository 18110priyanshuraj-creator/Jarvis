export function createAgentEvolution({ api, toast, getSkills }) {
  const state = { programs: [], activeSkills: [], status: null, editingProgramId: null };

  const $ = (selector) => document.querySelector(selector);

  function button(label, action, disabled = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "item-action";
    element.textContent = label;
    element.disabled = disabled;
    element.addEventListener("click", action);
    return element;
  }

  function renderSkillChoices() {
    const select = $("#crucible-skill");
    if (!select) return;
    const selected = select.value;
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.activeSkills.length ? "Choose an approved skill" : "No approved skills available";
    select.append(placeholder);
    for (const skill of state.activeSkills) {
      const option = document.createElement("option");
      option.value = skill.id;
      option.textContent = skill.name + " · active v" + skill.activeVersion;
      select.append(option);
    }
    if (state.activeSkills.some((skill) => skill.id === selected)) select.value = selected;
  }

  function showOutput(message, isError = false) {
    const panel = $("#crucible-run-output");
    if (!panel) return;
    panel.classList.remove("hidden");
    panel.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = isError ? "Skill program error" : "Skill program output";
    const pre = document.createElement("pre");
    pre.textContent = message;
    panel.append(heading, pre);
  }

  function render() {
    renderSkillChoices();
    const runtime = $("#crucible-runtime-status");
    if (runtime && state.status) {
      runtime.textContent = "Runtime: " + state.status.runtime +
        " · Programs: " + state.status.programs +
        " · Manual approval: required · External side effects: disabled";
    }
    const target = $("#crucible-program-list");
    if (!target) return;
    target.replaceChildren();
    if (!state.programs.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No skill programs yet. Choose an approved skill and create a constrained program draft.";
      target.append(empty);
      return;
    }

    for (const program of [...state.programs].reverse()) {
      const row = document.createElement("article");
      row.className = "list-item skill-item";
      const main = document.createElement("div");
      main.className = "list-item-main";
      const title = document.createElement("strong");
      title.textContent = program.name || "Untitled program";
      const status = document.createElement("span");
      status.className = "skill-status skill-status-" + (program.status || "draft");
      status.textContent = (program.status || "draft").replace("-", " ");
      const linkedSkill = state.activeSkills.find((item) => item.id === program.skillId);
      const meta = document.createElement("div");
      meta.className = "list-item-meta";
      meta.textContent = "v" + program.currentVersion +
        " · Active v" + (program.activeVersion || "—") +
        " · Linked skill " + (linkedSkill?.name || program.skillId) +
        " · Skill v" + program.skillVersion;
      const phrases = document.createElement("p");
      phrases.textContent = "Program phrases: " + ((program.program?.steps?.[2]?.phrases || []).join(", "));
      const validation = document.createElement("div");
      validation.className = "list-item-meta";
      const current = (program.versions || []).find((item) => item.version === program.currentVersion);
      validation.textContent = current?.validation
        ? "Latest tests: " + (current.validation.passed ? "passed" : "failed") +
          " · " + current.validation.caseResults.filter((item) => item.passed).length +
          "/" + current.validation.testsRun + " cases"
        : "Current version has not been tested";
      main.append(title, status, meta, phrases, validation);

      const inputLabel = document.createElement("label");
      inputLabel.textContent = "Manual test/run input";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 1200;
      input.placeholder = "Enter a request that matches the linked skill";
      input.setAttribute("aria-label", "Manual skill program run input");
      inputLabel.append(input);

      const actions = document.createElement("div");
      actions.className = "skill-actions";
      actions.append(
        button("New version", () => {
          state.editingProgramId = program.id;
          $("#crucible-skill").value = program.skillId;
          $("#crucible-name").value = program.name;
          $("#crucible-phrases").value = (program.program?.steps?.[2]?.phrases || []).join(", ");
          $("#crucible-keyword-limit").value = String(program.program?.steps?.[1]?.max || 5);
          $("#crucible-template").value = program.program?.steps?.[3]?.template || "";
          const cases = current?.testCases || program.testCases || [];
          $("#crucible-positive").value = cases.find((item) => item.expectedMatched)?.input || "";
          $("#crucible-negative").value = cases.find((item) => !item.expectedMatched)?.input || "";
          $("#crucible-form-title").textContent = "Create a new program version";
          $("#crucible-submit-button").textContent = "Save new version";
          $("#crucible-cancel-edit").classList.remove("hidden");
          $("#crucible-form").scrollIntoView({ behavior: "smooth", block: "start" });
        })
      );

      const test = button("Run test suite", async () => {
        test.disabled = true;
        try {
          const result = await api("/api/skill-crucible/programs/" + encodeURIComponent(program.id) + "/test", {
            method: "POST", body: JSON.stringify({})
          });
          await load();
          toast(result.validation.passed
            ? "All program tests passed. Review and approve this version before running it."
            : "Program tests failed. Edit the draft and test again.");
        } catch (error) {
          toast(error.message, true);
          test.disabled = false;
        }
      });
      actions.append(test);

      const approve = button("Approve version", async () => {
        if (!confirm("Approve this tested program version for manual use with its linked skill?")) return;
        approve.disabled = true;
        try {
          await api("/api/skill-crucible/programs/" + encodeURIComponent(program.id) + "/approve", {
            method: "POST", body: JSON.stringify({})
          });
          await load();
          toast("Skill program version approved.");
        } catch (error) {
          toast(error.message, true);
          approve.disabled = false;
        }
      }, !current?.validation?.passed || current.validation.version !== program.currentVersion);
      actions.append(approve);

      const run = button("Run manually", async () => {
        const value = input.value.trim();
        if (!value) {
          toast("Enter a request to run this program.", true);
          input.focus();
          return;
        }
        run.disabled = true;
        try {
          const skill = state.activeSkills.find((item) => item.id === program.skillId);
          const applicationIds = skill?.applicationIds || [];
          const applicationId = applicationIds.includes("*") ? "web-dashboard" : applicationIds[0];
          const result = await api("/api/skill-crucible/programs/" + encodeURIComponent(program.id) + "/run", {
            method: "POST",
            body: JSON.stringify({ input: value, applicationId })
          });
          showOutput(result.result.output);
          toast("Program completed. No external actions were performed.");
        } catch (error) {
          toast(error.message, true);
          showOutput(error.message, true);
        } finally {
          run.disabled = false;
        }
      }, program.status !== "approved");
      actions.append(run);

      if (program.status !== "paused") {
        actions.append(button("Pause", async () => {
          try {
            await api("/api/skill-crucible/programs/" + encodeURIComponent(program.id) + "/pause", {
              method: "POST", body: JSON.stringify({})
            });
            await load();
            toast("Skill program paused.");
          } catch (error) { toast(error.message, true); }
        }));
      }
      actions.append(button("Delete", async () => {
        if (!confirm("Delete this skill program and its saved versions?")) return;
        try {
          await api("/api/skill-crucible/programs/" + encodeURIComponent(program.id), { method: "DELETE" });
          await load();
          toast("Skill program deleted.");
        } catch (error) { toast(error.message, true); }
      }));

      row.append(main, inputLabel, actions);
      target.append(row);
    }
  }

  async function load() {
    const response = await api("/api/skill-crucible");
    state.programs = Array.isArray(response.programs) ? response.programs : [];
    state.activeSkills = Array.isArray(response.activeSkills) ? response.activeSkills : [];
    state.status = response.status || null;
    render();
    return state;
  }

  function init() {
    const form = $("#crucible-form");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const skillId = $("#crucible-skill").value;
      const name = $("#crucible-name").value.trim();
      const phrases = $("#crucible-phrases").value.split(",").map((item) => item.trim()).filter(Boolean);
      const template = $("#crucible-template").value.trim();
      const testCases = [
        { input: $("#crucible-positive").value.trim(), expectedMatched: true },
        { input: $("#crucible-negative").value.trim(), expectedMatched: false }
      ];
      const payload = {
        skillId,
        name,
        program: {
          steps: [
            { op: "normalize_input" },
            { op: "extract_keywords", max: Number($("#crucible-keyword-limit").value) },
            { op: "match_any", phrases },
            { op: "format_output", template }
          ]
        },
        testCases
      };
      const submit = $("#crucible-submit-button");
      submit.disabled = true;
      try {
        const editingId = state.editingProgramId;
        await api(editingId
          ? "/api/skill-crucible/programs/" + encodeURIComponent(editingId)
          : "/api/skill-crucible/programs", {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(payload)
        });
        resetForm();
        await load();
        toast(editingId ? "New skill program version saved as a draft." : "Skill program draft saved. Run its tests next.");
      } catch (error) {
        toast(error.message, true);
      } finally {
        submit.disabled = false;
      }
    });
    $("#crucible-cancel-edit")?.addEventListener("click", resetForm);
  }

  function resetForm() {
    state.editingProgramId = null;
    $("#crucible-form")?.reset();
    $("#crucible-form-title").textContent = "Create a skill program draft";
    $("#crucible-submit-button").textContent = "Save program draft";
    $("#crucible-cancel-edit").classList.add("hidden");
  }

  async function safeLoad() {
    try {
      await load();
    } catch (error) {
      const runtime = $("#crucible-runtime-status");
      if (runtime) runtime.textContent = "Skill Crucible unavailable: " + error.message;
    }
  }

  return { init, load: safeLoad, render, renderSkillChoices };
}
