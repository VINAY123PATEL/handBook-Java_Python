/* DSA Hub — Gamification: XP, level, rank, streak, badges, leaderboard */
(function () {
  var CACHE_KEY = "dsa_gamify_v1";
  var LEVELS = [
    { min: 0, title: "Rookie", icon: "\uD83C\uDF31" },
    { min: 200, title: "Learner", icon: "\uD83D\uDCD8" },
    { min: 500, title: "Explorer", icon: "\uD83E\uDDED" },
    { min: 1000, title: "Ace", icon: "\u26A1" },
    { min: 2000, title: "Guru", icon: "\uD83C\uDF93" },
    { min: 4000, title: "DSA Master", icon: "\uD83D\uDC51" }
  ];
  var BADGES = {
    "first-solve": "\uD83C\uDFAF",
    "solved-5": "\uD83E\uDDE9",
    "solved-25": "\uD83D\uDE80",
    "solved-50": "\uD83D\uDC8E",
    "solved-100": "\uD83C\uDFC6",
    "quiz-10": "\uD83E\uDDE0",
    "pdf-20": "\uD83D\uDCC4",
    "streak-3": "\uD83D\uDD25",
    "streak-7": "\u26A1",
    "streak-30": "\uD83D\uDC09"
  };
  var POINTS = { solve: 10, quiz: 5, pdf: 1, visit: 2 };

  var data = { xp: 0, streak: 0, bestStreak: 0, lastDay: "", visitedToday: false, badges: [], totalSolved: 0, quizzes: 0, pdfs: 0 };
  var loaded = false;

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function storageGet() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; }
  }
  function storageSet() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { }
  }
  function currentUser() {
    try { return window.firebase && firebase.auth && firebase.auth().currentUser; } catch (e) { return null; }
  }
  function loadScript(src, onload) {
    var s = document.createElement("script");
    s.src = src;
    s.onload = onload;
    document.head.appendChild(s);
  }
  function ensureStore(cb) {
    if (window.firebase && firebase.firestore) { cb(true); return; }
    loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js", function () { cb(true); });
  }

  function touch() {
    var today = todayISO();
    if (data.lastDay === today) return;
    var y = new Date();
    y.setDate(y.getDate() - 1);
    var yesterday = y.toISOString().slice(0, 10);
    data.streak = (data.lastDay === yesterday) ? (data.streak || 0) + 1 : 1;
    data.lastDay = today;
    if (data.streak > (data.bestStreak || 0)) data.bestStreak = data.streak;
    data.visitedToday = false;
  }

  function levelInfo(xp) {
    var cur = LEVELS[0];
    var next = null;
    for (var i = 0; i < LEVELS.length; i++) {
      if (xp >= LEVELS[i].min) cur = LEVELS[i];
      else { next = LEVELS[i]; break; }
    }
    var prevMin = cur.min;
    var nextMin = next ? next.min : cur.min;
    var range = nextMin - prevMin || 1;
    var pct = Math.min(100, Math.round(((xp - prevMin) / range) * 100));
    if (!next) { nextMin = xp > prevMin ? xp : prevMin; pct = 100; }
    return { levelIndex: LEVELS.indexOf(cur) + 1, title: cur.title, icon: cur.icon, min: prevMin, next: nextMin, nextLevel: next ? next.title : null, pct: pct };
  }

  function checkBadges() {
    var newly = [];
    var rules = {
      "first-solve": data.totalSolved >= 1,
      "solved-5": data.totalSolved >= 5,
      "solved-25": data.totalSolved >= 25,
      "solved-50": data.totalSolved >= 50,
      "solved-100": data.totalSolved >= 100,
      "quiz-10": data.quizzes >= 10,
      "pdf-20": data.pdfs >= 20,
      "streak-3": data.bestStreak >= 3,
      "streak-7": data.bestStreak >= 7,
      "streak-30": data.bestStreak >= 30
    };
    Object.keys(rules).forEach(function (id) {
      if (rules[id] && data.badges.indexOf(id) === -1) {
        data.badges.push(id);
        newly.push(id);
      }
    });
    return newly;
  }

  function persist(next) {
    storageSet();
    var u = currentUser();
    if (!u) {
      emit("gamify:update", { silent: true });
      if (next) next();
      return;
    }
    ensureStore(function () {
      try {
        var db = firebase.firestore();
        db.collection("users").doc(u.uid).set({
          gamify: data,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).then(function () {
          var prof = window.DSAProfile ? window.DSAProfile.get() : null;
          db.collection("leaderboard").doc(u.uid).set({
            name: (prof && prof.displayName) || u.displayName || u.email || "User",
            photo: (prof && prof.photo) || "",
            xp: data.xp,
            bestStreak: data.bestStreak,
            streak: data.streak,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true }).catch(function () { });
          emit("gamify:update", { silent: true });
          if (next) next();
        }).catch(function () {
          emit("gamify:update", { silent: true });
          if (next) next();
        });
      } catch (e) {
        emit("gamify:update", { silent: true });
        if (next) next();
      }
    });
  }

  function emit(name, detail) {
    if (typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function loadInfo(name, photo) {
    var u = currentUser();
    if (!u) return;
    ensureStore(function () {
      try {
        firebase.firestore().collection("leaderboard").doc(u.uid).set({
          name: name || (u.displayName || u.email || "User"),
          photo: photo || "",
          xp: data.xp,
          bestStreak: data.bestStreak,
          streak: data.streak,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(function () { });
      } catch (e) { }
    });
  }

  function award(section, opts) {
    var o = opts || {};
    var pts = o.points || POINTS[section] || 0;
    touch();
    var info = levelInfo(data.xp);
    if (section === "visit" && data.visitedToday) {
      emit("gamify:update", { silent: true });
      return;
    }
    if (section === "visit") data.visitedToday = true;
    if (section === "solve") data.totalSolved++;
    if (section === "quiz") data.quizzes++;
    if (section === "pdf") data.pdfs++;
    data.xp += pts;
    var info2 = levelInfo(data.xp);
    var leveled = info2.levelIndex > info.levelIndex;
    var newBadges = checkBadges();
    var msg = o.text || (pts > 0 ? "+" + pts + " XP" : "");
    persist(function () {
      if (o.silent) return;
      var toastPieces = ["\u2728 " + msg];
      if (leveled) toastPieces.push("\uD83C\uDF89 Level " + info2.levelIndex + " — " + info2.title + "!");
      newBadges.forEach(function (id) { toastPieces.push("\uD83C\uDF1F Badge: " + BADGES[id] + " " + id.replace(/-/g, " ")); });
      emit("gamify:toast", { text: toastPieces.join("<br>"), data: data });
      emit("gamify:update", {});
    });
  }

  function load(next) {
    var local = storageGet();
    if (local && typeof local === "object") data = Object.assign(data, local);
    var u = currentUser();
    if (!u) { loaded = true; if (next) next(); return; }
    ensureStore(function () {
      try {
        firebase.firestore().collection("users").doc(u.uid).get().then(function (doc) {
          if (doc.exists) {
            var d = doc.data() || {};
            if (d.gamify && typeof d.gamify === "object") data = Object.assign(data, d.gamify);
          }
          loaded = true;
          emit("gamify:update", { silent: true });
          if (next) next();
        }).catch(function () {
          loaded = true;
          if (next) next();
        });
      } catch (e) {
        loaded = true;
        if (next) next();
      }
    });
  }

  function badgeLabel(id) { return (BADGES[id] || "\uD83C\uDFC5") + " " + id.replace(/-/g, " "); }

  function leaderboard(n, cb) {
    var u = currentUser();
    if (!u) { cb([]); return; }
    ensureStore(function () {
      try {
        firebase.firestore().collection("leaderboard").orderBy("xp", "desc").limit(n || 10).get().then(function (snap) {
          var rows = [];
          snap.forEach(function (doc) {
            var d = doc.data() || {};
            rows.push({ id: doc.id, name: d.name || "User", photo: d.photo || "", xp: d.xp || 0, streak: d.streak || 0, bestStreak: d.bestStreak || 0, me: doc.id === u.uid });
          });
          cb(rows);
        }).catch(function () { cb([]); });
      } catch (e) { cb([]); }
    });
  }

  function showToast(text, ms) {
    if (document.getElementById("gamify-toast")) return;
    var t = document.createElement("div");
    t.id = "gamify-toast";
    t.style.cssText = "position:fixed;top:18px;right:18px;z-index:99998;max-width:300px;background:#1a2434;border:1px solid #e08f2e;color:#ffe3b3;padding:14px 16px;border-radius:12px;font-family:'Space Grotesk','Segoe UI',sans-serif;font-size:13.5px;font-weight:600;line-height:1.55;box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:0;transform:translateY(-8px);transition:opacity .25s ease,transform .25s ease;";
    t.innerHTML = text;
    document.body.appendChild(t);
    requestAnimationFrame(function () {
      t.style.opacity = "1";
      t.style.transform = "translateY(0)";
    });
    setTimeout(function () {
      t.style.opacity = "0";
      t.style.transform = "translateY(-8px)";
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, ms || 2600);
  }

  function statsMarkup() {
    var info = levelInfo(data.xp);
    var badgeHtml = (data.badges || []).map(function (b) { return '<span class="gm-badge" title="' + b.replace(/-/g, " ") + '">' + (BADGES[b] || "\uD83C\uDFC5") + "</span>"; }).join("");
    return '<div class="gm-rank">' + info.icon + " <b>Level " + info.levelIndex + "</b> · " + info.title + "</div>" +
      '<div class="gm-bar"><div class="gm-fill" style="width:' + info.pct + '%"></div></div>' +
      '<div class="gm-xp">' + data.xp + " XP · " + (info.nextLevel ? info.nextLevel + " ke liye aur " + (info.next - data.xp) + " XP" : "max level") + "</div>" +
      '<div class="gm-row"><span class="gm-chip">🔥 ' + data.streak + " day streak</span><span class=\"gm-chip\">best " + data.bestStreak + "</span><span class=\"gm-chip\">⚡ " + data.totalSolved + " solved</span></div>" +
      '<div class="gm-badges">' + badgeHtml + "</div>";
  }

  var api = {
    award: award,
    load: load,
    loadInfo: loadInfo,
    leaderboard: leaderboard,
    levelInfo: levelInfo,
    badgeLabel: badgeLabel,
    showToast: showToast,
    statsMarkup: statsMarkup,
    data: function () { return data; },
    loaded: function () { return loaded; }
  };
  window.Gamify = api;

  function boot() {
    var local = storageGet();
    if (local && typeof local === "object") data = Object.assign(data, local);
    if (!window.firebase || !firebase.auth) { loaded = true; return; }
    window.addEventListener("auth:ready", function () { load(); });
    firebase.auth().onAuthStateChanged(function () { load(); });
    if (firebase.auth().currentUser) load();
  }

  window.addEventListener("gamify:toast", function (e) {
    if (e && e.detail && e.detail.text) showToast(e.detail.text);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();