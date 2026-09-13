var UsageTracker = (function () {
  var ADMIN_EMAIL = "vinay9009patel@gmail.com";
  var DB_INIT = { pdf: 0, questions: 0, coding: 0 };
  var DEFAULT_LIMITS = { pdf: 2, questions: 10, coding: 5 };
  var usage = null;
  var limits = { pdf: 2, questions: 10, coding: 5 };
  var today = new Date().toISOString().slice(0, 10);

  function isAdmin() {
    try {
      var u = firebase.auth().currentUser;
      return !!(u && u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
    } catch (e) { return false; }
  }

  function getDb() {
    if (window.firebase && window.firebase.firestore) return firebase.firestore();
    return null;
  }

  function ensureFirestore(cb) {
    if (getDb()) { cb(); return; }
    var s = document.createElement("script");
    s.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js";
    s.onload = cb;
    s.onerror = cb;
    document.head.appendChild(s);
  }

  function resetIfNewDay() {
    if (!usage || !usage.date || usage.date !== today) {
      usage = { date: today, pdf: 0, questions: 0, coding: 0 };
    }
  }

  function loadUsage(cb) {
    if (isAdmin()) { usage = { date: today, pdf: Infinity, questions: Infinity, coding: Infinity }; if (cb) cb(usage); return; }
    if (!window.firebase || !firebase.auth || !firebase.auth().currentUser) { usage = null; if (cb) cb(null); return; }
    ensureFirestore(function () {
      var user = firebase.auth().currentUser;
      getDb().collection("usage").doc(user.uid).get().then(function (doc) {
        if (doc.exists) usage = doc.data();
        resetIfNewDay();
        getDb().collection("settings").doc("general").get().then(function (sDoc) {
          if (sDoc.exists) {
            var d = sDoc.data();
            if (d.dailyPdfLimit) limits.pdf = parseInt(d.dailyPdfLimit, 10) || limits.pdf;
            if (d.dailyQuestionLimit) limits.questions = parseInt(d.dailyQuestionLimit, 10) || limits.questions;
            if (d.dailyCodingLimit) limits.coding = parseInt(d.dailyCodingLimit, 10) || limits.coding;
          }
          if (cb) cb(usage);
        }).catch(function () { if (cb) cb(usage); });
      }).catch(function () { usage = null; if (cb) cb(usage); });
    });
  }

  function saveUsage(cb) {
    if (isAdmin()) { if (cb) cb(); return; }
    var user = firebase.auth().currentUser;
    if (!user || !getDb()) { if (cb) cb(); return; }
    getDb().collection("usage").doc(user.uid).set(usage, { merge: true }).then(function () {
      if (cb) cb();
    }).catch(function () { if (cb) cb(); });
  }

  function canUse(field, cb) {
    if (isAdmin()) { cb(true); return; }
    var done = function () {
      resetIfNewDay();
      cb(usage === null || usage[field] < limits[field]);
    };
    if (usage === null) { loadUsage(done); } else { done(); }
  }

  function increment(field, cb) {
    if (isAdmin()) { if (cb) cb(true); return; }
    if (usage === null) {
      loadUsage(function () {
        resetIfNewDay();
        usage[field]++;
        saveUsage(function () { if (cb) cb(true); });
      });
      return;
    }
    resetIfNewDay();
    usage[field]++;
    saveUsage(function () { if (cb) cb(true); });
  }

  function getRemaining(field) {
    if (isAdmin()) return 0;
    if (usage === null) return limits[field];
    resetIfNewDay();
    return Math.max(0, limits[field] - usage[field]);
  }

  function getLimits() { return limits; }
  function getToday() { return today; }

  return {
    isAdmin: isAdmin,
    load: loadUsage,
    canUse: canUse,
    increment: increment,
    getRemaining: getRemaining,
    getLimits: getLimits,
    getToday: getToday
  };
})();