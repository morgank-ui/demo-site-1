(() => {
  const STORAGE_KEY = "demo-site-laptop-session-v1";
  const HOUR_MS = 60 * 60 * 1000;
  const MAX_TICK_GAP_MS = 90 * 1000;

  const elapsedEl = document.querySelector("#elapsed-time");
  const startedEl = document.querySelector("#started-at");
  const finishedEl = document.querySelector("#finished-at");
  const statusEl = document.querySelector("#session-status");
  const noteEl = document.querySelector("#notification-note");
  const startButton = document.querySelector("#start-session");
  const pauseButton = document.querySelector("#pause-session");
  const resumeButton = document.querySelector("#resume-session");
  const finishButton = document.querySelector("#finish-session");
  const notificationsButton = document.querySelector("#enable-notifications");
  const exportButton = document.querySelector("#export-sessions");
  const historyBody = document.querySelector("#session-history");
  const emptyHistory = document.querySelector("#empty-history");
  const todayTotalEl = document.querySelector("#today-total");
  const weekTotalEl = document.querySelector("#week-total");

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function createSession() {
    const now = Date.now();
    return {
      id: globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(16).slice(2)}`,
      startedAt: now,
      finishedAt: null,
      status: "running",
      activeMs: 0,
      dailyMs: {},
      lastTickAt: now,
      notifiedHours: 0
    };
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && stored.version === 2 && Array.isArray(stored.sessions)) return stored;

      const sessions = [];
      if (stored && typeof stored.startedAt === "number") {
        sessions.push({
          id: `old-${stored.startedAt}`,
          startedAt: stored.startedAt,
          finishedAt: stored.finishedAt || null,
          status: "older record",
          activeMs: null,
          dailyMs: {},
          lastTickAt: null,
          notifiedHours: stored.notifiedHours || 0,
          legacy: true
        });
      }
      return { version: 2, sessions, activeId: null };
    } catch {
      return { version: 2, sessions: [], activeId: null };
    }
  }

  const state = loadState();
  let activeSession = state.sessions.find(session => session.id === state.activeId) || null;
  if (!activeSession || !["running", "paused"].includes(activeSession.status)) {
    activeSession = createSession();
    state.sessions.push(activeSession);
    state.activeId = activeSession.id;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function formatTime(timestamp) {
    if (!timestamp) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(timestamp));
  }

  function formatDuration(milliseconds) {
    if (milliseconds == null) return "Not available";
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder].map(value => String(value).padStart(2, "0")).join(":");
  }

  function tick() {
    if (activeSession.status !== "running") return;
    const now = Date.now();
    const previousTick = activeSession.lastTickAt || now;
    const gap = now - previousTick;
    if (gap > 0 && gap <= MAX_TICK_GAP_MS) {
      activeSession.activeMs += gap;
      const day = localDateKey(new Date(now));
      activeSession.dailyMs[day] = (activeSession.dailyMs[day] || 0) + gap;
    }
    activeSession.lastTickAt = now;
  }

  function notifyElapsedHour(hours) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const unit = hours === 1 ? "hour" : "hours";
    new Notification("Time Tracker reminder", {
      body: `You have ${hours} tracked ${unit} in this session.`,
      tag: "laptop-session-hourly"
    });
  }

  async function requestNotifications() {
    if (!("Notification" in window)) {
      noteEl.textContent = "This browser does not support desktop notifications. Your session will still be recorded.";
      return;
    }
    if (Notification.permission === "denied") {
      noteEl.textContent = "Notifications are blocked. Allow them for this site in your browser settings.";
      return;
    }
    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    noteEl.textContent = permission === "granted"
      ? "Hourly desktop notifications are enabled. Keep this page open to receive them."
      : "Notifications are off. You can allow them in your browser settings.";
    render();
  }

  function totalForDate(day) {
    return state.sessions.reduce((total, session) => {
      if (session.legacy) return total;
      return total + (session.dailyMs?.[day] || 0);
    }, 0);
  }

  function getWeekStart(date) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayFromMonday = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - dayFromMonday);
    return monday;
  }

  function totalForWeek(date) {
    const start = getWeekStart(date);
    let total = 0;
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + offset);
      total += totalForDate(localDateKey(day));
    }
    return total;
  }

  function sessionDuration(session, now) {
    if (session.legacy) return null;
    let duration = session.activeMs || 0;
    if (session.id === activeSession.id && session.status === "running") {
      const gap = now - (session.lastTickAt || now);
      if (gap > 0 && gap <= MAX_TICK_GAP_MS) duration += gap;
    }
    return duration;
  }

  function addCell(row, text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    row.appendChild(cell);
  }

  function renderHistory() {
    historyBody.replaceChildren();
    const rows = [...state.sessions].sort((a, b) => b.startedAt - a.startedAt);
    emptyHistory.hidden = rows.length !== 0;

    for (const session of rows) {
      const row = document.createElement("tr");
      const status = session.legacy ? "Older record" : session.status;
      addCell(row, formatTime(session.startedAt));
      addCell(row, formatTime(session.finishedAt));
      addCell(row, formatDuration(sessionDuration(session, Date.now())));
      addCell(row, status.charAt(0).toUpperCase() + status.slice(1));
      historyBody.appendChild(row);
    }
  }

  function render() {
    const now = Date.now();
    const duration = sessionDuration(activeSession, now) || 0;
    const isRunning = activeSession.status === "running";
    const isPaused = activeSession.status === "paused";
    const isFinished = activeSession.status === "finished";

    elapsedEl.textContent = formatDuration(duration);
    startedEl.textContent = formatTime(activeSession.startedAt);
    finishedEl.textContent = formatTime(activeSession.finishedAt);
    statusEl.textContent = isRunning ? "Session in progress" : isPaused ? "Paused for a break" : "Session complete";
    pauseButton.hidden = !isRunning;
    resumeButton.hidden = !isPaused;
    finishButton.disabled = isFinished;
    startButton.hidden = !isFinished;
    notificationsButton.textContent = "Notification" in window && Notification.permission === "granted"
      ? "Notifications enabled"
      : "Enable hourly notifications";
    notificationsButton.disabled = "Notification" in window && Notification.permission === "granted";

    const today = new Date();
    todayTotalEl.textContent = formatDuration(totalForDate(localDateKey(today)));
    weekTotalEl.textContent = formatDuration(totalForWeek(today));
    renderHistory();
  }

  function update() {
    tick();
    const hours = Math.floor(activeSession.activeMs / HOUR_MS);
    if (activeSession.status === "running" && hours > (activeSession.notifiedHours || 0)) {
      activeSession.notifiedHours = hours;
      notifyElapsedHour(hours);
    }
    saveState();
    render();
  }

  pauseButton.addEventListener("click", () => {
    tick();
    activeSession.status = "paused";
    activeSession.lastTickAt = null;
    saveState();
    render();
  });

  resumeButton.addEventListener("click", () => {
    activeSession.status = "running";
    activeSession.lastTickAt = Date.now();
    saveState();
    render();
  });

  finishButton.addEventListener("click", () => {
    if (!["running", "paused"].includes(activeSession.status)) return;
    tick();
    activeSession.status = "finished";
    activeSession.finishedAt = Date.now();
    activeSession.lastTickAt = null;
    state.activeId = null;
    saveState();
    render();
  });

  startButton.addEventListener("click", () => {
    activeSession = createSession();
    state.sessions.push(activeSession);
    state.activeId = activeSession.id;
    saveState();
    render();
  });

  notificationsButton.addEventListener("click", requestNotifications);

  exportButton.addEventListener("click", () => {
    const columns = ["Started", "Finished", "Tracked time", "Status"];
    const quote = value => `"${String(value).replaceAll('"', '""')}"`;
    const lines = [columns.map(quote).join(",")];
    for (const session of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
      lines.push([
        formatTime(session.startedAt),
        formatTime(session.finishedAt),
        formatDuration(sessionDuration(session, Date.now())),
        session.legacy ? "Older record" : session.status
      ].map(quote).join(","));
    }
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "time-tracker-sessions.csv";
    link.click();
    URL.revokeObjectURL(url);
  });

  if (!("Notification" in window)) {
    noteEl.textContent = "This browser does not support desktop notifications. Your session will still be recorded.";
  } else if (Notification.permission === "denied") {
    noteEl.textContent = "Notifications are blocked. Allow them for this site in your browser settings.";
  }

  saveState();
  render();
  window.setInterval(update, 1000);
})();
