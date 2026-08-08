# Qortino vs reference answers

## What was wrong before

Offline Qortino used a small Qwen GGUF + hash RAG over ~223 chunks, with Fast mode truncating context to ~220 characters and ~80 output tokens. That made answers thin, sometimes confused “Playing Qortal” metaphor with “Qortal is a game,” and missed practical detail.

## What we did

1. Authored **1600** high-value Q&As (200 × 8 categories) as golden reference answers.
2. Imported them into:
   - `docs/faq/*-faq.md` → rebuilt knowledge pack (**1823** chunks, 1600 FAQ units)
   - `src/qortinoAgent/goldenAnswers.json` → fuzzy exact-match short-circuit
3. Raised offline RAG budgets (Fast 2×900 chars, Max 3×1400) and maxTokens (Fast 160 / Max 280).
4. Prompt tweak: stay faithful to retrieved `A:` FAQ lines.

## How answers improve

| Path | Behavior |
|------|----------|
| High fuzzy match (≥0.58 Fast / ≥0.64 Max) | Return golden answer directly (same quality as reference) |
| No match | RAG over FAQ + handbooks with much longer chunks → model paraphrases stronger notes |
| QDN mode | Unchanged live scan; pack still available as backup |

## Categories

qortal · programming · survival · health · gardening · life-skills · philosophy · earth-changes

## Rebuild

See `golden/README.md`.
