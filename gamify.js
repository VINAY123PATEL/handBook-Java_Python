/* DSA Hub — Gamification v2: XP, ranks, streak, badges, per-topic medals, daily goal, leaderboard
   Game-feel: har solve me progress, har topic ke apne badges, rank titles (Noob → Legend),
   daily goal + confetti celebration. Data syncs via Firestore users/{uid}/gamify. */
(function () {
  var CACHE_KEY = "dsa_gamify_v2";
  var LEVELS = [
    { min: 0, title: "Noob Coder", icon: "\uD83D\uDC23" },
    { min: 100, title: "Beginner Dev", icon: "\uD83D\uDE80" },
    { min: 300, title: "Student", icon: "\uD83D\uDCD8" },
    { min: 600, title: "Problem Solver", icon: "\u26A1" },
    { min: 1000, title: "Code Warrior", icon: "\uD83D\uDD25" },
    { min: 1600, title: "Algorithm Apprentice", icon: "\uD83C\uDF1F" },
    { min: 2400, title: "Logic Crusher", icon: "\uD83E\uDDE0" },
    { min: 3400, title: "DSA Hunter", icon: "\uD83C\uDFF9" },
    { min: 4600, title: "Challenge Ace", icon: "\uD83E\uDD48" },
    { min: 6000, title: "DSA Master", icon: "\uD83E\uDD47" },
    { min: 8000, title: "Pro Master", icon: "\uD83D\uDC8E" },
    { min: 10500, title: "Grand Master", icon: "\uD83D\uDC51" },
    { min: 13500, title: "Code Shinobi", icon: "\uD83C\uDF00" },
    { min: 17000, title: "DSA God", icon: "\uD83C\uDFC6" },
    { min: 22000, title: "Legend", icon: "\uD83D\uDC32" }
  ];
  var TOPIC_ICONS = [
    "\uD83D\uDCD6", "\uD83D\uDD0D", "\uD83C\uDF82", "\uD83D\uDCC4", "\uD83D\uDCE6",
    "\uD83D\uDD17", "\uD83E\uDD80", "\uD83C\uDF32", "\uD83C\uDFD9", "\uD83E\uDDED",
    "\uD83D\uDD04", "\uD83E\uDDEE", "\uD83D\uDC62", "\uD83E\uDDE0", "\uD83D\uDDA5",
    "\uD83D\uDE90", "\uD83C\uDFB4"
  ];
  var TOPIC_BADGE_TARGET = 0.5;
  function topicIcon(key, index) { return TOPIC_ICONS[Math.abs((index == null ? 0 : index)) % TOPIC_ICONS.length]; }
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

  var data = {
    xp: 0, streak: 0, bestStreak: 0, lastDay: "", visitedToday: false, badges: [],
    totalSolved: 0, quizzes: 0, pdfs: 0,
    topics: {}, dailyGoalDate: "", dailySolved: 0, dailyTarget: 5, dailyBoosted: false
  };
  var loaded = false;
  var _topicAgg = null;

  function setTopicAgg(agg) { _topicAgg = agg || null; }

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

  function rollDaily() {
    var today = todayISO();
    if (data.dailyGoalDate !== today) {
      data.dailyGoalDate = today;
      data.dailySolved = 0;
      data.dailyTarget = data.dailyTarget || 5;
      data.dailyBoosted = false;
    }
  }

  function topicState(key, name) {
    var t = data.topics[key] || { name: name || key, n: 0, e: 0, m: 0, h: 0, te: 0, tm: 0, th: 0 };
    return t;
  }

  function topicTarget(t) {
    var total = (t.te || 0) + (t.tm || 0) + (t.th || 0);
    if (total <= 0) return 1;
    return Math.max(1, Math.ceil(total * TOPIC_BADGE_TARGET));
  }

  function topicBadgeState(key) {
    var t = topicState(key, null);
    var cur = t.n || 0;
    var target = topicTarget(t);
    var total = (t.te || 0) + (t.tm || 0) + (t.th || 0);
    return { earned: cur >= target, cur: cur, target: target, total: total, pct: Math.max(0, Math.min(100, Math.round((total ? cur / total : 0) * 100))) };
  }

  function bumpTopicSolve(o) {
    if (!o.topic) return { bonus: 0, unlocked: [] };
    var key = String(o.topic);
    var t = topicState(key, o.topicName);
    t.name = o.topicName || t.name;
    var diff = (o.diff === "e" || o.diff === "m" || o.diff === "h") ? o.diff : "m";
    var tot = o.totals || {};
    if (tot.e) t.te = tot.e;
    if (tot.m) t.tm = tot.m;
    if (tot.h) t.th = tot.h;
    t.n++;
    t[diff]++;
    data.topics[key] = t;
    var id = "topic-" + key;
    var bonus = 0, unlocked = [];
    if (topicBadgeState(key).earned && data.badges.indexOf(id) === -1) {
      data.badges.push(id);
      unlocked.push(id);
      bonus = 30;
      data.xp += bonus;
    }
    return { bonus: bonus, unlocked: unlocked, title: t.name };
  }

  function topicTiers(key, name) {
    var t = topicState(key, name);
    var st = topicBadgeState(key);
    var total = st.total || 1;
    return [{
      key: "badge",
      label: (name || t.name || key),
      icon: topicIcon(key, 0),
      earned: st.earned,
      cur: st.cur,
      target: st.target,
      total: total,
      pct: st.pct
    }];
  }

  function topicMedal(key) {
    if (!data.topics[key]) return "";
    if (topicBadgeState(key).earned) return topicIcon(key, 0);
    return "";
  }

  function badgeLabel(id) {
    if (id.indexOf("topic-") === 0) {
      var parts = id.split("-");
      var key = parts[1];
      var t = data.topics[key];
      var nm = (t && t.name) || key;
      return topicIcon(key, 0) + " " + nm;
    }
    return (BADGES[id] || "\uD83C\uDFC5") + " " + id.replace(/-/g, " ");
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
      persist(function () { emit("gamify:update", { silent: true }); });
      return;
    }
    if (section === "visit") data.visitedToday = true;
    if (section === "solve") {
      data.totalSolved++;
      rollDaily();
      data.dailySolved++;
    }
    if (section === "quiz") data.quizzes++;
    if (section === "pdf") data.pdfs++;
    data.xp += pts;

    var bonus = 0;
    var tierUnlocked = [];
    var dayGoalDone = false;
    if (section === "solve") {
      var res = bumpTopicSolve(o);
      bonus += res.bonus;
      tierUnlocked = res.unlocked;
      if (data.dailySolved >= data.dailyTarget && !data.dailyBoosted) {
        data.dailyBoosted = true;
        bonus += 20;
        dayGoalDone = true;
      }
    }

    var info2 = levelInfo(data.xp);
    var leveled = info2.levelIndex > info.levelIndex;
    var newBadges = checkBadges().concat(tierUnlocked);
    var msg = o.text || (pts > 0 ? "+" + pts + " XP" : "");

    persist(function () {
      if (o.silent) { emit("gamify:update", { silent: true }); return; }
      var pieces = ["\u2728 " + msg];
      if (bonus > 0) pieces.push("\uD83C\uDF81 Bonus +" + bonus + " XP");
      newBadges.forEach(function (id) { pieces.push("\uD83C\uDF1F Badge: " + badgeLabel(id)); });
      if (dayGoalDone) pieces.push("\uD83C\uDFAF Aaj ka goal (" + data.dailyTarget + "/" + data.dailyTarget + ") pura — +20 XP!");
      if (leveled) pieces.push("\uD83C\uDF89 Naya rank: " + info2.icon + " " + info2.title + "!");
      emit("gamify:toast", { text: pieces.join("<br>"), data: data });
      emit("gamify:update", {});
      if (leveled || tierUnlocked.length || dayGoalDone) celebrate();
    });
  }

  function celebrate() {
    var body = document.body;
    if (!body) return;
    var colors = ["#e08f2e", "#4ade80", "#38bdf8", "#f472b6", "#facc15"];
    for (var i = 0; i < 30; i++) {
      (function (i) {
        var c = document.createElement("div");
        c.style.cssText = "position:fixed;z-index:99999;width:" + (6 + Math.random() * 6) + "px;height:" + (6 + Math.random() * 6) + "px;background:" + colors[i % colors.length] + ";border-radius:2px;pointer-events:none;left:50%;top:50%;opacity:1;transform:translate(-50%,-50%) rotate(0deg);";
        body.appendChild(c);
        var dx = (Math.random() * 2 - 1) * 240;
        var dy = -140 - Math.random() * 340;
        var rot = (Math.random() * 2 - 1) * 720;
        var dur = 900 + Math.random() * 700;
        requestAnimationFrame(function () {
          c.style.transition = "transform " + dur + "ms cubic-bezier(.2,.8,.4,1), opacity " + dur + "ms ease";
          c.style.transform = "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px)) rotate(" + rot + "deg)";
          c.style.opacity = "0";
        });
        setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, dur + 120);
      })(i);
    }
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

  function topTopicMedalsHtml() {
    var keys = Object.keys(data.topics || {}).sort(function (a, b) {
      return (data.topics[b].n - data.topics[a].n);
    }).slice(0, 5);
    return keys.map(function (k) {
      var t = data.topics[k];
      var icon = topicMedal(k);
      return '<span class="gm-badge" title="' + (t.name || k) + " — " + t.n + ' solved · rank: ' + (icon || "in progress") + '">' + (icon || "\uD83D\uDD39") + "</span>";
    }).join("");
  }

  function statsMarkup() {
    var info = levelInfo(data.xp);
    var steps = nextLevelSteps();
    var badgeHtml = (data.badges || []).map(function (b) { return '<span class="gm-badge" title="' + badgeLabel(b) + '">' + ((b.indexOf("topic-") === 0 ? badgeLabel(b).split(" ")[0] : BADGES[b]) || "\uD83C\uDFC5") + "</span>"; }).join("");
    return '<div class="gm-rank">' + info.icon + " <b>" + info.title + "</b> <span class=\"gm-lv\">Lv" + info.levelIndex + "</span></div>" +
      '<div class="gm-bar"><div class="gm-fill" style="width:' + info.pct + '%"></div></div>' +
      '<div class="gm-xp">' + data.xp + " XP · " + (info.nextLevel ? steps.solves + " problems \u2192 " + info.nextLevel : "max rank!") + "</div>" +
      '<div class="gm-row"><span class="gm-chip">🔥 ' + data.streak + " day streak</span><span class=\"gm-chip\">best " + data.bestStreak + "</span><span class=\"gm-chip\">⚡ " + data.totalSolved + " solved</span><span class=\"gm-chip\">🎯 aaj " + (data.dailySolved || 0) + "/" + (data.dailyTarget || 5) + "</span></div>" +
      '<div class="gm-badges">' + topTopicMedalsHtml() + badgeHtml + '<button class="gm-viewall" type="button" title="Poori badge gallery dekho">View all</button>' + "</div>";
  }

  function milestoneDefs() {
    return [
      { id: "first-solve", label: "First Blood", icon: "\uD83C\uDFAF", cur: data.totalSolved, target: 1 },
      { id: "solved-5", label: "Solved 5", icon: "\uD83E\uDDE9", cur: data.totalSolved, target: 5 },
      { id: "solved-25", label: "Solved 25", icon: "\uD83D\uDE80", cur: data.totalSolved, target: 25 },
      { id: "solved-50", label: "Solved 50", icon: "\uD83D\uDC8E", cur: data.totalSolved, target: 50 },
      { id: "solved-100", label: "Solved 100", icon: "\uD83C\uDFC6", cur: data.totalSolved, target: 100 },
      { id: "quiz-10", label: "Quiz 10", icon: "\uD83E\uDDE0", cur: data.quizzes, target: 10 },
      { id: "pdf-20", label: "PDF 20", icon: "\uD83D\uDCC4", cur: data.pdfs, target: 20 },
      { id: "streak-3", label: "Streak 3", icon: "\uD83D\uDD25", cur: data.bestStreak, target: 3 },
      { id: "streak-7", label: "Streak 7", icon: "\u26A1", cur: data.bestStreak, target: 7 },
      { id: "streak-30", label: "Streak 30", icon: "\uD83D\uDC09", cur: data.bestStreak, target: 30 }
    ];
  }

  function rankRowsHtml() {
    var curIdx = levelInfo(data.xp).levelIndex - 1;
    var html = "";
    LEVELS.forEach(function (L, i) {
      var done = data.xp >= L.min;
      var cls = "gm-rank-row" + (done ? " done" : "") + (i === curIdx ? " cur" : "") + (i === curIdx + 1 ? " target" : "");
      html += '<div class="' + cls + '"><span class="gm-ri">' + L.icon + '</span><span class="gm-rn">' + L.title + '</span><span class="gm-rx">' + L.min + ' XP</span>' + (i === curIdx ? '<span class="gm-rtag">● aap yahan ho</span>' : (done ? '<span class="gm-rtag ok">✓</span>' : "")) + "</div>";
    });
    return html;
  }

  function milestoneHtml() {
    return milestoneDefs().map(function (b) {
      var earned = data.badges.indexOf(b.id) !== -1;
      var p = Math.max(0, Math.min(100, Math.round((b.target ? b.cur / b.target : 0) * 100)));
      return '<div class="gm-card' + (earned ? " earned" : "") + '">' +
        '<div class="gm-ci">' + b.icon + "</div>" +
        '<div class="gm-cl">' + b.label + "</div>" +
        '<div class="gm-minibar"><div style="width:' + p + '%"></div></div>' +
        '<div class="gm-cx">' + b.cur + '/' + b.target + (earned ? " · unlocked \u2713" : "") + "</div>" +
        "</div>";
    }).join("");
  }

  function nextRankInfo() {
    var xp = data.xp;
    for (var i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].min > xp) return { rank: LEVELS[i].title, icon: LEVELS[i].icon, min: LEVELS[i].min, need: LEVELS[i].min - xp, index: i + 1 };
    }
    return null;
  }

  function nextLevelSteps() {
    var nr = nextRankInfo();
    if (!nr) return { done: true, rank: LEVELS[LEVELS.length - 1].title, icon: LEVELS[LEVELS.length - 1].icon, need: 0, solves: 0, quizzes: 0, pdfs: 0 };
    return {
      done: false,
      rank: nr.rank,
      icon: nr.icon,
      need: nr.need,
      solves: Math.ceil(nr.need / POINTS.solve),
      quizzes: Math.ceil(nr.need / POINTS.quiz),
      pdfs: Math.ceil(nr.need / POINTS.pdf),
      dailyTarget: data.dailyTarget || 5
    };
  }

  function nextHintMarkup() {
    var s = nextLevelSteps();
    if (s.done) return 'Aap max rank <b>' + s.icon + " " + s.rank + "</b> pe ho \u2014 koi hat leyo! \uD83C\uDFC6";
    var lines = [];
    lines.push('Agla rank <b>' + s.icon + " " + s.rank + '</b> ke liye aur <b>' + s.need + " XP</b> chahiye.");
    lines.push('<b>' + s.solves + " problems</b> solve karo (10 XP har ek) = " + (s.solves * 10) + " XP; ya <b>" + s.quizzes + " quiz</b> (5 XP); ya <b>" + s.pdfs + " PDF</b> (1 XP).");
    lines.push("Daily goal (" + s.dailyTarget + " problems/day) karo to +20 bonus XP \u2014 aur streak mat toda, champ! \uD83D\uDD25");
    return lines.join("<br>");
  }

  function topicCardsHtml(agg) {
    var keys;
    if (agg && agg.length) keys = agg.map(function (a) { return a.key; });
    else keys = Object.keys(data.topics || {});
    if (!keys.length) return '<div class="gm-empty">Abhi koi topic solve nahi kiya — Coding Practice kholo aur shuruaat karo! 🎯</div>';
    return keys.map(function (k) {
      var a = null;
      if (agg) {
        for (var i = 0; i < agg.length; i++) { if (agg[i].key === k) { a = agg[i]; break; } }
      }
      var st = data.topics[k] || null;
      var name = (st && st.name) || (a && a.name) || k;
      var te = (st && st.te) || (a ? a.totals.e : 0);
      var tm = (st && st.tm) || (a ? a.totals.m : 0);
      var th = (st && st.th) || (a ? a.totals.h : 0);
      var ce = (st && st.e) || 0;
      var cm = (st && st.m) || 0;
      var ch = (st && st.h) || 0;
      var cn = (st && st.n) || 0;
      var total = te + tm + th;
      var tiers = topicTiers(k);
      var bubbles = tiers.map(function (ti) {
        var curT, tarT;
        if (ti.key === "easy") { curT = ce; tarT = te; }
        else if (ti.key === "medium") { curT = cm; tarT = tm; }
        else if (ti.key === "hard") { curT = ch; tarT = th; }
        else { curT = cn; tarT = total || 1; }
        var prog = (tarT > 0 && ti.key !== "start") ? ' <span class="gm-tag">' + Math.min(curT, tarT) + "/" + tarT + "</span>" : "";
        return '<span class="gm-tier' + (ti.earned ? " earned" : "") + '" title="' + ti.label + '">' + (ti.earned ? ti.icon : "\uD83D\uDD12") + prog + "</span>";
      }).join("");
      var done = total > 0 && cn >= total;
      return '<div class="gm-topic">' +
        '<div class="gm-tn">' + name + '</div>' +
        '<div class="gm-tiers">' + bubbles + "</div>" +
        '<div class="gm-cx">' + cn + '/' + (total || cn) + " solved" + (done ? " · \uD83C\uDF89 complete!" : "") + "</div>" +
        "</div>";
    }).join("");
  }

  function galleryMarkup(agg) {
    var info = levelInfo(data.xp);
    return '<div class="gm-gall">' +
      "<h3>\uD83C\uDFC5 My Badges &amp; Ranks</h3>" +
      '<p class="gm-sub">Progress ke hisaab se naye badges khulte jaate hain \u2014 niche sab dikh raha hai: kya mila, kya baaki. Best of luck, champ!</p>' +
      '<div class="gm-next">Aap abhi: <b>' + info.icon + " " + info.title + "</b> (Lv" + info.levelIndex + ").<br>" +
      nextHintMarkup() + "</div>" +
      '<div class="gm-sec"><div class="gm-sec-t">\uD83D\uDD10 Ranks (XP ladder)</div><div class="gm-rlist">' + rankRowsHtml() + "</div></div>" +
      '<div class="gm-sec"><div class="gm-sec-t">\uD83E\uDDE9 Milestone Badges</div><div class="gm-grid">' + milestoneHtml() + "</div></div>" +
      '<div class="gm-sec"><div class="gm-sec-t">\uD83D\uDCC1 Topic Badges <span class="gm-sub2">\u2014 har topic me 5 levels carve karo: 1 Solve \u2192 Easy Cleared \u2192 Medium Cleared \u2192 Hard Cleared \u2192 Topic Master</span></div><div class="gm-grid t">' + topicCardsHtml(agg) + "</div></div>" +
      '<button class="gm-close" type="button">Close \u2715</button>' +
      "</div>";
  }

  function createGalleryStyle() {
    if (document.getElementById("gm-gall-style")) return;
    var s = document.createElement("style");
    s.id = "gm-gall-style";
    s.textContent =
      ".gm-gov{position:fixed;inset:0;background:rgba(5,10,20,.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px);}" +
      ".gm-gall{background:#101a29;border:1px solid #2a3a55;border-radius:16px;max-width:680px;width:100%;max-height:88vh;overflow-y:auto;padding:24px;color:#e8eef7;font-family:'Space Grotesk','Segoe UI',sans-serif;box-shadow:0 24px 70px rgba(0,0,0,.6);}" +
      ".gm-gall h3{margin:0 0 4px;font-size:21px;color:#fff;}" +
      ".gm-gall .gm-sub{font-size:12.5px;color:#8fa3bf;margin:0 0 14px;line-height:1.5;}" +
      ".gm-gall .gm-sub2{font-size:11.5px;color:#8fa3bf;font-weight:400;}" +
      ".gm-next{font-size:12.5px;background:#0b1422;border:1px solid #2a3a55;border-radius:10px;padding:10px 12px;line-height:1.6;color:#c9d7ea;margin-bottom:16px;}" +
      ".gm-next b{color:#ffb86b;}" +
      ".gm-sec{margin:18px 0 6px;}" +
      ".gm-sec-t{font-size:12px;font-weight:800;color:#8fa3bf;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;}" +
      ".gm-rlist{display:flex;flex-direction:column;gap:5px;}" +
      ".gm-rank-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;border:1px solid transparent;font-size:13px;color:#7b8eab;}" +
      ".gm-rank-row.done{color:#bfe6ce;}" +
      ".gm-rank-row.cur{background:#1c2942;border-color:#e08f2e;color:#fff;font-weight:700;}" +
      ".gm-rank-row.target{border:1px dashed #2a3a55;color:#ffd28a;}" +
      ".gm-rank-row .gm-ri{font-size:17px;width:22px;text-align:center;}" +
      ".gm-rank-row .gm-rn{flex:1;}" +
      ".gm-rank-row .gm-rx{font-family:'JetBrains Mono',monospace;font-size:11px;color:#7b8eab;}" +
      ".gm-rank-row.cur .gm-rtag{font-size:10px;color:#ffb86b;}" +
      ".gm-rtag{font-size:10px;color:#4a8090;}" +
      ".gm-rtag.ok{color:#4ade80;}" +
      ".gm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;}" +
      ".gm-grid.t{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));}" +
      ".gm-card{background:#0b1422;border:1px solid #2a3a55;border-radius:11px;padding:12px;text-align:center;}" +
      ".gm-card.earned{border-color:#e08f2e;background:#1a1508;box-shadow:0 4px 14px rgba(224,143,46,.18);}" +
      ".gm-card .gm-ci{font-size:26px;margin-bottom:4px;filter:grayscale(1);opacity:.55;}" +
      ".gm-card.earned .gm-ci{filter:none;opacity:1;}" +
      ".gm-card .gm-cl{font-size:12px;font-weight:700;color:#c9d7ea;margin-bottom:7px;}" +
      ".gm-card.earned .gm-cl{color:#ffd28a;}" +
      ".gm-minibar{height:5px;border-radius:99px;background:#1c2942;overflow:hidden;margin-bottom:6px;}" +
      ".gm-minibar div{height:100%;background:#4ade80;border-radius:99px;transition:width .3s;}" +
      ".gm-card .gm-cx{font-size:11px;color:#7b8eab;font-family:'JetBrains Mono',monospace;}" +
      ".gm-empty{grid-column:1/-1;font-size:12.5px;color:#8fa3bf;background:#0b1422;border:1px dashed #2a3a55;border-radius:10px;padding:16px;text-align:center;}" +
      ".gm-topic{background:#0b1422;border:1px solid #2a3a55;border-radius:11px;padding:12px 12px 10px;}" +
      ".gm-topic .gm-tn{font-size:13px;font-weight:800;color:#e8eef7;margin-bottom:8px;}" +
      ".gm-tiers{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:7px;}" +
      ".gm-tier{display:inline-flex;align-items:center;gap:4px;font-size:16px;border:1px solid #2a3a55;border-radius:8px;padding:3px 7px;filter:grayscale(.9);opacity:.5;}" +
      ".gm-tier.earned{border-color:#e08f2e;background:#1a1508;filter:none;opacity:1;box-shadow:0 2px 8px rgba(224,143,46,.25);}" +
      ".gm-tier .gm-tag{font-size:10px;color:#ffd28a;font-family:'JetBrains Mono',monospace;}" +
      ".gm-viewall{background:#1c2942;border:1px solid #e08f2e;color:#ffd28a;font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 10px;border-radius:99px;cursor:pointer;margin-left:6px;align-self:center;}" +
      ".gm-viewall:hover{background:#262f4a;}" +
      ".gm-close{margin-top:18px;width:100%;padding:10px;background:linear-gradient(135deg,#e08f2e,#c2701a);color:#fff;border:none;border-radius:9px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:13.5px;cursor:pointer;}" +
      ".gm-fade{animation:gmFade .18s ease;}@keyframes gmFade{from{opacity:0;}to{opacity:1;}}";
    document.head.appendChild(s);
  }

  function showGallery(agg) {
    createGalleryStyle();
    var ov = document.createElement("div");
    ov.className = "gm-gov gm-fade";
    ov.innerHTML = galleryMarkup(agg);
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) {
      var t = e.target;
      if (t === ov || (t.classList && t.classList.contains("gm-close"))) {
        if (ov.parentNode) ov.parentNode.removeChild(ov);
      }
    });
  }

  function showToast(text, ms) {
    if (document.getElementById("gamify-toast")) return;
    var t = document.createElement("div");
    t.id = "gamify-toast";
    t.style.cssText = "position:fixed;top:18px;right:18px;z-index:99998;max-width:320px;background:#1a2434;border:1px solid #e08f2e;color:#ffe3b3;padding:14px 16px;border-radius:12px;font-family:'Space Grotesk','Segoe UI',sans-serif;font-size:13.5px;font-weight:600;line-height:1.55;box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:0;transform:translateY(-8px);transition:opacity .25s ease,transform .25s ease;";
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
    }, ms || 3400);
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
    showGallery: showGallery,
    setTopicAgg: setTopicAgg,
    nextLevelSteps: nextLevelSteps,
    topicTiers: topicTiers,
    topicMedal: topicMedal,
    data: function () { return data; },
    loaded: function () { return loaded; }
  };
  window.Gamify = api;

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

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains("gm-viewall")) {
      showGallery(_topicAgg);
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();