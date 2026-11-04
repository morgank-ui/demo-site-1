(() => {
  const STORAGE_KEY = "demo-site-laptop-session-v1";
  const HOUR_MS = 60 * 60 * 1000;
  const MAX_TICK_GAP_MS = 90 * 1000;
  const $ = selector => document.querySelector(selector);
  const elapsedEl = $("#elapsed-time"), startedEl = $("#started-at"), finishedEl = $("#finished-at");
  const statusEl = $("#session-status"), noteEl = $("#notification-note");
  const startButton = $("#start-session"), pauseButton = $("#pause-session"), resumeButton = $("#resume-session");
  const finishButton = $("#finish-session"), notificationsButton = $("#enable-notifications");
  const exportButton = $("#export-sessions"), importButton = $("#choose-import"), importInput = $("#import-sessions");
  const historyBody = $("#session-history"), emptyHistory = $("#empty-history");
  const todayTotalEl = $("#today-total"), weekTotalEl = $("#week-total"), weekChartEl = $("#weekly-chart"), weekLabelEl = $("#chart-week-label");
  const labelSelect = $("#session-label"), noteInput = $("#session-note");
  const goalForm = $("#goal-form"), goalInput = $("#goal-hours"), goalProgress = $("#goal-progress"), goalMessage = $("#goal-message");

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function createSession() {
    const now = Date.now();
    return { id: globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(16).slice(2)}`,
      startedAt: now, finishedAt: null, status: "running", label: "Personal", note: "",
      activeMs: 0, dailyMs: {}, lastTickAt: now, notifiedHours: 0 };
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && stored.version === 3 && Array.isArray(stored.sessions)) {
        for (const session of stored.sessions) {
          session.dailyMs ||= {};
          session.label ||= "Personal";
          session.note ||= "";
        }
        return stored;
      }
      const sessions = [];
      if (stored && typeof stored.startedAt === "number") sessions.push({
        id: `old-${stored.startedAt}`, startedAt: stored.startedAt, finishedAt: stored.finishedAt || null,
        status: "older record", activeMs: null, dailyMs: {}, label: "Personal", note: "",
        lastTickAt: null, notifiedHours: stored.notifiedHours || 0, legacy: true
      });
      return { version: 3, sessions, activeId: null, goalMinutes: null };
    } catch {
      return { version: 3, sessions: [], activeId: null, goalMinutes: null };
    }
  }

  const state = loadState();
  let activeSession = state.sessions.find(session => session.id === state.activeId) || null;
  if (!activeSession || !["running", "paused"].includes(activeSession.status)) {
    activeSession = createSession();
    state.sessions.push(activeSession);
    state.activeId = activeSession.id;
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function formatTime(timestamp) {
    return timestamp ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp)) : "—";
  }
  function formatDuration(milliseconds) {
    if (milliseconds == null) return "Not available";
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
      .map(value => String(value).padStart(2, "0")).join(":");
  }
  function tick() {
    if (activeSession.status !== "running") return;
    const now = Date.now(), previousTick = activeSession.lastTickAt || now, gap = now - previousTick;
    if (gap > 0 && gap <= MAX_TICK_GAP_MS) {
      activeSession.activeMs += gap;
      const day = localDateKey(new Date(now));
      activeSession.dailyMs[day] = (activeSession.dailyMs[day] || 0) + gap;
    }
    activeSession.lastTickAt = now;
  }
  function notifyElapsedHour(hours) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification("Time Tracker reminder", { body: `You have ${hours} tracked ${hours === 1 ? "hour" : "hours"} in this session.`, tag: "laptop-session-hourly" });
  }
  async function requestNotifications() {
    if (!("Notification" in window)) { noteEl.textContent = "This browser does not support desktop notifications."; return; }
    if (Notification.permission === "denied") { noteEl.textContent = "Notifications are blocked. Allow them for this site in your browser settings."; return; }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    noteEl.textContent = permission === "granted" ? "Hourly notifications are enabled. Keep this page open to receive them." : "Notifications are off. You can allow them in your browser settings.";
    render();
  }
  function totalForDate(day) {
    return state.sessions.reduce((total, session) => total + (session.legacy ? 0 : session.dailyMs?.[day] || 0), 0);
  }
  function getWeekStart(date) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }
  function getWeekDays(date) {
    const monday = getWeekStart(date);
    return Array.from({ length: 7 }, (_, index) => { const day = new Date(monday); day.setDate(monday.getDate() + index); return day; });
  }
  function sessionDuration(session, now) {
    if (session.legacy || session.activeMs == null) return null;
    let duration = session.activeMs;
    if (session.id === activeSession.id && session.status === "running") {
      const gap = now - (session.lastTickAt || now);
      if (gap > 0 && gap <= MAX_TICK_GAP_MS) duration += gap;
    }
    return duration;
  }
  function addCell(row, text) { const cell = document.createElement("td"); cell.textContent = text || "—"; row.appendChild(cell); }
  function renderHistory() {
    historyBody.replaceChildren();
    const rows = [...state.sessions].sort((a, b) => b.startedAt - a.startedAt);
    emptyHistory.hidden = rows.length !== 0;
    for (const session of rows) {
      const row = document.createElement("tr");
      addCell(row, formatTime(session.startedAt));
      addCell(row, formatTime(session.finishedAt));
      addCell(row, formatDuration(sessionDuration(session, Date.now())));
      addCell(row, session.label || "Personal");
      addCell(row, session.note || "—");
      addCell(row, session.legacy ? "Older record" : session.status);
      historyBody.appendChild(row);
    }
  }
  function renderGoal(todayTotal) {
    const goalMinutes = Number(state.goalMinutes);
    if (!Number.isFinite(goalMinutes) || goalMinutes <= 0) {
      goalProgress.hidden = true; goalProgress.value = 0; goalMessage.textContent = "Set a daily goal to see your progress."; return;
    }
    const targetMs = goalMinutes * 60000, percent = Math.min(100, Math.round(todayTotal / targetMs * 100));
    goalProgress.hidden = false; goalProgress.value = percent;
    goalMessage.textContent = todayTotal >= targetMs
      ? `Daily goal reached: ${formatDuration(todayTotal)} of ${formatDuration(targetMs)}.`
      : `${formatDuration(todayTotal)} of ${formatDuration(targetMs)} (${percent}%).`;
  }
  function renderWeeklyChart(days) {
    weekChartEl.replaceChildren();
    const totals = days.map(day => totalForDate(localDateKey(day))), maxValue = Math.max(...totals, 60000);
    days.forEach((day, index) => {
      const total = totals[index], column = document.createElement("div");
      column.className = "chart-column";
      const value = document.createElement("span"); value.className = "chart-value"; value.textContent = formatDuration(total);
      const track = document.createElement("div"); track.className = "chart-track";
      const bar = document.createElement("div"); bar.className = "chart-bar"; bar.style.height = `${total ? Math.max(4, total / maxValue * 100) : 2}%`;
      track.appendChild(bar);
      const label = document.createElement("span"); label.className = "chart-label"; label.textContent = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day);
      column.setAttribute("aria-label", `${label.textContent}: ${formatDuration(total)}`);
      column.append(value, track, label); weekChartEl.appendChild(column);
    });
    const first = days[0], last = days[6];
    weekLabelEl.textContent = `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(first)} – ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(last)}`;
  }
  function render() {
    const now = Date.now(), duration = sessionDuration(activeSession, now) || 0;
    const isRunning = activeSession.status === "running", isPaused = activeSession.status === "paused", isFinished = activeSession.status === "finished";
    elapsedEl.textContent = formatDuration(duration); startedEl.textContent = formatTime(activeSession.startedAt); finishedEl.textContent = formatTime(activeSession.finishedAt);
    statusEl.textContent = isRunning ? "Session in progress" : isPaused ? "Paused for a break" : "Session complete";
    pauseButton.hidden = !isRunning; resumeButton.hidden = !isPaused; finishButton.disabled = isFinished; startButton.hidden = !isFinished;
    if (document.activeElement !== labelSelect) labelSelect.value = activeSession.label || "Personal";
    if (document.activeElement !== noteInput) noteInput.value = activeSession.note || "";
    const permissionGranted = "Notification" in window && Notification.permission === "granted";
    notificationsButton.textContent = permissionGranted ? "Notifications enabled" : "Enable hourly notifications";
    notificationsButton.disabled = permissionGranted;
    const today = new Date(), todayTotal = totalForDate(localDateKey(today)), weekDays = getWeekDays(today);
    todayTotalEl.textContent = formatDuration(todayTotal);
    weekTotalEl.textContent = formatDuration(weekDays.reduce((sum, day) => sum + totalForDate(localDateKey(day)), 0));
    renderGoal(todayTotal); renderWeeklyChart(weekDays); renderHistory();
  }
  function update() {
    tick();
    const hours = Math.floor(activeSession.activeMs / HOUR_MS);
    if (activeSession.status === "running" && hours > (activeSession.notifiedHours || 0)) {
      activeSession.notifiedHours = hours; notifyElapsedHour(hours);
    }
    saveState(); render();
  }
  function csvEscape(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
  function parseCsv(text) {
    const rows = []; let row = [], field = "", quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
        else if (character === '"') quoted = false;
        else field += character;
      } else if (character === '"') quoted = true;
      else if (character === ",") { row.push(field); field = ""; }
      else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = "";
      } else field += character;
    }
    row.push(field); if (row.some(value => value.trim())) rows.push(row);
    return rows;
  }
  function parseDuration(value) {
    const match = String(value || "").trim().match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
    return match ? (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 : null;
  }
  function parseTimestamp(value, epochValue) {
    const epoch = Number(epochValue);
    if (Number.isFinite(epoch) && epoch > 0) return epoch;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  function sessionIdentity(session) {
    return session.id || [session.startedAt, session.finishedAt, session.activeMs, session.label, session.note].join("|");
  }
  async function importCsv(file) {
    const text = (await file.text()).replace(/^\uFEFF/, ""), rows = parseCsv(text);
    if (rows.length < 2) throw new Error("The CSV file has no session rows.");
    const headers = rows[0].map(value => value.trim().toLowerCase());
    const col = (...names) => headers.findIndex(header => names.includes(header));
    const startCol = col("started", "started at", "started at (local)");
    if (startCol < 0) throw new Error("This CSV needs a Started or Started at column.");
    const finishCol = col("finished", "finished at", "finished at (local)"), durationCol = col("tracked time", "tracked duration", "active time");
    const startIsoCol = col("started at (iso)", "started iso"), finishIsoCol = col("finished at (iso)", "finished iso");
    const statusCol = col("status"), labelCol = col("type", "label"), noteCol = col("notes", "note");
    const idCol = col("session id", "id"), dailyCol = col("daily totals (json)", "daily breakdown (json)", "daily breakdown");
    const goalCol = col("daily goal (minutes)"), imported = [];
    for (const values of rows.slice(1)) {
      const startedAt = parseTimestamp(values[startCol], startIsoCol >= 0 ? values[startIsoCol] : "");
      if (!startedAt) continue;
      const finishedAt = finishCol >= 0 ? parseTimestamp(values[finishCol], finishIsoCol >= 0 ? values[finishIsoCol] : "") : null;
      const activeMs = durationCol >= 0 ? parseDuration(values[durationCol]) : null;
      let dailyMs = {};
      if (dailyCol >= 0 && values[dailyCol]) {
        try {
          const parsed = JSON.parse(values[dailyCol]);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            dailyMs = Object.fromEntries(Object.entries(parsed).filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0).map(([key, value]) => [key, Number(value)]));
          }
        } catch { /* Fall back to the duration and start date. */ }
      }
      if (!Object.keys(dailyMs).length && activeMs != null) dailyMs[localDateKey(new Date(startedAt))] = activeMs;
      const rawStatus = statusCol >= 0 ? (values[statusCol] || "finished").trim().toLowerCase() : "finished";
      const status = ["running", "paused"].includes(rawStatus) ? "imported" : rawStatus || "finished";
      imported.push({
        id: idCol >= 0 && values[idCol] ? values[idCol] : `import-${startedAt}-${imported.length}`,
        startedAt, finishedAt, status, label: labelCol >= 0 ? values[labelCol] || "Personal" : "Personal",
        note: noteCol >= 0 ? values[noteCol] || "" : "", activeMs, dailyMs,
        lastTickAt: null, notifiedHours: 0, legacy: activeMs == null
      });
    }
    if (!imported.length) throw new Error("No rows had a readable start time.");
    const existing = new Set(state.sessions.map(sessionIdentity));
    const uniqueRows = imported.filter(session => !existing.has(sessionIdentity(session)));
    const duplicates = imported.length - uniqueRows.length;
    if (!window.confirm(`Import ${imported.length} session row(s)? ${uniqueRows.length} will be added and ${duplicates} duplicate(s) skipped. Existing records will be kept.`)) return;
    state.sessions.push(...uniqueRows);
    const importedGoal = goalCol >= 0 ? Number(rows[1][goalCol]) : NaN;
    if (Number.isFinite(importedGoal) && importedGoal > 0 && !state.goalMinutes) state.goalMinutes = importedGoal;
    goalInput.value = state.goalMinutes ? String(state.goalMinutes / 60) : "";
    saveState(); render(); noteEl.textContent = `Imported ${uniqueRows.length} session(s); skipped ${duplicates} duplicate(s).`;
  }

  pauseButton.addEventListener("click", () => {
    tick(); activeSession.status = "paused"; activeSession.lastTickAt = null; saveState(); render();
  });
  resumeButton.addEventListener("click", () => {
    activeSession.status = "running"; activeSession.lastTickAt = Date.now(); saveState(); render();
  });
  finishButton.addEventListener("click", () => {
    if (!["running", "paused"].includes(activeSession.status)) return;
    tick(); activeSession.status = "finished"; activeSession.finishedAt = Date.now(); activeSession.lastTickAt = null;
    state.activeId = null; saveState(); render();
  });
  startButton.addEventListener("click", () => {
    activeSession = createSession(); state.sessions.push(activeSession); state.activeId = activeSession.id; saveState(); render();
  });
  labelSelect.addEventListener("change", () => { activeSession.label = labelSelect.value; saveState(); renderHistory(); });
  noteInput.addEventListener("input", () => { activeSession.note = noteInput.value; saveState(); renderHistory(); });
  goalForm.addEventListener("submit", event => {
    event.preventDefault();
    const hours = Number(goalInput.value);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) { goalMessage.textContent = "Enter a goal between 0.25 and 24 hours."; return; }
    state.goalMinutes = Math.round(hours * 60); saveState(); render();
  });
  notificationsButton.addEventListener("click", requestNotifications);
  exportButton.addEventListener("click", () => {
    const columns = ["Started at (local)", "Finished at (local)", "Tracked time", "Status", "Type", "Notes", "Session ID", "Started at (ISO)", "Finished at (ISO)", "Daily totals (JSON)", "Daily goal (minutes)"];
    const lines = [columns.map(csvEscape).join(",")];
    for (const session of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
      lines.push([formatTime(session.startedAt), formatTime(session.finishedAt), formatDuration(sessionDuration(session, Date.now())),
        session.legacy ? "Older record" : session.status, session.label || "Personal", session.note || "", session.id,
        session.startedAt ? new Date(session.startedAt).toISOString() : "", session.finishedAt ? new Date(session.finishedAt).toISOString() : "",
        JSON.stringify(session.dailyMs || {}), state.goalMinutes || ""].map(csvEscape).join(","));
    }
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "time-tracker-sessions.csv"; link.click(); URL.revokeObjectURL(url);
  });
  importButton.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0]; if (!file) return;
    try { await importCsv(file); }
    catch (error) { window.alert(error instanceof Error ? error.message : "Could not import this CSV file."); }
    finally { importInput.value = ""; }
  });

  goalInput.value = Number.isFinite(Number(state.goalMinutes)) && state.goalMinutes > 0 ? String(state.goalMinutes / 60) : "";
  if (!("Notification" in window)) noteEl.textContent = "This browser does not support desktop notifications. Your session will still be recorded.";
  else if (Notification.permission === "denied") noteEl.textContent = "Notifications are blocked. Allow them for this site in your browser settings.";
  saveState(); render(); window.setInterval(update, 1000);
})();
