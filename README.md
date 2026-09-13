# handBook — Java · Python · C++

Java ⇄ Python ⇄ C++ — DSA Learning Hub with Firebase login (email/password), hosted on GitHub Pages.

- `index.html` — launcher + PDF notes library (Placement Notes)
- `login.html` — Firebase login/register/signout gate (email + password)
- `auth-gate.js` + `firebase-config.js` — gate scripts jo har page ko login ke baad hi kholte hain
- `rosetta-dsa.html` — DSA Handbook (theory + code + quizzes, 20 chapters)
- `leetcode-200.html` — LeetCode Top 267 (topic-wise chapters, Java + Python + C++ solutions)
- `codingPrac.html` — DSA Practice Console (204 problems, AI code-gen + AI review via OpenRouter)
- `pdfs/` — complete placement notes (coloured-vector PDFs): DSA, OOP, SE, OS, COA, DBMS, CN + Cyber Security (all units combined)

Live: https://vinay123patel.github.io/handBook-Java_Python/

Service worker (`service-worker.js`) precaches the app shell + subject PDFs for offline use.

### Firebase setup (ek baar karna hai)
1. Firebase Console → project (`dsa-master-4acd3`) → Authentication → Sign-in method → **Email/Password** enable karo.
2. Project settings (⚙️) → Your apps → Web app (</>) add karo → mili hui `firebaseConfig` ko `firebase-config.js` mein paste karo.
3. Deploy karo — login gate apne aap active ho jayega.