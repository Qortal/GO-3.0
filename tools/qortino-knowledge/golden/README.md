# Qortino golden Q&A set

High-value offline questions + reference answers used to:

1. Expand the RAG knowledge pack (`docs/faq/*.md`)
2. Power exact/fuzzy answer matching (`src/qortinoAgent/goldenAnswers.json`)
3. Evaluate retrieval quality (`node tools/qortino-knowledge/eval-golden.mjs`)

## Format (JSONL)

Each line:

```json
{"id":"qortal-001","category":"qortal","q":"What is Qortal?","aliases":["explain qortal"],"a":"...","priority":1}
```

- `priority`: 1 = must-get-right, 2 = important, 3 = nice-to-have
- Answers: offline-safe, metric, concise (2–6 sentences or short steps). No “search the web”.

## Categories

`qortal` · `programming` · `survival` · `health` · `gardening` · `life-skills` · `philosophy` · `earth-changes`

## Rebuild

```bash
node tools/qortino-knowledge/import-golden.mjs
node tools/qortino-knowledge/build-pack.mjs --out tools/qortino-knowledge/dist/qortino-knowledge-v2.json --version v2
node tools/qortino-knowledge/build-pack.mjs --no-embeddings --out tools/qortino-knowledge/dist/qortino-knowledge-v2.json --version v2
```
