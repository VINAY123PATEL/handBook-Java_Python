# handBook-Java_Python

Java ⇄ Python — DSA Learning Hub, hosted on GitHub Pages.

- `index.html` — launcher (password-protected, default PIN `7067420802`, changeable)
- `rosetta-dsa.html` — DSA Handbook (theory + code + quizzes, 18 chapters)
- `leetcode-200.html` — LeetCode Top 267 (topic-wise chapters, Java + Python solutions)

Live: https://vinay123patel.github.io/handBook-Java_Python/

Android apps (online-first, offline fallback):
- DSA Handbook → loads `rosetta-dsa.html` from this site when online
- LeetCode 200 → loads `leetcode-200.html` from this site when online

Service worker (`service-worker.js`) precaches both content pages for offline use.
