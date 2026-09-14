/* ============================================================
   DSA HUB — Site-wide Floating Bot (sitebot.js)
   - Har page pe floating chat button + panel
   - Reuse karta hai existing keys: sessionStorage dsa_openrouter_key
     + Firestore settings/general (openrouterApiKey, geminiApiKey, geminiModel)
   - Auto-failover: selected OpenRouter model → free OR models → Gemini models
   - Hint-first mentor: approach chhupata hai, pehle direction/sawaal deta hai
   - Full site knowledge embed: 17 topics + counts, XP/ranks/badges/streak rules
   ============================================================ */
(function () {
  if (window.SiteBot) return;
  window.SiteBot = {};
  var SB = window.SiteBot;

  /* ---------- SITE KNOWLEDGE (accurate, auto-updated by maintainers) ---------- */
  var KN = {
    siteName: "handBook-Java_Python — Java ⇄ Python ⇄ C++ DSA & Placement Hub",
    pages: {
      "index.html": "Home — nav + modules + Gamify XP/rank/badge strip + AI chat (profile, usage)",
      "codingPrac.html": "Coding Practice — 385 problems in 17 topics, per-problem AI chat (approach→code + AI code review), model/language select",
      "DSA-Hub.html": "DSA Hub — theory notes (Java ⇄ Python meeten)",
      "leetcode-200.html": "LeetCode 200 — must-do list ke solutions (Java/Python/C++)",
      "rosetta-dsa.html": "Rosetta DSA — ek hi baat tin bhasha me (Java ⇄ Python ⇄ C++)"
    },
    topics: [
      { key:"arrays", name:"Arrays", counts:{ e:6, m:10, h:10 }, total:26 },
      { key:"strings", name:"Strings", counts:{ e:3, m:10, h:10 }, total:23 },
      { key:"searching", name:"Searching", counts:{ e:2, m:10, h:10 }, total:22 },
      { key:"sorting", name:"Sorting", counts:{ e:3, m:10, h:10 }, total:23 },
      { key:"hashing", name:"Hashing", counts:{ e:2, m:10, h:10 }, total:22 },
      { key:"linkedlist", name:"Linked List", counts:{ e:6, m:10, h:10 }, total:26 },
      { key:"stacksqueues", name:"Stacks & Queues", counts:{ e:2, m:10, h:10 }, total:22 },
      { key:"trees", name:"Trees", counts:{ e:4, m:10, h:10 }, total:24 },
      { key:"heaps", name:"Heaps", counts:{ e:1, m:10, h:10 }, total:21 },
      { key:"graphs", name:"Graphs", counts:{ e:0, m:12, h:10 }, total:22 },
      { key:"recursion", name:"Recursion", counts:{ e:0, m:10, h:10 }, total:20 },
      { key:"dp", name:"Dynamic Programming", counts:{ e:1, m:14, h:10 }, total:25 },
      { key:"greedy", name:"Greedy", counts:{ e:1, m:11, h:10 }, total:22 },
      { key:"bitmanip", name:"Bit Manipulation", counts:{ e:7, m:10, h:10 }, total:27 },
      { key:"trie", name:"Trie", counts:{ e:0, m:10, h:10 }, total:20 },
      { key:"unionfind", name:"Union-Find (DSU)", counts:{ e:0, m:10, h:10 }, total:20 },
      { key:"twopointer", name:"Two Pointers", counts:{ e:0, m:10, h:10 }, total:20 }
    ],
    xp: { solve:10, quiz:5, pdf:1 },
    levels: [
      { min:0, title:"Noob Coder", icon:"🐣" },
      { min:100, title:"Beginner Dev", icon:"🚀" },
      { min:300, title:"Student", icon:"📘" },
      { min:600, title:"Problem Solver", icon:"⚡" },
      { min:1000, title:"Code Warrior", icon:"🔥" },
      { min:1600, title:"Algorithm Apprentice", icon:"🌟" },
      { min:2400, title:"Logic Crusher", icon:"🧠" },
      { min:3400, title:"DSA Hunter", icon:"🏹" },
      { min:4600, title:"Challenge Ace", icon:"🏆" },
      { min:6000, title:"DSA Master", icon:"🥇" },
      { min:8000, title:"Pro Master", icon:"💎" },
      { min:10500, title:"Grand Master", icon:"👑" },
      { min:13500, title:"Code Shinobi", icon:"🌀" },
      { min:17000, title:"DSA God", icon:"🏅" },
      { min:22000, title:"Legend", icon:"🐲" }
    ],
    badges: {
      "first-solve":"🎯 solved-5:🧩 solved-25:🚀 solved-50:💎 solved-100:🏆 quiz-10:🧠 pdf-20:📄 streak-3:🔥 streak-7:⚡ streak-30:🐲"
    },
    mod: {
      ai: "OpenRouter (OpenAI-compatible) ya Gemini — key Firebase settings/general me hoti hai. Free models: liquid/lfm-2.5-2.6b:free, google/gemma-4-31b-it:free, nvidia/nemotron-3.5-lightning:free, veera/veera-2.2-3b:free aadi. Gemini: gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-flash."
    }
  };
  SB.knowledge = KN;

  /* ---------- KEY MANAGEMENT (reuse existing session keys) ---------- */
  var orKey = "", gemKey = "", gemModel = "gemini-2.5-flash";
  try { orKey = sessionStorage.getItem("dsa_openrouter_key") || ""; } catch (e) { }

  function loadFirestoreKeys(cb) {
    if (!window.firebase || !firebase.auth) { cb(); return; }
    firebase.auth().onAuthStateChanged(function (user) {
      if (!user) { cb(); return; }
      loadFirestoreCompat(function () {
        try {
          firebase.firestore().collection("settings").doc("general").get().then(function (doc) {
            if (doc.exists) {
              var d = doc.data();
              gemKey = (d.geminiApiKey || "").trim();
              if (d.geminiModel && String(d.geminiModel).trim()) gemModel = String(d.geminiModel).trim();
              if (!orKey && d.openrouterApiKey) { orKey = (d.openrouterApiKey || "").trim(); try { sessionStorage.setItem("dsa_openrouter_key", orKey); } catch (e) { } }
            }
            cb();
          }).catch(function () { cb(); });
        } catch (e) { cb(); }
      });
    });
  }

  function loadFirestoreCompat(cb) {
    if (window.firebase && window.firebase.firestore) { cb(); return; }
    var s = document.createElement("script");
    s.src = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js";
    s.onload = cb; s.onerror = cb;
    document.head.appendChild(s);
  }

  var FREE_OR = ["liquid/lfm-2.5-2.6b:free", "google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-lightning:free", "veera/veera-2.2-3b:free"];
  var GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

  function firstKeyStatus() {
    if (orKey) return "OpenRouter ✓";
    if (gemKey) return "Gemini ✓";
    return "Koi AI key nahi — Admin Settings (Firebase Firestore settings/general) se daalo.";
  }

  /* ---------- API CALLS (same failover chain as codingPrac) ---------- */
  async function callOpenRouter(key, model, messages, maxTokens) {
    const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + key, "HTTP-Referer": "https://claude.ai", "X-Title": "DSA Hub Bot" };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: headers,
        body: JSON.stringify({ model: model, messages: messages, max_tokens: maxTokens || 2000, temperature: 0.4 }),
        signal: ctrl.signal
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "OpenRouter API error");
      if (!data.choices || !data.choices[0]) throw new Error("Empty response from " + model);
      return data.choices[0].message.content;
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("Timeout (45s) — " + model + " ne reply nahi diya");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function toGeminiContents(messages) {
    const out = [];
    messages.forEach(m => {
      const role = m.role === "assistant" ? "model" : "user";
      const last = out[out.length - 1];
      const text = (m.role === "system" ? "(System instruction): " : "") + m.content;
      if (last && last.role === role) last.parts[0].text += "\n\n" + text;
      else out.push({ role: role, parts: [{ text: text }] });
    });
    return out;
  }

  async function callGemini(model, messages, maxTokens) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": gemKey },
        body: JSON.stringify({ contents: toGeminiContents(messages), generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens || 2000 } }),
        signal: ctrl.signal
      });
      const data = await res.json();
      if (data && data.error) throw new Error(data.error.message || "Gemini API error");
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) throw new Error("Gemini: empty response");
      return data.candidates[0].content.parts.map(p => p.text || "").join("");
    } catch (e) {
      if (e && e.name === "AbortError") throw new Error("Timeout (45s) — " + model + " ne reply nahi diya");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  SB.send = async function (messages, maxTokens) {
    const errs = [];
    const orCands = [];
    FREE_OR.forEach(function (m) { if (orCands.indexOf(m) === -1) orCands.push(m); });
    if (orKey) {
      for (let i = 0; i < orCands.length; i++) {
        try { return await callOpenRouter(orKey, orCands[i], messages, maxTokens || 2000); }
        catch (e) { errs.push("OR/" + orCands[i] + ": " + e.message); }
      }
    }
    if (gemKey) {
      const gemList = []; if (gemModel) gemList.push(gemModel); GEMINI_MODELS.forEach(m => { if (gemList.indexOf(m) === -1) gemList.push(m); });
      for (let i = 0; i < gemList.length; i++) {
        try { return await callGemini(gemList[i], messages, maxTokens || 2000); }
        catch (e) { errs.push("Gemini/" + gemList[i] + ": " + e.message); }
      }
    }
    throw new Error("Sab AI provider fail ho gaye: " + (errs.join(" | ") || "koi key nahi"));
  };

  /* ---------- HINT-FIRST MENTOR SYSTEM PROMPT ---------- */
  function systemMsg() {
    const page = (location.pathname.split("/").pop()) || "index.html";
    const pageDesc = KN.pages[page] || "Koi site page";
    const topicList = KN.topics.map(t => t.name + " (" + t.total + ":" + t.counts.e + "e/" + t.counts.m + "m/" + t.counts.h + "h)").join(", ");
    return `You are "GYANBOT" — a friendly DSA mentor bot on the site ${KN.siteName}. You know the WHOLE site inside-out.

SITE KNOWLEDGE:
- Is page: ${page} → ${pageDesc}
- 17 topics: ${topicList}
- XP system: +10 solve, +5 quiz, +1 PDF.
- Levels: ${KN.levels.map(l => l.icon + " " + l.title + " (min " + l.min + " XP)").join(" → ")}
- Streak: daily solve rakho streak badhti hai. Badges: ${KN.badges["first-solve"]}
- AI: OpenRouter/Gemini keys admin ke paas hoti hain — free models available.

TEACHING STYLE (STRICT):
1. Hint-first: jab tak candidate apna approach/path na bataye, code ya complete solution kabhi mat do. Pehla jawab hamesha ek SMALL hint + ek guiding question ho.
2. Ek baar me sirf 1-2 hints do; do steps me pura solution mat dikhao.
3. Jab candidate apna approach bata de, tab use samjho, galat ho to batane ke bajaay 1 sawaal se sudhar lo; sahi ho to code likho (candidate ke approach ke anusaar, unki naming/language me).
4. Hinglish me baat karo (Hindi-English mix), friendly + encouraging.
5. Agar koi site ki cheez pooche (kisi topic me kitne problems, rank, XP kaise, key kaise) to correct numeric answer do upar diye knowledge se — kabhi guess mat karo.
6. Main question ka seedha jawab mat do jaldi — pehle thoda sochne do.

Current page: ${page}. Bare mein baat sab isi site ke context me hi karo.`;
  }

  /* ---------- UI: floating button + panel ---------- */
  function injectStyles() {
    if (document.getElementById("sb-style")) return;
    var css = `
#sbFab{position:fixed;right:18px;bottom:18px;z-index:99991;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#1e6f5c,#14919b);color:#fff;font-size:25px;box-shadow:0 6px 18px rgba(0,0,0,.35);transition:transform .15s;}
#sbFab:hover{transform:scale(1.08);}
#sbPanel{position:fixed;right:14px;bottom:86px;z-index:99992;width:min(380px,calc(100vw - 28px));max-height:min(600px,calc(100vh - 120px));display:none;flex-direction:column;background:#0e1118;color:#e7ecf3;border:1px solid #2a3547;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;}
#sbPanel.open{display:flex;}
#sbHead{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#101f23;border-bottom:1px solid #22303f;}
#sbHead b{flex:1;font-size:14px;}
#sbClose{background:none;border:none;color:#9fb0c3;font-size:18px;cursor:pointer;}
#sbBody{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.55;}
.sb-msg{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;}
.sb-msg.user{background:#12506b;color:#dceefb;align-self:flex-end;border-bottom-right-radius:3px;}
.sb-msg.bot{background:#1a2230;color:#e2e8f0;align-self:flex-start;border-bottom-left-radius:3px;}
.sb-msg.err{background:#3a2020;color:#ffc9c9;align-self:flex-start;}
.sb-msg.note{background:none;color:#8a93a3;font-style:italic;text-align:center;width:100%;}
#sbFoot{border-top:1px solid #22303f;padding:10px;display:flex;gap:8px;background:#0c0f15;}
#sbInput{flex:1;background:#141b26;border:1px solid #2a3547;border-radius:10px;color:#e7ecf3;padding:9px 11px;font-size:13px;font-family:inherit;resize:none;}
#sbSend{background:#14919b;border:none;border-radius:10px;color:#fff;padding:9px 16px;cursor:pointer;font-weight:600;}
#sbSend:disabled{opacity:.5;cursor:not-allowed;}
#sbStatus{font-size:11px;color:#7f8ea3;padding:2px 2px 0;border-bottom:1px solid #22303f;}
`;
    var st = document.createElement("style");
    st.id = "sb-style"; st.textContent = css;
    document.head.appendChild(st);
  }

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function buildPanel() {
    if (document.getElementById("sbPanel")) return;
    var host = document.createElement("div");
    host.innerHTML = `<button id="sbFab" title="GYANBOT — site ka sab kuch puchho">🤖</button>
<div id="sbPanel">
  <div id="sbHead"><b>🤖 GYANBOT</b><span id="sbKeys" style="font-size:11px;color:#7f8ea3;"></span><button id="sbClose" title="band karo">✕</button></div>
  <div id="sbStatus"></div>
  <div id="sbBody"></div>
  <div id="sbFoot"><textarea id="sbInput" rows="1" placeholder="Apna sawaal puchho…"></textarea><button id="sbSend">Send</button></div>
</div>`;
    document.body.appendChild(host);
    var fab = document.getElementById("sbFab");
    var panel = document.getElementById("sbPanel");
    document.getElementById("sbClose").addEventListener("click", function () { panel.classList.remove("open"); });
    fab.addEventListener("click", function () { panel.classList.toggle("open"); if (!panel.classList.contains("open")) return; if (!opened) { opened = true; openBot(); } });
    document.getElementById("sbInput").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBot(); } });
    document.getElementById("sbSend").addEventListener("click", sendBot);
    document.getElementById("sbKeys").textContent = firstKeyStatus();
    if (!opened) { /* wait for open to hydrate */ }
  }

  var history = [];
  var opened = false | !0;
  var thinking = null;

  function appendMsg(role, text, cls) {
    var body = document.getElementById("sbBody");
    if (!body) return;
    var d = document.createElement("div");
    d.className = "sb-msg " + (cls || role);
    d.textContent = text;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    if (role === "bot" || cls === "err") history.push({ role: "assistant", content: text });
    return d;
  }

  function openBot() {
    console.log("GYANBOT opened — reading firestore keys in background.");
    loadFirestoreKeys(function () {
      var el = document.getElementById("sbKeys");
      if (el) el.textContent = firstKeyStatus();
    });
    var body = document.getElementById("sbBody");
    if (body && body.children.length === 0) {
      appendMsg("note", "Namaste! 👋 Main TUMHARA site-bot hoon — codingPrac, DSA Hub, LeetCode 200, Rosetta — sab kuch mujhe pata hai.\nPehle apni approach/sawaal bolo — main pehle hint aur 1 sawaal doonga, phir tum apna plan bataoge toh code bhi milega.");
    }
  }

  async function sendBot() {
    var input = document.getElementById("sbInput");
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    var sendBtn = document.getElementById("sbSend");
    sendBtn.disabled = true;
    appendMsg("user", text);
    history.push({ role: "user", content: text });
    var th = appendMsg("bot", "Thinking…");
    try {
      if (!orKey && !gemKey) { /* keys firestore se aayi ho sakti hain; try load once */ await loadFirestoreKeys(function () { }); loadFirestoreKeys; }
      const messages = [{ role: "system", content: systemMsg() }].concat(history.slice(-14));
      const reply = await SB.send(messages, 1800);
      if (th) th.remove();
      appendMsg("bot", reply);
    } catch (err) {
      if (th) th.remove();
      appendMsg("err", "Error: " + err.message + "\n(Key Set karne ke liye: Firebase Firestore → settings/general → openrouterApiKey / geminiApiKey, phir page reload.)");
    } finally {
      sendBtn.disabled = false;
      var status = document.getElementById("sbStatus");
      if (status) status.textContent = "";
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    injectStyles();
    buildPanel();
    if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(maybeAutoOpen, 400);
    else window.addEventListener("DOMContentLoaded", function () { setTimeout(maybeAutoOpen, 600); });
  }

  /* Auto-open first visit so user sees the bot (only once per session). */
  function maybeAutoOpen() {
    var seen = false;
    try { seen = sessionStorage.getItem("dsa_sb_autoopened") === "1"; } catch (e) { }
    if (seen) return;
    try { sessionStorage.setItem("dsa_sb_autoopened", "1"); } catch (e) { }
    if (!window.firebase || !window.firebase.auth) { /* still open */ }
    var panel = document.getElementById("sbPanel");
    if (panel) { panel.classList.add("open"); if (!opened) { opened = true; openBot(); } }
  }

  SB.open = function () { var p = document.getElementById("sbPanel"); if (p) { p.classList.add("open"); if (!opened) { opened = true; openBot(); } } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
