# Writing Qortino golden answers

Qortino answers a question straight from this set when it matches one of an
entry's phrasings closely (score ≥ 0.6), with no model involved, and passes a
looser match (0.45–0.6) to the model as a hint. Matching is plain word
overlap: stemmed words of the question against `q` and every alias. So the
words in `q` and `aliases` decide whether an entry is ever found, and the
answer is shown to people exactly as written.

## Format

One JSON object per line:

```json
{"id":"torq-012","category":"qortal","q":"How do I post a Rev on Torq?","aliases":["torq rev","post a story on torq","how to make a rev","torq stories","add rev torq"],"a":"…","priority":2,"source":"~/Desktop/Torq/README.md"}
```

- `id`: the file's prefix plus a 3-digit number, unique across all files.
- `category`: `qortal` for everything about Qortal, its apps, Hub, GO,
  Reticulum in Qortal, and Qortal hardware. (It turns on Qortal links and app
  cards under the answer.)
- `q`: the question as people ask it, ending in `?`.
- `aliases`: 4–8 other ways to ask, short and casual included ("torq fees",
  "how post torq", "cant see my post torq"). Every alias must carry the
  entry's distinguishing words (app or feature names). Never a bare generic
  alias such as "how does it work" or "what is this": it would match unrelated
  questions.
- `a`: the answer, 1–6 short sentences, or a few steps separated by `\n`.
- `priority`: 1 = asked by almost everyone, 2 = common, 3 = niche.
- `source`: where the facts come from (file path, `qortal.dev/…`,
  `qortal.org/…`, a Q-App name). Kept for review; not shipped in the app.

## Rules

1. **Only facts you found in a source.** If a detail (number, fee, menu name,
   version, date) is not in a source, leave it out or leave the entry out.
   Fewer correct entries beat more guessed ones. Never invent a Q-App, a
   setting, a button or a command.
2. **Current names (November 2026):** Torq is the social app; it reads and
   writes the same QDN data as Quitter, so a Quitter account and posts carry
   over. Qortal Hub is the desktop app (Hub 3.0); Qortal GO (GO 3.0) is the
   Android app. Say Torq, not Quitter, for posting and feeds; mention Quitter
   only for compatibility.
   Recommend the stable apps (Q-Mail, Q-Share, Q-Tube, Q-Shop, Names,
   Q-Mintership…). Their "+" versions (Q-Mail+, Q-Share+…, the Q-Apps+
   launcher) are pre-release: bring one up only when the question is about
   it, call it a pre-release test version and name the stable app to use.
   POS+ and Host-Monitor-Plus are apps of their own, not "+" versions.
3. **No web links** (`http`, `www.`) in answers. Name the Q-App, the menu or
   the site instead ("open the Welcome to Qortal Q-App", "on qortal.dev").
   `qortal://APP/<name>` links are fine.
4. **Plain and calm:** "you", short words, no hype, no emoji, no closing pep
   talk. Explain any jargon in passing.
5. **Safety:** never ask for or suggest sharing a seed phrase, private key or
   backup password. Say plainly when something cannot be undone (a sent
   payment, a lost seed phrase).
6. **One question per entry.** No near-duplicates of other entries: before
   adding one, search the other files (`grep -i`) for the same question.
7. **No live data:** no prices, balances, block heights or counts that change.
   Say where to look instead.

## Check

```bash
node tools/qortino-knowledge/validate-golden.mjs tools/qortino-knowledge/golden/<file>.jsonl
```
