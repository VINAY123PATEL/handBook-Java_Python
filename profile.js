/* DSA Hub — shared Profile module (name + optional photo + gender + password reset + logout) */
(function () {
  var KEY = "dsa_profile_v1";
  var ADMIN_EMAIL = "vinay9009patel@gmail.com";
  var user = { displayName: "", email: "", gender: "male", photo: "" };
  var loaded = false;

  function storageGet() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
  }
  function storageSet() {
    try { localStorage.setItem(KEY, JSON.stringify(user)); } catch (e) { }
  }
  function currentUser() {
    try { return window.firebase && firebase.auth && firebase.auth().currentUser; } catch (e) { return null; }
  }
  function isAdminNow() {
    try {
      if (window.UsageTracker && typeof UsageTracker.isAdmin === "function") return UsageTracker.isAdmin();
    } catch (e) { }
    try {
      var u = firebase.auth() && firebase.auth().currentUser;
      return !!(u && u.email && u.email.toLowerCase() === ADMIN_EMAIL);
    } catch (e) { return false; }
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
  function docRef(uid) {
    return firebase.firestore().collection("users").doc(uid);
  }

  function loadLocal() {
    var d = storageGet();
    if (d && typeof d === "object") {
      user = Object.assign(user, d);
    }
    loaded = true;
    render();
  }

  function loadFromCloud(next) {
    var u = currentUser();
    if (!u) { return next && next(); }
    ensureStore(function () {
      docRef(u.uid).get().then(function (doc) {
        if (doc.exists) {
          var d = doc.data() || {};
          user.displayName = d.displayName || user.displayName || u.displayName || "";
          user.email = u.email || user.email;
          user.gender = d.gender || "male";
          user.photo = d.photo || "";
          storageSet();
        } else {
          user.displayName = u.displayName || user.displayName || "";
          user.email = u.email || user.email;
          storageSet();
        }
        loaded = true;
        render();
        if (next) next();
      }).catch(function () {
        loaded = true;
        render();
        if (next) next();
      });
    });
  }

  function saveFields(fields) {
    var u = currentUser();
    if (!u) return;
    Object.assign(user, fields);
    try {
      u.updateProfile({ displayName: user.displayName, photoURL: user.photo || null }).catch(function () { });
    } catch (e) { }
    ensureStore(function () {
      var data = Object.assign({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, fields);
      docRef(u.uid).set(data, { merge: true }).catch(function () { });
    });
    storageSet();
    render();
    window.dispatchEvent(new CustomEvent("dsa:profile-updated", { detail: user }));
  }

  function initialsLabel(name, email) {
    var src = String(name || email || "?").trim();
    return src ? src.charAt(0).toUpperCase() : "?";
  }

  function resolveName() {
    var fb = null;
    try { fb = currentUser(); } catch (e) { }
    return user.displayName || (fb && fb.displayName) || user.email || (fb && fb.email) || "";
  }

  function avatarMarkup(name, email, photo, sizeClass) {
    var cls = sizeClass || "dsa-avatar-sm";
    if (photo) return '<span class="dsa-avatar ' + cls + '" style="background-image:url(' + photo + ')"></span>';
    return '<span class="dsa-avatar ' + cls + ' dsa-avatar-initial">' + initialsLabel(name, email) + '</span>';
  }

  function render() {
    var name = resolveName();
    var els = document.querySelectorAll("[data-dsa-name]");
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = name || "Account";
    }
    var avs = document.querySelectorAll("[data-dsa-avatar]");
    var tmp = avatarMarkup(user.displayName, user.email, user.photo);
    for (var j = 0; j < avs.length; j++) {
      avs[j].innerHTML = tmp;
    }
  }

  function resizeImage(file, maxDim, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function createStyle() {
    if (document.getElementById("dsa-profile-style")) return;
    var s = document.createElement("style");
    s.id = "dsa-profile-style";
    s.textContent =
      ".dsa-overlay{position:fixed;inset:0;background:rgba(5,10,20,.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px);}" +
      ".dsa-modal{background:#141d2b;border:1px solid #2a3a55;border-radius:16px;max-width:420px;width:100%;padding:26px;color:#e8eef7;font-family:'Space Grotesk',sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.5);}" +
      ".dsa-modal h3{margin:0 0 4px;font-size:20px;color:#fff;}" +
      ".dsa-modal .dsa-sub{font-size:12.5px;color:#8fa3bf;margin:0 0 20px;}" +
      ".dsa-modal label{display:block;font-size:12px;font-weight:700;color:#8fa3bf;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.5px;}" +
      ".dsa-modal input[type=text],.dsa-modal select,.dsa-modal .dsa-file-btn{width:100%;padding:10px 12px;background:#0e1522;border:1px solid #2a3a55;border-radius:8px;color:#e8eef7;font-family:'JetBrains Mono',monospace;font-size:13px;}" +
      ".dsa-modal input[type=text]{box-sizing:border-box;}" +
      ".dsa-modal select{appearance:none;cursor:pointer;}" +
      ".dsa-file-btn{display:block;text-align:left;cursor:pointer;border-style:dashed;position:relative;overflow:hidden;margin-top:8px;}" +
      ".dsa-file-btn input{position:absolute;inset:0;opacity:0;cursor:pointer;}" +
      ".dsa-avatar-preview{display:flex;align-items:center;gap:14px;margin-top:8px;}" +
      ".dsa-avatar{display:inline-block;width:44px;height:44px;border-radius:50%;background-size:cover;background-position:center;background-color:#1d2b42;flex-shrink:0;}" +
      ".dsa-avatar-sm{width:44px;height:44px;}" +
      ".dsa-avatar-xs{width:30px;height:30px;}" +
      ".dsa-avatar-initial{display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:#ffb86b;font-size:20px;border:1px solid #2a3a55;}" +
      ".dsa-modal .dsa-note{font-size:12px;color:#8fa3bf;margin-top:12px;line-height:1.5;}" +
      ".dsa-modal .dsa-btns{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap;}" +
      ".dsa-modal .dsa-btn{flex:1;min-width:120px;padding:11px 14px;border:none;border-radius:9px;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:13.5px;}" +
      ".dsa-btn-save{background:linear-gradient(135deg,#e08f2e,#c2701a);color:#fff;}" +
      ".dsa-btn-plain{background:#1c2942;color:#b7c6dd;border:1px solid #2a3a55;}" +
      ".dsa-btn-danger{background:transparent;color:#ff7b7b;border:1px solid #6a2a2a;}" +
      ".dsa-modal .dsa-msg{margin-top:14px;font-size:12.5px;line-height:1.5;display:none;padding:9px 12px;border-radius:8px;}" +
      ".dsa-msg.ok{display:block;background:#0e3220;border:1px solid #1f6b43;color:#9fe8c0;}" +
      ".dsa-msg.err{display:block;background:#3a1515;border:1px solid #6a2a2a;color:#ffb3b3;}" +
      ".dsa-admin{margin-top:20px;padding:16px;border:1px solid #5a3a22;background:#1a1711;border-radius:12px;}" +
      ".dsa-admin-title{font-size:12px;font-weight:800;color:#ffb86b;text-transform:uppercase;letter-spacing:.8px;margin:0 0 4px;}" +
      ".dsa-admin .dsa-msg{margin-top:10px;}" +
      ".dsa-admin button{margin-top:6px;}";
    document.head.appendChild(s);
  }

  function showModal() {
    createStyle();
    var u = currentUser();
    var overlay = document.createElement("div");
    overlay.className = "dsa-overlay";
    overlay.innerHTML =
      '<div class="dsa-modal">' +
      '<h3>My Profile</h3>' +
      '<p class="dsa-sub">' + (user.email || (u && u.email) || "") + "</p>" +
      '<div class="dsa-avatar-preview">' +
      '<span id="dsaAvatar">' + avatarMarkup(user.displayName, user.email, user.photo) + "</span>" +
      '<div style="flex:1;min-width:0">' +
      '<label>Profile photo (optional)</label>' +
      '<span class="dsa-file-btn">Choose photo…<input type="file" id="dsaPhotoInput" accept="image/*"></span>' +
      "</div>" +
      "</div>" +
      '<label for="dsaName">Name</label>' +
      '<input type="text" id="dsaName" placeholder="Enter your name">' +
      '<label for="dsaGender">Gender</label>' +
      '<select id="dsaGender">' +
      '<option value="male"' + (user.gender === "male" ? " selected" : "") + ">Male</option>" +
      '<option value="female"' + (user.gender === "female" ? " selected" : "") + ">Female</option>" +
      '<option value="other"' + (user.gender === "other" ? " selected" : "") + ">Other</option>" +
      "</select>" +
      '<div class="dsa-admin" id="dsaAdminWrap" style="display:none">' +
      '<div class="dsa-admin-title">Admin — AI keys (Firebase)</div>' +
      '<label for="dsaAdminOr">OpenRouter API key</label>' +
      '<input type="password" id="dsaAdminOr" placeholder="sk-or-v1-...">' +
      '<label for="dsaAdminGem">Gemini API key</label>' +
      '<input type="password" id="dsaAdminGem" placeholder="AIza...">' +
      '<label for="dsaAdminGemModel">Gemini model</label>' +
      '<input type="text" id="dsaAdminGemModel" placeholder="gemini-2.5-flash" value="gemini-2.5-flash">' +
      '<button class="dsa-btn dsa-btn-save" id="dsaAdminSave" type="button">Save keys to Firebase</button>' +
      '<div class="dsa-msg" id="dsaAdminMsg"></div>' +
      "</div>" +
      '<div class="dsa-note">Photo sirf account ke liye save hoti hai (Firestore users/{uid}), optional hai. Password change ke liye reset email aayega.</div>' +
      '<div class="dsa-msg" id="dsaMsg"></div>' +
      '<div class="dsa-btns">' +
      '<button class="dsa-btn dsa-btn-plain" id="dsaPwBtn" type="button">Change password</button>' +
      '<button class="dsa-btn dsa-btn-danger" id="dsaLogoutBtn" type="button">Log out</button>' +
      '<button class="dsa-btn dsa-btn-save" id="dsaSaveBtn" type="button">Save</button>' +
      "</div>" +
      "</div>";

    document.body.appendChild(overlay);

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });

    function setMsg(text, okFlag) {
      var el = overlay.querySelector("#dsaMsg");
      el.textContent = text;
      el.className = "dsa-msg " + (okFlag ? "ok" : "err");
    }

    var fileBtn = overlay.querySelector(".dsa-file-btn");
    fileBtn.addEventListener("click", function () {
      overlay.querySelector("#dsaPhotoInput").click();
    });

    overlay.querySelector("#dsaPhotoInput").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      resizeImage(file, 200, function (dataURL) {
        user.photo = dataURL;
        var av = overlay.querySelector("#dsaAvatar");
        av.innerHTML = avatarMarkup(user.displayName, user.email, user.photo);
      });
    });

    overlay.querySelector("#dsaSaveBtn").addEventListener("click", function () {
      var name = (overlay.querySelector("#dsaName").value || "").trim();
      var finalName = name ? name : user.displayName;
      saveFields({ displayName: finalName, gender: overlay.querySelector("#dsaGender").value, photo: user.photo });
      storageSet();
      setMsg("Profile save ho gayi.", true);
      setTimeout(close, 700);
    });

    overlay.querySelector("#dsaPwBtn").addEventListener("click", function () {
      var email = user.email || (u && u.email);
      if (!email) { setMsg("Email nahi mili.", false); return; }
      firebase.auth().sendPasswordResetEmail(email).then(function () {
        setMsg("Password reset email bheja gaya: " + email, true);
      }).catch(function () {
        setMsg("Reset email bhejne mein problem hui.", false);
      });
    });

    overlay.querySelector("#dsaLogoutBtn").addEventListener("click", function () {
      try {
        firebase.auth().signOut().then(function () {
          localStorage.removeItem("dsa_practice_progress_v1");
          try { sessionStorage.removeItem("dsa_openrouter_key"); } catch (err) { }
          location.replace("login.html");
        });
      } catch (e) { location.replace("login.html"); }
    });

    var adminWrap = overlay.querySelector("#dsaAdminWrap");
    function adminMsg(text, okFlag) {
      var el = overlay.querySelector("#dsaAdminMsg");
      el.textContent = text;
      el.className = "dsa-msg " + (okFlag ? "ok" : "err");
    }
    if (isAdminNow()) {
      adminWrap.style.display = "";
      ensureStore(function () {
        try {
          firebase.firestore().collection("settings").doc("general").get().then(function (doc) {
            if (!doc.exists) return;
            var d = doc.data() || {};
            if (d.openrouterApiKey) overlay.querySelector("#dsaAdminOr").value = d.openrouterApiKey;
            if (d.geminiApiKey) overlay.querySelector("#dsaAdminGem").value = d.geminiApiKey;
            if (d.geminiModel) overlay.querySelector("#dsaAdminGemModel").value = d.geminiModel;
          }).catch(function () { });
        } catch (e) { }
      });
      overlay.querySelector("#dsaAdminSave").addEventListener("click", function () {
        var or = overlay.querySelector("#dsaAdminOr").value.trim();
        var gm = overlay.querySelector("#dsaAdminGem").value.trim();
        var gmM = overlay.querySelector("#dsaAdminGemModel").value.trim() || "gemini-2.5-flash";
        function doSave() {
          firebase.firestore().collection("settings").doc("general").set({
            openrouterApiKey: or,
            geminiApiKey: gm,
            geminiModel: gmM
          }, { merge: true }).then(function () {
            adminMsg("Saved to Firebase — keys refresh ho rahe hain.", true);
            setTimeout(function () { location.reload(); }, 700);
          }).catch(function (err) {
            adminMsg("Save fail: " + (err && err.message ? err.message : err), false);
          });
        }
        if (window.firebase && firebase.firestore) doSave();
        else ensureStore(doSave);
      });
    }
  }

  window.DSAProfile = {
    loadLocal: loadLocal,
    loadFromCloud: loadFromCloud,
    get: function () { return user; },
    showModal: showModal,
    avatarMarkup: avatarMarkup,
    render: render,
    reload: function (next) { loadFromCloud(next); }
  };

  function boot() {
    loadLocal();
    if (!window.firebase || !firebase.auth) return;
    window.addEventListener("auth:ready", function () { loadFromCloud(); });
    firebase.auth().onAuthStateChanged(function (u) {
      if (u) loadFromCloud();
    });
    if (firebase.auth().currentUser) loadFromCloud();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();