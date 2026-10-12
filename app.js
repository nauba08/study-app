"use strict";

// ============================================================================
// Storage (everything you tick, time or rate stays on this device only)
// ============================================================================
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

// ============================================================================
// Dates (all local time, "YYYY-MM-DD")
// ============================================================================
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysUntil = (s) => Math.round((parseDay(s) - parseDay(today())) / 86400000);
const fmtDay = (s) => parseDay(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
function relDays(n) {
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `${n} days` : `${-n} days ago`;
}

// ============================================================================
// Helpers
// ============================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

let DATA = { classes: [], deadlines: [], cards: [] };
const cls = (id) => DATA.classes.find((c) => c.id === id) || { id: "all", short: "All", name: "All classes", color: "#8b91a1" };

function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ============================================================================
// Deadlines
// ============================================================================
const dlDone = () => store.get("dlDone", {});
const isDone = (d) => d.done || !!dlDone()[d.id];

// How many days before a deadline it starts showing up on your to-do list
const LEAD = { Exam: 21, Midterm: 14, "Practice midterm": 5, Assignment: 10, Lab: 5, Homework: 5, Quiz: 4 };
const TEST_TYPES = new Set(["Exam", "Midterm", "Practice midterm", "Quiz"]);

// ============================================================================
// Pomodoro log
// ============================================================================
const pomoLog = () => store.get("pomoLog", []);
const minutesToday = () => pomoLog().filter((l) => l.d === today()).reduce((a, l) => a + l.min, 0);
function lastStudied(clsId) {
  const days = pomoLog().filter((l) => l.cls === clsId).map((l) => l.d).sort();
  return days.length ? days[days.length - 1] : null;
}

// ============================================================================
// Flashcard scheduling (simple spaced repetition)
// ============================================================================
const INTERVALS = [0, 1, 2, 4, 8, 16, 32, 60]; // days, by box
const NEW_PER_DAY = 25;
const srs = () => store.get("srs", {});
const newSeenToday = () => store.get("newSeen", {})[today()] || 0;
// deck is "all", a class id, or "note:<topic note name>"
function cardsFor(deck, kind) {
  const topic = deck.startsWith("note:") ? deck.slice(5) : null;
  return DATA.cards.filter((c) => (deck === "all" || c.cls === deck || c.note === topic) && (kind === "both" || c.kind === kind));
}
function deckCounts(deck, kind) {
  const s = srs(), t = today();
  let due = 0, fresh = 0;
  for (const c of cardsFor(deck, kind)) {
    const st = s[c.id];
    if (!st) fresh++;
    else if (st.due <= t) due++;
  }
  return { due, fresh };
}
const newAllowance = () => Math.max(0, NEW_PER_DAY - newSeenToday());

// ============================================================================
// Today: build the daily plan
// ============================================================================
function buildPlan() {
  const t = today();
  const tasks = [];
  // During a break (e.g. Reading Week) look further ahead
  const brk = DATA.deadlines.find((d) => d.type === "Break" && d.due <= t && t <= addDays(d.due, 4));
  const stretch = brk ? 1.5 : 1;

  for (const d of DATA.deadlines) {
    if (d.cls === "all" || isDone(d)) continue;
    const left = daysUntil(d.due);
    const lead = Math.round((LEAD[d.type] ?? 5) * stretch);
    if (left < 0 || left > lead) continue;
    const test = TEST_TYPES.has(d.type);
    const verb = left === 0 ? (test ? "Final review:" : "Finish & submit") : test ? (d.type === "Quiz" ? "Prep for" : "Study for") : "Work on";
    const when = left === 0 ? `due today${d.time ? " " + d.time : ""}` : left === 1 ? "due tomorrow" : `due in ${left} days`;
    const bits = [when, fmtDay(d.due)];
    if (d.weight) bits.push(`${d.weight}%`);
    const detail = d.details.split(" · ")[0];
    if (detail && !/% of course/.test(detail)) bits.push(detail.length > 40 ? detail.slice(0, 38) + "…" : detail);
    tasks.push({
      id: "dl-" + d.id,
      cls: d.cls,
      title: `${verb} ${d.title.replace(new RegExp("^" + cls(d.cls).short + "\\s+", "i"), "")}`,
      sub: bits.join(" · "),
      score: (d.weight || 2) * (1 + (lead - left) / lead) + (left <= 1 ? 25 : 0),
    });
  }

  // Flashcards: point at the class with the most due cards
  const due = DATA.classes.map((c) => ({ c, n: deckCounts(c.id, "both").due })).sort((a, b) => b.n - a.n);
  const totalDue = due.reduce((a, x) => a + x.n, 0);
  const fresh = Math.min(newAllowance(), DATA.cards.filter((c) => !srs()[c.id]).length);
  if (totalDue + fresh > 0) {
    tasks.push({
      id: "cards", cls: totalDue ? due[0].c.id : null, action: "cards",
      title: totalDue ? `Review ${totalDue} flashcard${totalDue === 1 ? "" : "s"}` : `Learn ${fresh} new flashcards`,
      sub: totalDue ? `Most due: ${due[0].c.short} (${due[0].n})` : "Active recall, about 10 minutes",
      score: 6,
    });
  }

  // Keep every class warm: suggest classes you haven't studied lately
  const planned = new Set(tasks.map((x) => x.cls));
  const cold = DATA.classes
    .filter((c) => !planned.has(c.id))
    .map((c) => ({ c, last: lastStudied(c.id) }))
    .filter((x) => !x.last || daysUntil(x.last) <= -3)
    .slice(0, 2);
  for (const { c, last } of cold) {
    tasks.push({
      id: "warm-" + c.id, cls: c.id, action: "focus",
      title: `25 min on ${c.short} notes`,
      sub: last ? `Last studied ${relDays(daysUntil(last)).toLowerCase()}` : "Keep this class fresh",
      score: 1,
    });
  }

  tasks.sort((a, b) => b.score - a.score);
  const focus = [...new Set(tasks.map((x) => x.cls).filter(Boolean))].slice(0, 3);
  return { tasks: tasks.slice(0, 7), focus, brk };
}

// ============================================================================
// Views
// ============================================================================
const views = {};
let tab = store.get("tab", "today");

function render() {
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  views[tab]();
}
function go(name) {
  tab = name;
  store.set("tab", name);
  window.scrollTo(0, 0);
  render();
}

// ---------------------------------------------------------------- Today -----
views.today = () => {
  const { tasks, focus, brk } = buildPlan();
  const checks = store.get("todo:" + today(), {});
  const custom = store.get("custom", []).filter((c) => !c.doneOn || c.doneOn === today());
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const lead = focus.length ? cls(focus[0]).color : "#8ab4ff";
  const next = DATA.deadlines.find((d) => !isDone(d) && d.cls !== "all" && daysUntil(d.due) >= 0);
  const cardsDue = DATA.classes.reduce((a, c) => a + deckCounts(c.id, "both").due, 0);
  const allTasks = tasks.length + custom.length;
  const doneCount = tasks.filter((x) => checks[x.id]).length + custom.filter((c) => c.doneOn).length;

  $("#view").innerHTML = `
    <div class="eyebrow">${esc(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}</div>
    <h1>${hello}</h1>

    <section class="panel focus-card">
      <div class="glow" style="background:${lead}"></div>
      <div class="eyebrow">Focus today</div>
      <div class="big">${focus.length ? focus.map((id) => `<span style="color:${cls(id).color}">${esc(cls(id).short)}</span>`).join(", ") : "You're all clear"}</div>
      ${brk ? `<div class="note" style="margin:0 0 10px">Reading Week: no classes. A good time to get ahead.</div>` : ""}
      <div class="sub" style="color:var(--muted);font-size:14px">${doneCount} of ${allTasks} done${allTasks && doneCount === allTasks ? ". Nice work." : ""}</div>
    </section>

    <div class="stats">
      <div class="panel stat"><b>${minutesToday()}</b><span>focus min today</span></div>
      <div class="panel stat"><b>${cardsDue}</b><span>cards due</span></div>
      <div class="panel stat"><b>${next ? (daysUntil(next.due) === 0 ? "Today" : daysUntil(next.due) + "d") : "–"}</b><span>${next ? esc(next.title) : "next deadline"}</span></div>
    </div>

    <h2>To do</h2>
    <section class="panel list">
      ${tasks.map((x) => {
        const c = x.cls ? cls(x.cls) : null;
        return `<div class="row ${checks[x.id] ? "done checked" : ""}" style="--c:${c ? c.color : "var(--accent)"}">
          <button class="check" data-act="task" data-id="${x.id}" aria-label="Mark done">${CHECK}</button>
          <div class="main">
            <div class="title">${esc(x.title)}</div>
            <div class="sub">${c ? `<span class="dot" style="background:${c.color}"></span> ${esc(c.short)} · ` : ""}${esc(x.sub)}</div>
          </div>
          ${x.action ? `<button class="pill" data-act="${x.action}" data-cls="${x.cls || ""}">${x.action === "cards" ? "Study" : "Start"}</button>`
                     : x.cls ? `<button class="pill" data-act="focus" data-cls="${x.cls}">Start</button>` : ""}
        </div>`;
      }).join("")}
      ${custom.map((x) => {
        const c = x.cls ? cls(x.cls) : null;
        return `<div class="row ${x.doneOn ? "done checked" : ""}" style="--c:${c ? c.color : "var(--accent)"}">
          <button class="check" data-act="custom" data-id="${x.id}" aria-label="Mark done">${CHECK}</button>
          <div class="main"><div class="title">${esc(x.text)}</div>
            <div class="sub">${c ? `<span class="dot" style="background:${c.color}"></span> ${esc(c.short)} · ` : ""}Your task</div></div>
          <button class="pill" data-act="del-custom" data-id="${x.id}" aria-label="Delete">✕</button>
        </div>`;
      }).join("")}
      ${allTasks ? "" : `<div class="empty">Nothing due soon. Add your own task below.</div>`}
      <form class="add-row" id="add-form">
        <input id="add-text" placeholder="Add a task…" autocomplete="off" enterkeyhint="done">
        <select id="add-cls" aria-label="Class">
          <option value="">No class</option>
          ${DATA.classes.map((c) => `<option value="${c.id}">${esc(c.short)}</option>`).join("")}
        </select>
      </form>
    </section>
    <p class="note">The plan is built from your deadlines, due flashcards and the classes you haven't studied lately. It resets each day.</p>
    ${DATA.generated ? `<p class="note">Notes last synced ${esc(new Date(DATA.generated).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}.</p>` : ""}
  `;

  $("#add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#add-text").value.trim();
    if (!text) return;
    const list = store.get("custom", []);
    list.push({ id: Date.now().toString(36), text, cls: $("#add-cls").value || null, doneOn: null });
    store.set("custom", list);
    render();
  });
};

// ------------------------------------------------------------ Deadlines -----
// webcal:// makes iPhone offer "Subscribe" instead of a one-time import
const calendarLink = () => new URL("deadlines.ics", location.href).href.replace(/^https?:/, "webcal:");

let dlFilter = "all";
let showPast = false;
views.deadlines = () => {
  const items = DATA.deadlines.filter((d) => dlFilter === "all" || d.cls === dlFilter);
  const groups = [
    ["This week", (n) => n >= 0 && n <= 7],
    ["Next two weeks", (n) => n > 7 && n <= 21],
    ["Later", (n) => n > 21],
  ];
  const past = items.filter((d) => daysUntil(d.due) < 0).reverse();

  const row = (d) => {
    const c = cls(d.cls), n = daysUntil(d.due), done = isDone(d);
    const heat = done || n < 0 || d.cls === "all" ? "" : n <= 2 ? "hot" : n <= 7 ? "warm" : "";
    const meta = [d.type, d.weight ? d.weight + "%" : "", d.time, d.details].filter(Boolean).map(esc).join(" · ");
    return `<div class="row ${done ? "done checked" : ""}" style="--c:${c.color}">
      <span class="bar" style="background:${c.color}"></span>
      <div class="main">
        <div class="title">${esc(d.title)}</div>
        <div class="sub">${fmtDay(d.due)}${meta ? " · " + meta : ""}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
        <span class="pill ${heat}">${done ? "Done" : relDays(n)}</span>
        ${d.cls === "all" ? "" : `<button class="check" data-act="dl" data-id="${d.id}" aria-label="Mark done">${CHECK}</button>`}
      </div>
    </div>`;
  };

  $("#view").innerHTML = `
    <div class="eyebrow">${items.filter((d) => !isDone(d) && daysUntil(d.due) >= 0).length} upcoming</div>
    <h1>Deadlines</h1>
    <div class="chips">
      <button class="chip ${dlFilter === "all" ? "on" : ""}" data-act="dl-filter" data-cls="all">All</button>
      ${DATA.classes.map((c) => `<button class="chip ${dlFilter === c.id ? "on" : ""}" data-act="dl-filter" data-cls="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.short)}</button>`).join("")}
    </div>
    ${groups.map(([name, test]) => {
      const g = items.filter((d) => test(daysUntil(d.due)));
      return g.length ? `<h2>${name}</h2><section class="panel list">${g.map(row).join("")}</section>` : "";
    }).join("")}
    ${past.length ? `<h2>Past</h2>
      ${showPast ? `<section class="panel list">${past.map(row).join("")}</section>` : ""}
      <button class="btn block" style="margin-top:10px" data-act="past">${showPast ? "Hide" : "Show"} ${past.length} past</button>` : ""}
    <a class="btn block" style="margin-top:22px;text-decoration:none" href="${calendarLink()}">Get deadline alerts in iPhone Calendar</a>
    <p class="note">Adds every deadline to your Calendar with alerts 3 days before and the morning it's due (plus a week before midterms and exams). When subscribing, switch <b>Remove Alerts</b> off.</p>
    <p class="note">Ticking something off here only saves on this phone. Your Obsidian vault is the main list.</p>
  `;
};

// ---------------------------------------------------------------- Focus -----
const pomo = Object.assign({ focus: 25, short: 5, long: 15, alert: false, wake: false, cls: null }, store.get("pomo", {}));
const timer = Object.assign({ mode: "focus", running: false, endAt: 0, remaining: pomo.focus * 60000, count: 0 }, store.get("timer", {}));
const MODE_LABEL = { focus: "Focus", short: "Short break", long: "Long break" };
const savePomo = () => store.set("pomo", pomo);
const saveTimer = () => store.set("timer", timer);
const total = () => pomo[timer.mode] * 60000;
const left = () => (timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remaining);
const fmtClock = (ms) => { const s = Math.ceil(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
const ringColor = () => (timer.mode === "focus" ? (pomo.cls ? cls(pomo.cls).color : "#8ab4ff") : "#5fd4c4");

let audio, wakeLock;
function chime() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    [659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * 0.22;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.2);
      o.connect(g).connect(audio.destination);
      o.start(t0); o.stop(t0 + 1.3);
    });
  } catch {}
}
async function keepAwake(on) {
  try {
    if (on && pomo.wake && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}

function startPause() {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {} }
  if (timer.running) { timer.remaining = left(); timer.running = false; keepAwake(false); }
  else { timer.endAt = Date.now() + timer.remaining; timer.running = true; keepAwake(true); }
  saveTimer();
  render();
}
function setMode(mode) {
  timer.mode = mode; timer.running = false; timer.remaining = total();
  keepAwake(false); saveTimer(); render();
}
function finish(skipped) {
  const was = timer.mode;
  if (was === "focus" && !skipped) {
    const log = pomoLog();
    log.push({ d: today(), cls: pomo.cls, min: pomo.focus });
    store.set("pomoLog", log.slice(-1000));
  }
  if (was === "focus") timer.count += 1;
  const next = was === "focus" ? (timer.count % 4 === 0 ? "long" : "short") : "focus";
  timer.mode = next; timer.running = false; timer.remaining = total();
  keepAwake(false); saveTimer();
  if (!skipped) {
    chime();
    const msg = was === "focus" ? `Focus done. Time for a ${next === "long" ? "long" : "short"} break.` : "Break's over. Back to it.";
    toast(msg);
    if (pomo.alert && "Notification" in window && Notification.permission === "granted") {
      navigator.serviceWorker?.ready.then((r) => r.showNotification("Study timer", { body: msg, icon: "icon-180.png", tag: "pomo" })).catch(() => {});
    }
  }
  if (tab === "focus" || tab === "today") render();
}
setInterval(() => {
  if (timer.running && left() <= 0) finish(false);
  if (tab === "focus") paintRing();
  document.title = timer.running ? `${fmtClock(left())} · ${MODE_LABEL[timer.mode]}` : "Study";
}, 500);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (timer.running && left() <= 0) finish(false);
    if (timer.running) keepAwake(true);
    render();
  }
});

const R = 140, CIRC = 2 * Math.PI * R;
function paintRing() {
  const prog = $(".ring .prog"), time = $(".ring .time");
  if (!prog) return;
  const frac = 1 - left() / total();
  prog.style.strokeDashoffset = String(CIRC * (1 - Math.min(1, Math.max(0, frac))));
  time.textContent = fmtClock(left());
}

views.focus = () => {
  const color = ringColor();
  const todayLog = pomoLog().filter((l) => l.d === today());
  const byCls = {};
  todayLog.forEach((l) => (byCls[l.cls || ""] = (byCls[l.cls || ""] || 0) + l.min));
  const play = timer.running
    ? '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

  $("#view").innerHTML = `
    <div class="eyebrow">Pomodoro</div>
    <h1>Focus</h1>
    <div class="seg">${["focus", "short", "long"].map((m) => `<button class="${timer.mode === m ? "on" : ""}" data-act="mode" data-mode="${m}">${MODE_LABEL[m]}</button>`).join("")}</div>

    <div class="timer-wrap" style="--rc:${color}">
      <div class="ring" style="margin-top:22px">
        <svg viewBox="0 0 320 320">
          <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".55"/>
          </linearGradient></defs>
          <circle class="track" cx="160" cy="160" r="${R}" fill="none" stroke-width="10"/>
          <circle class="prog" cx="160" cy="160" r="${R}" fill="none" stroke="url(#rg)" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>
        </svg>
        <div class="center">
          <div class="time">${fmtClock(left())}</div>
          <div class="label">${timer.mode === "focus" ? (pomo.cls ? esc(cls(pomo.cls).short) : "Focus") : MODE_LABEL[timer.mode]}</div>
        </div>
      </div>
      <div class="controls">
        <button class="ghost" data-act="reset" aria-label="Reset"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5"/></svg></button>
        <button class="play" data-act="play" aria-label="${timer.running ? "Pause" : "Start"}">${play}</button>
        <button class="ghost" data-act="skip" aria-label="Skip"><svg viewBox="0 0 24 24"><path d="M6 5l9 7-9 7zM18 5v14"/></svg></button>
      </div>
      <div class="pips">${[0, 1, 2, 3].map((i) => `<i class="${i < timer.count % 4 ? "on" : ""}"></i>`).join("")}</div>
    </div>

    <h2>Studying</h2>
    <div class="chips">
      <button class="chip ${!pomo.cls ? "on" : ""}" data-act="pomo-cls" data-cls="">General</button>
      ${DATA.classes.map((c) => `<button class="chip ${pomo.cls === c.id ? "on" : ""}" data-act="pomo-cls" data-cls="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.short)}</button>`).join("")}
    </div>

    <h2>Today</h2>
    <section class="panel list">
      ${todayLog.length ? Object.entries(byCls).map(([id, min]) => {
        const c = id ? cls(id) : null;
        return `<div class="row"><span class="dot" style="background:${c ? c.color : "var(--faint)"};margin-top:7px"></span>
          <div class="main"><div class="title">${c ? esc(c.short) : "General"}</div></div><div class="sub">${min} min</div></div>`;
      }).join("") : `<div class="empty">No sessions yet today.</div>`}
    </section>

    <h2>Settings</h2>
    <section class="panel settings">
      ${["focus", "short", "long"].map((m) => `
        <span>${MODE_LABEL[m]}</span>
        <div class="stepper"><button data-act="step" data-mode="${m}" data-d="-1" aria-label="Less">−</button><b>${pomo[m]} min</b><button data-act="step" data-mode="${m}" data-d="1" aria-label="More">+</button></div>`).join("")}
      <span>Alert when timer ends</span><button class="toggle ${pomo.alert ? "on" : ""}" data-act="alert" aria-label="Alert"></button>
      <span>Keep screen on</span><button class="toggle ${pomo.wake ? "on" : ""}" data-act="wake" aria-label="Keep screen on"></button>
    </section>
    <p class="note">The timer keeps correct time if you switch apps. iPhone pauses web apps in the background, so the chime plays when you come back. Turn on "Keep screen on" to hear it right away.</p>
  `;
  paintRing();
};

// ---------------------------------------------------------------- Cards -----
let cardKind = store.get("cardKind", "both");
let session = null; // { deck, cram, queue, i, flipped, seen }

function startSession(deck, cram) {
  const s = srs(), t = today();
  let pool = cardsFor(deck, deck.startsWith("note:") ? "both" : cardKind);
  let queue;
  if (cram) queue = pool.map((c) => c.id);
  else {
    const due = pool.filter((c) => s[c.id] && s[c.id].due <= t).map((c) => c.id);
    const fresh = pool.filter((c) => !s[c.id]).slice(0, newAllowance()).map((c) => c.id);
    queue = [...due, ...fresh];
  }
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  session = { deck, cram, queue, i: 0, flipped: false, seen: 0 };
  render();
}

function nextInterval(st, rating) {
  if (rating === "again") return 0;
  const box = Math.min(INTERVALS.length - 1, (st ? st.box : 0) + (rating === "easy" ? 2 : 1));
  return INTERVALS[box];
}
function rate(rating) {
  const id = session.queue[session.i];
  const all = srs();
  const st = all[id];
  if (!session.cram) {
    if (!st) { const ns = store.get("newSeen", {}); store.set("newSeen", { [today()]: (ns[today()] || 0) + 1 }); }
    const box = rating === "again" ? 0 : Math.min(INTERVALS.length - 1, (st ? st.box : 0) + (rating === "easy" ? 2 : 1));
    all[id] = { box, due: addDays(today(), INTERVALS[box]) };
    store.set("srs", all);
  }
  if (rating === "again") session.queue.splice(Math.min(session.queue.length, session.i + 4), 0, id);
  session.i += 1;
  session.seen += 1;
  session.flipped = false;
  render();
}

// Flip in place so the 3D animation plays
function flip() {
  if (!session) return;
  session.flipped = !session.flipped;
  $(".study")?.classList.toggle("flipped", session.flipped);
}

views.cards = () => (session ? studyView() : deckView());

function deckView() {
  const decks = [{ id: "all", short: "All classes", color: "var(--text)" }, ...DATA.classes];
  $("#view").innerHTML = `
    <div class="eyebrow">Active recall</div>
    <h1>Flashcards</h1>
    <div class="seg" style="margin-bottom:16px">
      ${[["both", "Both"], ["term", "Key terms"], ["question", "Questions"]].map(([k, l]) => `<button class="${cardKind === k ? "on" : ""}" data-act="kind" data-kind="${k}">${l}</button>`).join("")}
    </div>
    <div class="deck-grid">
      ${decks.map((d) => {
        const n = deckCounts(d.id, cardKind);
        const ready = n.due + Math.min(n.fresh, newAllowance());
        return `<button class="panel deck" data-act="study" data-deck="${d.id}">
          <span class="dot" style="background:${d.color};width:12px;height:12px"></span>
          <div class="main"><div class="name">${esc(d.short)}</div>
            <div class="meta">${n.due} due · ${n.fresh} new · ${cardsFor(d.id, cardKind).length} cards</div></div>
          <span class="due-badge" style="color:${ready ? "var(--text)" : "var(--faint)"}">${ready ? ready : "✓"}</span>
        </button>`;
      }).join("")}
    </div>
    <h2>Practice anytime</h2>
    <div class="chips">
      ${decks.map((d) => `<button class="chip" data-act="cram" data-deck="${d.id}"><span class="dot" style="background:${d.color}"></span>${esc(d.short)}</button>`).join("")}
    </div>
    <p class="note">Practice mode shuffles every card in a class and doesn't change your review schedule. Normal study shows cards that are due, plus up to ${NEW_PER_DAY} new cards a day.</p>
  `;
}

function studyView() {
  const { queue, i, flipped } = session;
  const deckName = session.deck === "all" ? "All classes" : session.deck.startsWith("note:") ? session.deck.slice(5) : cls(session.deck).short;
  if (i >= queue.length) {
    $("#view").innerHTML = `
      <div class="study-top"><button class="pill" data-act="end">‹ Decks</button><span class="sub" style="color:var(--muted)">${esc(deckName)}</span></div>
      <section class="panel" style="padding:36px 22px;text-align:center">
        <div style="font-size:44px">✓</div>
        <h1 style="margin:8px 0">${session.seen ? "Session done" : "All caught up"}</h1>
        <p style="color:var(--muted);margin:0 0 20px">${session.seen ? `You reviewed ${session.seen} card${session.seen === 1 ? "" : "s"}.` : "No cards due here right now."}</p>
        <button class="btn primary block" data-act="cram" data-deck="${session.deck}">Keep practising (shuffle all)</button>
        <button class="btn block" style="margin-top:10px" data-act="end">Back to decks</button>
      </section>`;
    return;
  }
  const card = DATA.cards.find((c) => c.id === queue[i]);
  const c = cls(card.cls);
  const st = srs()[card.id];
  const remaining = queue.length - i;
  const back = card.kind === "question"
    ? `Say your answer out loud first.\n\nThen check your note:\n<b>${esc(card.note)}</b>`
    : md(card.back);
  const ivl = (r) => { const n = nextInterval(st, r); return n === 0 ? "again soon" : n === 1 ? "1 day" : n + " days"; };

  $("#view").innerHTML = `
    <div class="study-top">
      <button class="pill" data-act="end">‹ Decks</button>
      <span class="sub" style="color:var(--muted);font-size:14px">${session.cram ? "Practice · " : ""}${remaining} left</span>
    </div>
    <div class="progress"><div style="width:${(session.seen / (session.seen + remaining)) * 100}%;background:${c.color}"></div></div>
    <div class="study ${flipped ? "flipped" : ""}">
    <div class="flip" data-act="flip">
      <div class="flip-inner">
        <div class="face front ${card.kind === "question" ? "q" : ""}">
          <div class="tag"><span class="dot" style="background:${c.color}"></span>${esc(c.short)} · ${card.kind === "question" ? "Review question" : "Key term"}</div>
          <div class="content">${md(card.front)}</div>
          <div class="hint">Tap to flip</div>
        </div>
        <div class="face back">
          <div class="tag"><span class="dot" style="background:${c.color}"></span>${esc(card.note)}</div>
          <div class="content">${back}</div>
          <div class="hint">${card.kind === "question" ? "How well did you know it?" : esc(card.front)}</div>
        </div>
      </div>
    </div>
    <div class="actions">
      <div class="rate">
        <button class="btn" data-act="rate" data-r="again">Again<small>${session.cram ? "repeat" : ivl("again")}</small></button>
        <button class="btn" data-act="rate" data-r="good">Good<small>${session.cram ? "next" : ivl("good")}</small></button>
        <button class="btn primary" data-act="rate" data-r="easy">Easy<small style="color:inherit;opacity:.7">${session.cram ? "next" : ivl("easy")}</small></button>
      </div>
      <button class="btn primary block show" style="margin-top:16px" data-act="flip">Show answer</button>
    </div>
    </div>
  `;
}

// ------------------------------------------------------------- Progress -----
// A card's level comes from its spaced-repetition box:
// never seen = New, box 0–1 = Learning, box 2–3 = Familiar, box 4+ (8+ day gap) = Mastered
const LEVELS = [
  { key: "mastered", label: "Mastered", value: 1, color: "#4cc38a" },
  { key: "familiar", label: "Familiar", value: 0.6, color: "#8ab4ff" },
  { key: "learning", label: "Learning", value: 0.25, color: "#f2c94c" },
  { key: "fresh", label: "New", value: 0, color: "var(--surface-2)" },
];
function levelOf(st) {
  if (!st) return "fresh";
  if (st.box >= 4) return "mastered";
  if (st.box >= 2) return "familiar";
  return "learning";
}
function mastery(cards) {
  const s = srs(), n = { mastered: 0, familiar: 0, learning: 0, fresh: 0 };
  for (const c of cards) n[levelOf(s[c.id])]++;
  const total = cards.length;
  const score = total ? LEVELS.reduce((a, l) => a + n[l.key] * l.value, 0) / total : 0;
  return { ...n, total, score, seen: total - n.fresh };
}
const topicCards = (note) => DATA.cards.filter((c) => c.note === note);
const pct = (x) => Math.round(x * 100) + "%";

function stackBar(m) {
  return `<div class="stack">${LEVELS.filter((l) => m[l.key]).map((l) =>
    `<i style="flex:${m[l.key]};background:${l.color}" title="${l.label}: ${m[l.key]}"></i>`).join("")}</div>`;
}
function miniRing(frac, color, size = 64) {
  const r = 26, C = 2 * Math.PI * r;
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" style="transform:rotate(-90deg)">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="6"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>`;
}

let progCls = "all";
views.progress = () => {
  const conf = store.get("conf", {});
  const all = mastery(DATA.cards);
  const topics = (DATA.topics || []).map((t) => ({ ...t, m: mastery(topicCards(t.note)), conf: conf[t.note] || 0 }));

  // Weakness blends both signals: confidence 1–5 maps to 0–1, and the lower of the two wins
  const strength = (t) => Math.min(t.m.seen ? t.m.score : 1, t.conf ? (t.conf - 1) / 4 : 1);
  const weak = topics
    .filter((t) => strength(t) < 0.7)
    .sort((a, b) => strength(a) - strength(b))
    .slice(0, 4);
  const untouched = topics.filter((t) => !t.m.seen && !t.conf);

  // Focus minutes per class over the last 7 days
  const since = addDays(today(), -6);
  const week = {};
  pomoLog().filter((l) => l.d >= since).forEach((l) => (week[l.cls || ""] = (week[l.cls || ""] || 0) + l.min));
  const maxMin = Math.max(1, ...Object.values(week));

  const lastBackup = store.get("lastBackup", null);
  const backupAge = lastBackup ? -daysUntil(lastBackup) : null;

  const topicRow = (t) => {
    const c = cls(t.cls);
    return `<div class="row topic">
      <div class="main">
        <div class="topic-head"><div class="title">${esc(t.note)}</div><b class="topic-pct">${pct(t.m.score)}</b></div>
        ${stackBar(t.m)}
        <div class="topic-foot">
          <div class="conf" aria-label="Confidence">
            <span>Confidence</span>
            ${[1, 2, 3, 4, 5].map((n) => `<button data-act="conf" data-note="${esc(t.note)}" data-n="${n}" aria-label="${n} of 5"
              class="${n <= t.conf ? "on" : ""}" style="--c:${c.color}"></button>`).join("")}
          </div>
          <button class="pill" data-act="study-topic" data-note="${esc(t.note)}">Study</button>
        </div>
        <div class="sub">${t.m.mastered} mastered · ${t.m.familiar} familiar · ${t.m.learning} learning · ${t.m.fresh} new</div>
      </div>
    </div>`;
  };

  const shown = progCls === "all" ? DATA.classes : DATA.classes.filter((c) => c.id === progCls);

  $("#view").innerHTML = `
    <div class="eyebrow">${all.seen} of ${all.total} cards studied</div>
    <h1>Progress</h1>

    <div class="ring-grid">
      ${DATA.classes.map((c) => {
        const m = mastery(DATA.cards.filter((x) => x.cls === c.id));
        return `<button class="panel ring-card ${progCls === c.id ? "on" : ""}" data-act="prog-cls" data-cls="${progCls === c.id ? "all" : c.id}" style="--c:${c.color}">
          <div class="mini">${miniRing(m.score, c.color)}<b>${pct(m.score)}</b></div>
          <span>${esc(c.short)}</span>
        </button>`;
      }).join("")}
    </div>
    <div class="legend">${LEVELS.map((l) => `<span><i style="background:${l.color}"></i>${l.label}</span>`).join("")}</div>

    <h2>Needs work</h2>
    <section class="panel list">
      ${weak.length ? weak.map((t) => `<div class="row">
          <span class="dot" style="background:${cls(t.cls).color};margin-top:7px"></span>
          <div class="main"><div class="title">${esc(t.note)}</div>
            <div class="sub">${t.conf ? `Confidence ${t.conf}/5 · ` : ""}${pct(t.m.score)} mastered</div></div>
          <button class="pill" data-act="study-topic" data-note="${esc(t.note)}">Study</button></div>`).join("")
        : `<div class="empty">${all.seen ? "Nothing weak right now. Nice." : "Study some flashcards or rate your confidence below, and your weakest topics will show up here."}</div>`}
    </section>
    ${untouched.length && all.seen ? `<p class="note">${untouched.length} topic${untouched.length === 1 ? "" : "s"} not started yet.</p>` : ""}

    <h2>Topics</h2>
    <div class="chips">
      <button class="chip ${progCls === "all" ? "on" : ""}" data-act="prog-cls" data-cls="all">All</button>
      ${DATA.classes.map((c) => `<button class="chip ${progCls === c.id ? "on" : ""}" data-act="prog-cls" data-cls="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.short)}</button>`).join("")}
    </div>
    ${shown.map((c) => {
      const list = topics.filter((t) => t.cls === c.id);
      return list.length ? `<h2 style="color:${c.color}">${esc(c.name)}</h2><section class="panel list">${list.map(topicRow).join("")}</section>` : "";
    }).join("")}

    ${(DATA.concepts || []).length ? `<h2>Big ideas across classes</h2>
    <section class="panel list">
      ${DATA.concepts.map((name) => {
        const notes = topics.filter((t) => t.concepts.includes(name));
        const m = mastery(DATA.cards.filter((c) => notes.some((t) => t.note === c.note)));
        const dots = [...new Set(notes.map((t) => t.cls))].map((id) => `<span class="dot" style="background:${cls(id).color}"></span>`).join("");
        return `<div class="row"><div class="main">
          <div class="topic-head"><div class="title">${esc(name)}</div><b class="topic-pct">${pct(m.score)}</b></div>
          ${stackBar(m)}
          <div class="sub">${dots} ${notes.length} topic${notes.length === 1 ? "" : "s"}</div>
        </div></div>`;
      }).join("")}
    </section>` : ""}

    <h2>Focus time, last 7 days</h2>
    <section class="panel" style="padding:14px 16px">
      ${Object.keys(week).length ? Object.entries(week).sort((a, b) => b[1] - a[1]).map(([id, min]) => {
        const c = id ? cls(id) : { short: "General", color: "var(--faint)" };
        return `<div class="hbar"><span>${esc(c.short)}</span><div><i style="width:${(min / maxMin) * 100}%;background:${c.color}"></i></div><b>${min}m</b></div>`;
      }).join("") : `<div class="empty" style="padding:8px">No focus sessions this week yet.</div>`}
    </section>

    <h2>Backup</h2>
    <section class="panel" style="padding:16px">
      <div style="font-weight:600">Your progress lives only on this phone.</div>
      <div class="sub" style="color:var(--muted);font-size:14px;margin:4px 0 14px">
        ${lastBackup ? `Last backup ${backupAge === 0 ? "today" : backupAge === 1 ? "yesterday" : backupAge + " days ago"}.` : "No backup yet."}
        Save one to iCloud Drive (Files app) every week or so.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button class="btn primary" data-act="backup">Back up</button>
        <button class="btn" data-act="restore">Restore</button>
      </div>
      <input type="file" id="restore-file" accept=".json,application/json" hidden>
    </section>
  `;

  $("#restore-file").addEventListener("change", (e) => restore(e.target.files[0]));
};

// --------------------------------------------------------- Backup/restore ---
// Everything the app saves on this phone, except UI bits like the open tab
const BACKUP_SKIP = new Set(["tab", "cardKind", "timer"]);
async function backup() {
  const data = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!BACKUP_SKIP.has(k)) data[k] = localStorage.getItem(k);
    }
  } catch {}
  const blob = new Blob([JSON.stringify({ app: "study-app", version: 1, saved: new Date().toISOString(), data }, null, 1)], { type: "application/json" });
  const name = `study-backup-${today()}.json`;
  const file = new File([blob], name, { type: "application/json" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Study backup" }); // iPhone: pick "Save to Files" → iCloud Drive
    } else {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    store.set("lastBackup", today());
    toast("Backup saved");
    render();
  } catch (err) {
    if (err && err.name !== "AbortError") toast("Couldn't save the backup");
  }
}
async function restore(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.app !== "study-app" || typeof parsed.data !== "object") throw new Error("not a backup");
    const when = new Date(parsed.saved).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (!confirm(`Restore the backup from ${when}? This replaces the progress currently on this phone.`)) return;
    for (const [k, v] of Object.entries(parsed.data)) if (typeof v === "string") localStorage.setItem(k, v);
    toast("Progress restored");
    setTimeout(() => location.reload(), 800);
  } catch {
    toast("That file isn't a Study backup");
  }
}

// ============================================================================
// Events (one listener for the whole app)
// ============================================================================
document.addEventListener("click", (e) => {
  const tabBtn = e.target.closest(".tabbar button");
  if (tabBtn) { if (tabBtn.dataset.tab === "cards" && tab === "cards") session = null; return go(tabBtn.dataset.tab); }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const { act, id } = el.dataset;
  switch (act) {
    case "task": {
      const k = "todo:" + today(), v = store.get(k, {});
      v[id] = !v[id]; store.set(k, v); render(); break;
    }
    case "custom": {
      const list = store.get("custom", []);
      const t = list.find((x) => x.id === id);
      if (t) t.doneOn = t.doneOn ? null : today();
      store.set("custom", list.filter((x) => !x.doneOn || x.doneOn >= addDays(today(), -1)));
      render(); break;
    }
    case "del-custom": store.set("custom", store.get("custom", []).filter((x) => x.id !== id)); render(); break;
    case "dl": { const v = dlDone(); v[id] = !v[id]; store.set("dlDone", v); render(); break; }
    case "dl-filter": dlFilter = el.dataset.cls; render(); break;
    case "past": showPast = !showPast; render(); break;
    case "focus": if (el.dataset.cls) { pomo.cls = el.dataset.cls; savePomo(); } if (timer.mode !== "focus") setMode("focus"); go("focus"); break;
    case "cards": session = null; go("cards"); if (el.dataset.cls) startSession(el.dataset.cls, false); break;
    case "mode": setMode(el.dataset.mode); break;
    case "play": startPause(); break;
    case "reset": timer.running = false; timer.remaining = total(); keepAwake(false); saveTimer(); render(); break;
    case "skip": finish(true); break;
    case "pomo-cls": pomo.cls = el.dataset.cls || null; savePomo(); render(); break;
    case "step": {
      const m = el.dataset.mode, lim = m === "focus" ? [5, 90] : [1, 45];
      pomo[m] = Math.min(lim[1], Math.max(lim[0], pomo[m] + Number(el.dataset.d) * (m === "focus" ? 5 : 1)));
      savePomo();
      if (timer.mode === m && !timer.running) { timer.remaining = total(); saveTimer(); }
      render(); break;
    }
    case "alert":
      if (!pomo.alert && "Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission().then((p) => {
          pomo.alert = p === "granted"; savePomo(); render();
          if (p !== "granted") toast("Notifications not allowed");
        });
      } else if (!("Notification" in window)) {
        toast("Add this app to your Home Screen first");
      } else { pomo.alert = !pomo.alert; savePomo(); render(); }
      break;
    case "wake": pomo.wake = !pomo.wake; savePomo(); if (timer.running) keepAwake(pomo.wake); render(); break;
    case "kind": cardKind = el.dataset.kind; store.set("cardKind", cardKind); render(); break;
    case "study": startSession(el.dataset.deck, false); break;
    case "cram": startSession(el.dataset.deck, true); break;
    case "end": session = null; render(); break;
    case "prog-cls": progCls = el.dataset.cls; render(); break;
    case "conf": {
      const conf = store.get("conf", {}), n = Number(el.dataset.n);
      conf[el.dataset.note] = conf[el.dataset.note] === n ? 0 : n; // tap the same dot again to clear
      store.set("conf", conf); render(); break;
    }
    case "study-topic": session = null; tab = "cards"; store.set("tab", "cards"); startSession("note:" + el.dataset.note, false);
      if (session.queue.length === 0) startSession("note:" + el.dataset.note, true); // nothing due: practise them all
      break;
    case "backup": backup(); break;
    case "restore": $("#restore-file").click(); break;
    case "flip": flip(); break;
    case "rate": rate(el.dataset.r); break;
  }
});

document.addEventListener("keydown", (e) => {
  if (tab !== "cards" || !session || session.i >= session.queue.length || e.target.closest("input")) return;
  if (e.key === " ") { e.preventDefault(); flip(); }
  else if (session.flipped && ["1", "2", "3"].includes(e.key)) rate(["again", "good", "easy"][Number(e.key) - 1]);
});

// ============================================================================
// Start
// ============================================================================
async function boot() {
  try {
    const res = await fetch("data.json", { cache: "no-cache" });
    DATA = await res.json();
  } catch {
    $("#view").innerHTML = `<div class="empty">Couldn't load your data. Check your connection and reopen the app.</div>`;
    return;
  }
  if (!views[tab]) tab = "today";
  render();
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
