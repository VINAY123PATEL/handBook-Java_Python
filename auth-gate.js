(function () {
  var cfg = window.FIREBASE_CONFIG || {};
  var apiKey = (cfg.apiKey || "").trim();
  var projectId = (cfg.projectId || "").trim();

  function removeOverlay() {
    var ov = document.getElementById("auth-gate-overlay");
    if (ov) ov.parentNode && ov.parentNode.removeChild(ov);
  }

  if (!apiKey || !projectId) {
    var warn = document.createElement("div");
    warn.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#3a2a17;color:#f2c94c;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;padding:9px 14px;text-align:center;";
    warn.textContent = "Firebase config abhi set nahi hai - firebase-config.js kholo aur apne Firebase console ki keys daalo. Jab keys daal doge to login gate active ho jayega.";
    document.documentElement.appendChild(warn);
    return;
  }

  var overlay = document.createElement("div");
  overlay.id = "auth-gate-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#0b0e13;display:flex;align-items:center;justify-content:center;";
  var inner = document.createElement("div");
  inner.style.cssText = "text-align:center;font-family:'Space Grotesk','Segoe UI',Arial,sans-serif;color:#8a93a3;font-size:15px;letter-spacing:.5px;";
  inner.textContent = "Login check hoo raha hai...";
  overlay.appendChild(inner);
  document.documentElement.appendChild(overlay);

  function fail() {
    removeOverlay();
    return;
  }

  function init() {
    try {
      firebase.initializeApp(cfg);
    } catch (e) {
      fail();
      return;
    }
    try {
      firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () { });
      firebase.auth().onAuthStateChanged(function (user) {
        if (user) {
          removeOverlay();
          document.body && document.body.setAttribute("data-authed", "1");
          if (typeof window.dispatchEvent === "function") {
            window.dispatchEvent(new CustomEvent("auth:ready", { detail: { user: user } }));
          }
        } else {
          location.replace(cfg.loginUrl || "login.html");
        }
      });
    } catch (e) {
      fail();
    }
  }

  var s1 = document.createElement("script");
  s1.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js";
  s1.onerror = fail;
  s1.onload = function () {
    var s2 = document.createElement("script");
    s2.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js";
    s2.onerror = fail;
    s2.onload = init;
    document.head.appendChild(s2);
  };
  document.head.appendChild(s1);
})();