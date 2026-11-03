(() => {
  const STORAGE_KEY = "demo-site-laptop-session-v1";
  const HOUR_MS = 60 * 60 * 1000;
  const elapsedEl = document.querySelector("#elapsed-time");
  const startedEl = document.querySelector("#started-at");
  const finishedEl = document.querySelector("#finished-at");
  const statusEl = document.querySelector("#session-status");
  const noteEl = document.querySelector("#notification-note");
  const startButton = document.querySelector("#start-session");
  const finishButton = document.querySelector("#finish-session");

  let session = readSession();

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    } catch {
      return null;
    }
  }

  function saveSession() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  function formatTime(timestamp) {
    if (!timestamp) return "—";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(timestamp));
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return [hours, minutes, remainder]
      .map(value => String(value).padStart(2, "0"))
      .join(":");
  }

  function requestNotifications() {
    if (!("Notification" in window)) {
      noteEl.textContent = "This browser does not support desktop notifications. Your session time will still be recorded.";
      return Promise.resolve(false);
    }
    if (Notification.permission === "granted") return Promise.resolve(true);
    if (Notification.permission === "denied") {
      noteEl.textContent = "Notifications are blocked. Allow them for this site in your browser settings to receive hourly reminders.";
      return Promise.resolve(false);
    }
    return Notification.requestPermission().then(permission => {
      if (permission !== "granted") {
        noteEl.textContent = "Notifications are off. You can allow them for this site in your browser settings.";
      }
      return permission === "granted";
    });
  }

  function notifyElapsedHour(hours) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const hourLabel = hours === 1 ? "hour" : "hours";
    new Notification("Laptop time reminder", {
      body: `You’ve been in this session for ${hours} ${hourLabel}.`,
      tag: "laptop-session-hourly"
    });
  }

  function update() {
    const running = Boolean(session && !session.finishedAt);
    const end = running ? Date.now() : session?.finishedAt;
    const elapsed = session ? end - session.startedAt : 0;

    elapsedEl.textContent = formatDuration(elapsed);
    startedEl.textContent = formatTime(session?.startedAt);
    finishedEl.textContent = formatTime(session?.finishedAt);
    statusEl.textContent = running ? "Session in progress" : session?.finishedAt ? "Session complete" : "Ready when you are";
    startButton.disabled = running;
    startButton.textContent = session?.finishedAt ? "Start a new session" : "Start session";
    finishButton.disabled = !running;

    if (running) {
      const hoursElapsed = Math.floor(elapsed / HOUR_MS);
      if (hoursElapsed > (session.notifiedHours || 0)) {
        session.notifiedHours = hoursElapsed;
        saveSession();
        notifyElapsedHour(hoursElapsed);
      }
    }
  }

  startButton.addEventListener("click", async () => {
    await requestNotifications();
    session = { startedAt: Date.now(), finishedAt: null, notifiedHours: 0 };
    saveSession();
    update();
  });

  finishButton.addEventListener("click", () => {
    if (!session || session.finishedAt) return;
    session.finishedAt = Date.now();
    saveSession();
    update();
  });

  if (!("Notification" in window)) {
    noteEl.textContent = "This browser does not support desktop notifications. Your session time will still be recorded.";
  } else if (Notification.permission === "denied") {
    noteEl.textContent = "Notifications are blocked. Allow them for this site in your browser settings to receive hourly reminders.";
  }

  update();
  window.setInterval(update, 1000);
})();
