<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI content discipline

- Use a content-first interface. Do not add decorative metadata, status labels, provenance footers, timestamps, provider/model badges, internal implementation terms, eyebrow headings, or explanatory filler to UI designs unless the user explicitly asks for it or it directly changes a user decision.
- Prefer the smallest useful label and the clearest action. If the content is already obvious from its placement, do not label it again.
- Do not invent sections such as “saved,” “stored,” “operational brief,” “map intelligence,” “next questions,” or similar framing copy just to make a panel feel complete. Keep generated content, necessary controls, and user-selected actions; remove redundant framing text.
- Before presenting a UI change, inspect the rendered surface for duplicate headings, repeated summaries, and irrelevant metadata. Treat prior requests to remove such text as an ongoing project preference.
