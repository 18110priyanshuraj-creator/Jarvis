const $ = (selector) => document.querySelector(selector);
const state = { chats: [], memories: [], tasks: [], feedback: [], skills: [], devices: [], activeView: "chat" };
let toastTimer;

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 3800);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== "/api/login") {
    showLogin();
    throw new Error("Your session expired. Please sign in again.");
  }
  if (!response.ok) throw new Error(payload.error || "Request failed. Please try again.");
  return payload;
}

function showLogin() {
  $("#login-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
}

function showApp() {
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
}

async function boot() {
  try {
    await api("/api/session");
    showApp();
    await refreshState();
  } catch {
    showLogin();
  }
}

async function refreshState() {
  const data = await api("/api/state");
  state.chats = data.chats || [];
  state.memories = data.memories || [];
  state.tasks = data.tasks || [];
  state.feedback = data.feedback || [];
  state.skills = data.skills || [];
  renderChats();
  renderMemories();
  renderTasks();
  renderSkills();
}

function setView(name) {
  state.activeView = name;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
  $("#view-" + name).classList.remove("hidden");
  const titles = {
    chat: ["PERSONAL ASSISTANT", "Assistant"],
    devices: ["ANDROID COMPANION", "Device Control"],
    memory: ["PERSONAL CONTEXT", "Memory"],
    tasks: ["ORGANIZATION", "Tasks"],
    research: ["WEB DISCOVERY", "Research"]
  };
  $("#page-kicker").textContent = titles[name][0];
  $("#page-title").textContent = titles[name][1];
  if (name === "chat") setTimeout(() => $("#chat-input").focus(), 0);
  if (name === "devices") refreshDevices().catch((error) => toast(error.message, true));
}

function makeEmpty(message) {
  const el = document.createElement("div");
  el.className = "empty-state";
  el.textContent = message;
  return el;
}

function renderChats() {
  const target = $("#chat-messages");
  target.replaceChildren();
  const messages = state.chats.slice(-28);
  if (!messages.length) {
    $("#chat-messages").classList.add("hidden");
    $(".chat-intro").classList.remove("hidden");
    return;
  }
  $("#chat-messages").classList.remove("hidden");
  $(".chat-intro").classList.add("hidden");
  for (let index = 0; index < messages.length; index++) {
    const item = messages[index];
    if (item.role !== "user" && item.role !== "assistant") continue;
    const row = document.createElement("article");
    row.className = "message " + item.role;
    const mark = document.createElement("div");
    mark.className = "message-mark";
    mark.textContent = item.role === "user" ? "Y" : "J";
    mark.setAttribute("aria-hidden", "true");
    const wrap = document.createElement("div");
    wrap.className = "message-wrap";
    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = item.content || "";
    wrap.append(body);
    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
    if (item.role === "assistant" && item.engine === "gemini-conversation") {
      time.textContent += " · Gemini";
    } else if (item.role === "assistant" && item.engine === "built-in-offline-fallback") {
      time.textContent += " · Offline fallback";
    } else if (item.role === "assistant" && item.engine === "built-in-offline") {
      time.textContent += " · Offline brain";
    }
    wrap.append(time);
    if (item.role === "assistant") {
      const previousUser = [...messages.slice(0, index)].reverse().find((entry) => entry.role === "user");
      if (previousUser) {
        const feedback = document.createElement("div");
        feedback.className = "message-feedback";
        const existing = state.feedback.find((entry) => entry.prompt === previousUser.content);
        for (const [rating, label] of [["up", "Helpful"], ["down", "Needs work"]]) {
          const action = document.createElement("button");
          action.type = "button";
          action.className = "item-action";
          action.textContent = (existing?.rating === rating ? "✓ " : "") + label;
          action.setAttribute("aria-label", "Mark this response " + label.toLowerCase());
          action.addEventListener("click", async () => {
            action.disabled = true;
            try {
              await api("/api/feedback", {
                method: "POST",
                body: JSON.stringify({ prompt: previousUser.content, rating })
              });
              state.feedback.push({ id: "local-" + Date.now(), prompt: previousUser.content, rating, note: "", createdAt: new Date().toISOString() });
              toast("Feedback saved. It can guide future replies.");
              renderChats();
            } catch (error) { toast(error.message, true); }
            finally { action.disabled = false; }
          });
          feedback.append(action);
        }
        wrap.append(feedback);
      }
    }
    row.append(mark, wrap);
    target.append(row);
  }
  target.scrollTop = target.scrollHeight;
}

function renderMemories() {
  const target = $("#memory-list");
  target.replaceChildren();
  $("#memory-count").textContent = state.memories.length + " saved";
  if (!state.memories.length) {
    target.append(makeEmpty("No saved memories yet. Add a preference, goal, or useful fact above."));
    return;
  }
  for (const item of [...state.memories].reverse()) {
    const row = document.createElement("article");
    row.className = "list-item";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = item.content;
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    meta.textContent = (item.category || "fact") + " · " + new Date(item.createdAt).toLocaleDateString();
    main.append(title, meta);
    const del = document.createElement("button");
    del.className = "item-action";
    del.type = "button";
    del.textContent = "Delete";
    del.setAttribute("aria-label", "Delete saved memory");
    del.addEventListener("click", async () => {
      if (!confirm("Delete this saved memory?")) return;
      try {
        await api("/api/memories/" + encodeURIComponent(item.id), { method: "DELETE" });
        state.memories = state.memories.filter((m) => m.id !== item.id);
        renderMemories();
        toast("Memory deleted.");
      } catch (error) { toast(error.message, true); }
    });
    row.append(main, del);
    target.append(row);
  }
}

function renderSkills() {
  const target = $("#skill-list");
  if (!target) return;
  target.replaceChildren();
  if (!state.skills.length) {
    target.append(makeEmpty("No custom skills saved. Add a short, safe instruction that JARVIS can use as context."));
    return;
  }
  for (const skill of [...state.skills].reverse()) {
    const row = document.createElement("article");
    row.className = "list-item";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = skill.name;
    const details = document.createElement("p");
    details.textContent = skill.instructions;
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    meta.textContent = "Saved instruction · " + new Date(skill.createdAt).toLocaleDateString();
    main.append(title, details, meta);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "item-action";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      if (!confirm("Delete this skill?")) return;
      try {
        await api("/api/skills/" + encodeURIComponent(skill.id), { method: "DELETE" });
        state.skills = state.skills.filter((entry) => entry.id !== skill.id);
        renderSkills();
        toast("Skill deleted.");
      } catch (error) { toast(error.message, true); }
    });
    row.append(main, del);
    target.append(row);
  }
}

function renderTasks() {
  const target = $("#task-list");
  target.replaceChildren();
  $("#task-count").textContent = state.tasks.filter((item) => !item.done).length;
  if (!state.tasks.length) {
    target.append(makeEmpty("Your list is clear. Add one small next step above."));
    return;
  }
  const sorted = [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done) || String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const item of sorted) {
    const row = document.createElement("article");
    row.className = "list-item" + (item.done ? " completed" : "");
    const check = document.createElement("input");
    check.className = "task-check";
    check.type = "checkbox";
    check.checked = Boolean(item.done);
    check.setAttribute("aria-label", "Mark task complete");
    check.addEventListener("change", async () => {
      try {
        await api("/api/tasks/" + encodeURIComponent(item.id), { method: "PATCH", body: JSON.stringify({ done: check.checked }) });
        item.done = check.checked;
        renderTasks();
      } catch (error) { check.checked = !check.checked; toast(error.message, true); }
    });
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = item.title;
    main.append(title);
    if (item.description) {
      const description = document.createElement("p");
      description.textContent = item.description;
      main.append(description);
    }
    if (item.dueAt) {
      const due = document.createElement("div");
      due.className = "list-item-meta";
      const parsed = new Date(item.dueAt);
      due.textContent = "Due: " + (Number.isNaN(parsed.getTime()) ? item.dueAt : parsed.toLocaleString());
      main.append(due);
    }
    const del = document.createElement("button");
    del.type = "button";
    del.className = "item-action";
    del.textContent = "Remove";
    del.addEventListener("click", async () => {
      if (!confirm("Remove this task?")) return;
      try {
        await api("/api/tasks/" + encodeURIComponent(item.id), { method: "DELETE" });
        state.tasks = state.tasks.filter((task) => task.id !== item.id);
        renderTasks();
        toast("Task removed.");
      } catch (error) { toast(error.message, true); }
    });
    row.append(check, main, del);
    target.append(row);
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#login-button");
  button.disabled = true;
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
    $("#password").value = "";
    showApp();
    await refreshState();
    toast("Workspace unlocked.");
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

$("#logout-button").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST", body: JSON.stringify({}) }); } catch { /* always return to sign-in */ }
  state.chats = [];
  state.memories = [];
  state.tasks = [];
  showLogin();
  toast("Signed out.");
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll(".prompt-card").forEach((button) => {
  button.addEventListener("click", () => {
    $("#chat-input").value = button.dataset.prompt || "";
    setView("chat");
    $("#chat-input").focus();
  });
});

$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#chat-input");
  const button = $("#send-button");
  const message = input.value.trim();
  if (!message || button.disabled) return;
  input.value = "";
  button.disabled = true;
  const tempId = "pending-" + Date.now();
  state.chats.push({ id: tempId, role: "user", content: message, createdAt: new Date().toISOString() });
  renderChats();
  const waiting = document.createElement("article");
  waiting.className = "message assistant";
  const mark = document.createElement("div");
  mark.className = "message-mark";
  mark.textContent = "J";
  const wrap = document.createElement("div");
  wrap.className = "message-wrap";
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = "Thinking…";
  wrap.append(body);
  waiting.append(mark, wrap);
  $("#chat-messages").append(waiting);
  try {
    const data = await api("/api/chat", { method: "POST", body: JSON.stringify({ message }) });
    if ($("#speak-toggle").checked && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(data.answer));
    }
    await refreshState();
  } catch (error) {
    waiting.remove();
    const err = document.createElement("article");
    err.className = "message assistant";
    const errorMark = document.createElement("div");
    errorMark.className = "message-mark";
    errorMark.textContent = "!";
    const errorWrap = document.createElement("div");
    errorWrap.className = "message-wrap";
    const errorBody = document.createElement("div");
    errorBody.className = "message-body";
    errorBody.textContent = error.message;
    errorWrap.append(errorBody);
    err.append(errorMark, errorWrap);
    $("#chat-messages").append(err);
    toast(error.message, true);
  } finally {
    button.disabled = false;
    input.focus();
  }
});

$("#chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

$("#memory-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const data = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ content: $("#memory-content").value, category: $("#memory-category").value })
    });
    state.memories.push(data.memory);
    $("#memory-content").value = "";
    renderMemories();
    toast("Memory saved.");
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

$("#skill-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const data = await api("/api/skills", {
      method: "POST",
      body: JSON.stringify({
        name: $("#skill-name").value,
        instructions: $("#skill-instructions").value
      })
    });
    state.skills.push(data.skill);
    $("#skill-name").value = "";
    $("#skill-instructions").value = "";
    renderSkills();
    toast("Skill saved. The built-in rules can use saved preferences where supported.");
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const data = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: $("#task-title").value,
        description: $("#task-description").value,
        dueAt: $("#task-due").value
      })
    });
    state.tasks.push(data.task);
    $("#task-title").value = "";
    $("#task-description").value = "";
    $("#task-due").value = "";
    renderTasks();
    toast("Task added.");
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

$("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#search-button");
  const target = $("#search-results");
  button.disabled = true;
  target.replaceChildren();
  target.append(makeEmpty("Searching the embedded offline knowledge base…"));
  try {
    const query = $("#search-input").value.trim();
    const data = await api("/api/search?q=" + encodeURIComponent(query));
    target.replaceChildren();
    if (!data.results.length) target.append(makeEmpty("No results were returned for that query."));
    for (const result of data.results) {
      const card = document.createElement("article");
      card.className = "result-card";
      const title = result.url ? document.createElement("a") : document.createElement("strong");
      if (result.url) {
        title.href = result.url;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
      }
      title.textContent = result.title;
      const snippet = document.createElement("p");
      snippet.textContent = result.snippet || "No description available.";
      const url = document.createElement("div");
      url.className = "result-url";
      url.textContent = result.url;
      card.append(title, snippet, url);
      target.append(card);
    }
  } catch (error) {
    target.replaceChildren();
    target.append(makeEmpty(error.message));
    toast(error.message, true);
  } finally { button.disabled = false; }
});

$("#voice-button").addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast("Voice input is not supported in this browser. You can type your message instead.", true);
    return;
  }
  const button = $("#voice-button");
  const recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  button.disabled = true;
  button.textContent = "Listening…";
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    $("#chat-input").value = ($("#chat-input").value + " " + transcript).trim();
    $("#chat-input").focus();
  };
  recognition.onerror = () => toast("Voice input was unavailable. Check browser microphone permissions.", true);
  recognition.onend = () => {
    button.disabled = false;
    button.innerHTML = "🎙 <span>Voice</span>";
  };
  try { recognition.start(); } catch {
    button.disabled = false;
    button.innerHTML = "🎙 <span>Voice</span>";
    toast("Could not start voice input.", true);
  }
});


async function refreshDevices() {
  const data = await api("/api/devices");
  state.devices = Array.isArray(data.devices) ? data.devices : [];
  renderDevices();
}

function renderDevices() {
  const target = $("#device-list");
  if (!target) return;
  target.replaceChildren();
  if (!state.devices.length) {
    target.append(makeEmpty("No paired devices yet. Generate a code above to connect your Android Companion."));
    return;
  }

  for (const device of state.devices) {
    const row = document.createElement("article");
    row.className = "list-item";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = device.name || device.model || "Android device";
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    const modelText = [device.manufacturer, device.model].filter(Boolean).join(" ");
    const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Not checked in yet";
    meta.textContent = [modelText, "Last seen: " + lastSeen, device.accessibilityEnabled ? "Accessibility enabled" : "Accessibility not enabled"].filter(Boolean).join(" · ");
    main.append(title, meta);

    const status = document.createElement("span");
    status.className = "device-status";
    status.textContent = device.revokedAt ? "Revoked" : "Paired";
    if (device.revokedAt) status.classList.add("revoked");

    const actions = document.createElement("div");
    actions.className = "device-actions";
    actions.append(status);
    if (!device.revokedAt) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "item-action";
      revoke.textContent = "Revoke";
      revoke.addEventListener("click", async () => {
        if (!confirm("Revoke this device? Its saved device credential will stop working.")) return;
        revoke.disabled = true;
        try {
          await api("/api/devices/" + encodeURIComponent(device.id), { method: "DELETE" });
          await refreshDevices();
          toast("Device access revoked.");
        } catch (error) {
          toast(error.message, true);
          revoke.disabled = false;
        }
      });
      actions.append(revoke);
    }
    row.append(main, actions);
    target.append(row);
  }
}

async function generatePairingCode() {
  const button = $("#create-pairing-code");
  const panel = $("#pairing-code-panel");
  button.disabled = true;
  try {
    const data = await api("/api/devices/pairing-challenges", {
      method: "POST",
      body: JSON.stringify({})
    });
    $("#pairing-code-value").textContent = data.code;
    $("#pairing-code-expiry").textContent = "Expires: " + new Date(data.expiresAt).toLocaleTimeString();
    panel.classList.remove("hidden");
    toast("One-time pairing code created.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

$("#create-pairing-code").addEventListener("click", generatePairingCode);
$("#refresh-devices").addEventListener("click", () => refreshDevices().catch((error) => toast(error.message, true)));

boot();
