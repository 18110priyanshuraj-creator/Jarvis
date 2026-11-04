const state = {
  view: "chat",
  messages: [
    { role: "assistant", content: "Online. I can help you think through ideas, explain topics, and organize your work. What would you like to do?" }
  ],
  tasks: [],
  memories: [],
  loaded: { tasks: false, memory: false, system: false },
  sending: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let toastHandle;

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => node.classList.remove("show"), 3400);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });

  if (response.status === 401 || response.type === "opaqueredirect") {
    let payload = {};
    try { payload = await response.json(); } catch {}
    window.location.assign(payload.login_url || "https://hatchable.com/console/login");
    throw new Error("Sign in to your Hatchable account to use this private workspace.");
  }

  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
  return payload;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setView(view) {
  state.view = view;
  $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach(section => section.classList.toggle("active", section.id === "view-" + view));
  const titles = {
    chat: ["PERSONAL ASSISTANT", "Good to have you back."],
    tasks: ["PERSONAL ORGANIZER", "Tasks & priorities."],
    memory: ["SELECTIVE MEMORY", "Your saved notes."],
    system: ["DIAGNOSTICS", "System status."]
  };
  $("#page-kicker").textContent = titles[view][0];
  $("#page-title").textContent = titles[view][1];
  if (view === "tasks" && !state.loaded.tasks) loadTasks();
  if (view === "memory" && !state.loaded.memory) loadMemories();
  if (view === "system") loadSystem();
}

function renderChat() {
  const container = $("#chat-messages");
  container.replaceChildren();
  for (const message of state.messages) {
    const row = el("div", "message " + (message.role === "user" ? "user-message" : "assistant-message"));
    const avatar = el("div", "message-avatar", message.role === "user" ? "Y" : "J");
    const body = el("div", "message-body");
    body.append(el("span", "message-name", message.role === "user" ? "YOU" : "JARVIS"));
    body.append(el("p", "", message.content));
    row.append(avatar, body);
    container.append(row);
  }
  container.scrollTop = container.scrollHeight;
}

async function sendChat() {
  const input = $("#chat-input");
  const content = input.value.trim();
  if (!content || state.sending) return;
  input.value = "";
  state.messages.push({ role: "user", content });
  renderChat();
  state.sending = true;
  $("#send-button").disabled = true;
  $("#assistant-status").textContent = "PROCESSING REQUEST";
  const pending = el("div", "message assistant-message pending");
  pending.append(el("div", "message-avatar", "J"));
  const pendingBody = el("div", "message-body");
  pendingBody.append(el("span", "message-name", "JARVIS"));
  pendingBody.append(el("p", "", "Thinking…"));
  pending.append(pendingBody);
  $("#chat-messages").append(pending);
  $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;

  try {
    const result = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: state.messages.slice(-12) })
    });
    state.messages.push({ role: "assistant", content: result.reply });
  } catch (error) {
    toast(error.message);
    state.messages.push({ role: "assistant", content: "I couldn't complete that response. Check the AI setup in Hatchable and try again." });
  } finally {
    state.sending = false;
    $("#send-button").disabled = false;
    $("#assistant-status").textContent = "READY WHEN YOU ARE";
    renderChat();
    input.focus();
  }
}

function renderTasks() {
  const list = $("#task-list");
  list.replaceChildren();
  const open = state.tasks.filter(task => task.status === "open");
  $("#task-count").textContent = String(open.length);
  $("#open-task-count").textContent = open.length + " OPEN";
  if (!state.tasks.length) {
    list.append(el("p", "empty-state", "No tasks yet. Add a task to give your day a starting point."));
    return;
  }
  for (const task of state.tasks) {
    const card = el("div", "item-card");
    const main = el("div", "item-main");
    main.append(el("div", "item-title", task.title));
    if (task.description) main.append(el("p", "item-description", task.description));
    const meta = el("div", "item-meta");
    meta.append(el("span", "tag " + (task.priority === "high" ? "high" : ""), task.priority));
    meta.append(el("span", "tag " + (task.status === "done" ? "done" : ""), task.status));
    main.append(meta);
    card.append(main);
    if (task.status === "open") {
      const action = el("button", "item-action", "Done");
      action.type = "button";
      action.addEventListener("click", () => completeTask(task.id));
      card.append(action);
    }
    list.append(card);
  }
}

async function loadTasks() {
  try {
    const result = await api("/api/tasks");
    state.tasks = result.tasks || [];
    state.loaded.tasks = true;
    renderTasks();
  } catch (error) { toast(error.message); }
}

async function completeTask(id) {
  try {
    const result = await api("/api/tasks/" + encodeURIComponent(id), {
      method: "PATCH", body: JSON.stringify({ status: "done" })
    });
    state.tasks = state.tasks.map(task => String(task.id) === String(id) ? result.task : task);
    renderTasks();
  } catch (error) { toast(error.message); }
}

function renderMemories() {
  const list = $("#memory-list");
  list.replaceChildren();
  $("#memory-count").textContent = state.memories.length + " NOTES";
  if (!state.memories.length) {
    list.append(el("p", "empty-state", "Your memory library is empty. Save a note only when you deliberately want to keep it."));
    return;
  }
  for (const memory of state.memories) {
    const card = el("div", "item-card");
    const main = el("div", "item-main");
    main.append(el("div", "item-title", memory.title));
    main.append(el("p", "item-description", memory.content));
    main.append(el("div", "item-meta")).append(el("span", "tag", memory.category));
    const remove = el("button", "item-action danger", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => deleteMemory(memory.id));
    card.append(main, remove);
    list.append(card);
  }
}

async function loadMemories() {
  try {
    const result = await api("/api/memories");
    state.memories = result.memories || [];
    state.loaded.memory = true;
    renderMemories();
  } catch (error) { toast(error.message); }
}

async function deleteMemory(id) {
  try {
    await api("/api/memories/" + encodeURIComponent(id), { method: "DELETE" });
    state.memories = state.memories.filter(item => String(item.id) !== String(id));
    renderMemories();
    toast("Note deleted.");
  } catch (error) { toast(error.message); }
}

async function loadSystem() {
  const root = $("#system-status");
  root.replaceChildren(el("p", "empty-state", "Checking services…"));
  try {
    const result = await api("/api/health");
    root.replaceChildren();
    const cells = [
      ["APPLICATION", "Online", "The JARVIS Hatchable dashboard is responding.", true],
      ["DATABASE", result.database ? "Connected" : "Unavailable", "Persistent task and note storage.", !!result.database],
      ["AI PROVIDER", result.aiConfigured === true ? "Configured" : "Provider check pending", result.aiConfigured === true ? "The AI provider is connected." : "The capability is declared; a chat request verifies provider availability. Configure an AI provider if chat is unavailable.", true],
      ["ACCESS", "Owner only", "Workspace APIs are gated to the project owner and admin collaborators.", true],
      ["CHAT STORAGE", "Session only", "Conversation turns are kept in this browser tab and are not written to the database.", true],
      ["MIGRATION", "Core edition", "Android companion and original Node-only modules remain separate.", true]
    ];
    for (const [label, value, detail, ready] of cells) {
      const cell = el("div", "system-cell");
      cell.append(el("span", "", label));
      cell.append(el("strong", ready ? "ready" : "pending", value));
      cell.append(el("p", "", detail));
      root.append(cell);
    }
    state.loaded.system = true;
  } catch (error) {
    root.replaceChildren(el("p", "empty-state", error.message));
  }
}

$("#chat-form").addEventListener("submit", event => {
  event.preventDefault();
  sendChat();
});
$("#chat-input").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChat();
  }
});
$("#clear-chat").addEventListener("click", () => {
  state.messages = [{ role: "assistant", content: "Conversation cleared. I'm ready for a new question." }];
  renderChat();
});
$$(".nav-item").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));

$("#task-form").addEventListener("submit", async event => {
  event.preventDefault();
  const title = $("#task-title").value.trim();
  if (!title) return;
  try {
    const result = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title,
        description: $("#task-description").value.trim(),
        priority: $("#task-priority").value
      })
    });
    state.tasks.unshift(result.task);
    state.loaded.tasks = true;
    renderTasks();
    event.currentTarget.reset();
    toast("Task added.");
  } catch (error) { toast(error.message); }
});

$("#memory-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const result = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({
        title: $("#memory-title").value.trim(),
        content: $("#memory-content").value.trim(),
        category: $("#memory-category").value
      })
    });
    state.memories.unshift(result.memory);
    state.loaded.memory = true;
    renderMemories();
    event.currentTarget.reset();
    toast("Note saved.");
  } catch (error) { toast(error.message); }
});

$("#refresh-status").addEventListener("click", loadSystem);
renderChat();
setView("chat");