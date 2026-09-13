# handBook — Java · Python · C++

Java ⇄ Python ⇄ C++ — DSA Learning Hub with Firebase login (email/password), hosted on GitHub Pages.

- `index.html` — launcher + PDF notes library (Placement Notes)
- `login.html` — Firebase login/register/signout gate (email + password)
- `auth-gate.js` + `firebase-config.js` — gate scripts jo har page ko login ke baad hi kholte hain
- `usage.js` — daily usage limits (Firestore per-user tracking)
- `rosetta-dsa.html` — DSA Handbook (theory + code + quizzes, 20 chapters)
- `leetcode-200.html` — LeetCode Top 267 (topic-wise chapters, Java + Python + C++ solutions)
- `codingPrac.html` — DSA Practice Console (204 problems, AI code-gen + AI review via OpenRouter/Gemini)
- `pdfs/` — complete placement notes (coloured-vector PDFs): DSA, OOP, SE, OS, COA, DBMS, CN + Cyber Security (all units combined)

Live: https://vinay123patel.github.io/handBook-Java_Python/

Service worker (`service-worker.js`) precaches the app shell + subject PDFs for offline use.

### Daily limits (`usage.js`, Firestore `usage/{uid}` doc)
- PDFs: 2/day · Questions (Rosetta/LeetCode/DSA-Hub): 10/day · CodingPrac "Mark as solved": 5/day
- Admin (`vinay9009patel@gmail.com`) — unlimited
- Limits are configurable from Firestore `settings/general`: `dailyPdfLimit`, `dailyQuestionLimit`, `dailyCodingLimit` (admin can also edit via CodingPrac → Admin Settings panel)

### Firestore rules (Settings → Firestore → Rules → paste & Publish)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /settings/{doc} {
      allow read: if request.auth != null;
      allow write: if request.auth.token.email == 'vinay9009patel@gmail.com';
    }
    match /usage/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

### Firebase setup (ek baar karna hai)
1. Firebase Console → project (`dsa-master-4acd3`) → Authentication → Sign-in method → **Email/Password** enable karo.
2. Project settings (⚙️) → Your apps → Web app (</>) add karo → mili hui `firebaseConfig` ko `firebase-config.js` mein paste karo.
3. Firestore → collection `settings`, doc `general` — fields: `openrouterApiKey`, `geminiApiKey`, `geminiModel` (optional daily limits).
4. Deploy karo — login gate aur daily limits apne aap active ho jayengi.