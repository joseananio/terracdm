# Intelligence workspace implementation todo

This tracks the original signal-first interface plan against the current implementation. Search-specific work remains in [search-todo.md](./search-todo.md).

## Implemented foundation

- [x] Add the six top-level workspace modes: Signals, Brief, Cases, Entities, Graph, and Map.
- [x] Keep Map as a first-class persistent lens rather than replacing it with a widget.
- [x] Preserve visited lens state while switching modes.
- [x] Add a top-level resizable right split that survives lens changes.
- [x] Collapse the mode navigation when the split is open.
- [x] Add smooth split-panel entry, exit, and workspace resizing.
- [x] Make the navbar, mobile navigation drawer, Signals, Entities, and the Map signal queue responsive.
- [x] Keep Search, Chat, Actions, Settings, and feed status globally available in the navbar.
- [x] Keep Map-native object panels separate from the workspace split inspector.

## Signals

- [x] Build the live full-corpus Signals inbox.
- [x] Add All, High risk, Unread, and Watchlist filters.
- [x] Add text filtering and Newest/Highest risk sorting.
- [x] Add readable table density, risk treatment, relative time, source, and domain columns.
- [x] Open a selected signal in the persistent right split without changing lenses.
- [x] Add quick-inspector actions for View on map and Open source.
- [x] Keep the Map incoming-signal box compact, responsive, and independent from the Signals workspace.
- [ ] Persist read and watch states per user instead of keeping them in component memory.
- [ ] Define the full signal dossier beyond the current quick inspector.
- [ ] Add evidence, related entities, media, history, and relevant actions to the dossier.
- [ ] Add an explicit Open full signal action from the quick inspector.
- [ ] Add column-header sorting and decide whether multi-column sorting is needed.
- [ ] Add bulk selection and bulk actions if analyst workflows require them.
- [ ] Define live-update behavior while a user is reading or filtering the queue.

## Entities

- [x] Build the live full-corpus Entities explorer.
- [x] Add All, High risk, Located, and Watchlist filters.
- [x] Add text filtering across names, descriptions, sources, domains, locations, and providers.
- [x] Add Newest, Highest risk, and Name sorting.
- [x] Open a selected entity in the persistent right split without changing lenses.
- [x] Add quick-inspector actions for View on map and Open source.
- [ ] Persist entity watch state per user.
- [ ] Build the full entity dossier: current state, recent activity, related signals, relationships, media, and historical timeline.
- [ ] Add entity-type facets for aircraft, vessels, places, organizations, actors, IPs, satellites, events, and other supported types.
- [ ] Add an explicit Open full dossier action from the quick inspector.
- [ ] Add pagination or virtualization for large entity corpora.
- [ ] Add column-header sorting, optional multi-column sorting, and row actions.

## Brief

- [x] Add the Brief lens and preserve its workspace state.
- [x] Replace the placeholder with the generated situational brief.
- [x] Reuse the current overview generation as the initial Brief pipeline and move overview ownership out of Chat.
- [x] Add time, geography, domain, and watchlist-aware generation scope.
- [x] Structure developments with stable signal/entity evidence IDs.
- [x] Make each development expandable to supporting observations in the shared split inspector.
- [x] Keep the previous brief visible through background regeneration, and expose loading, stale, and failure states.
- [x] Add Map, Graph, Chat, and Case handoffs without forcing a lens switch for evidence review.
- [x] Add durable history, stable IDs, editing, regeneration, sharing, and Markdown export.
- [ ] Add persistent Briefs to global search.
- [ ] Replace the current watchlist scope bridge with persisted per-user watchlists.

## Cases and timelines

- [x] Add the Cases lens shell.
- [ ] Define the Case data model, persistence, ownership, and status lifecycle.
- [ ] Create cases manually and cluster signals into cases automatically where appropriate.
- [ ] Add Add to case from Signals, Entities, search results, and inspectors.
- [ ] Build the Case workspace with summary, signals, entities, evidence, relationships, media, notes, and actions.
- [ ] Build a vertical event stream for reading and triage.
- [ ] Build a horizontal zoomable chronology for reconstruction and correlation.
- [ ] Synchronize timeline selection with related entities, Map, and Graph.

## Graph

- [x] Add the Graph lens shell.
- [x] Retain the existing object-level relationship graph used by Map panels.
- [ ] Build the top-level Graph workspace.
- [ ] Open a graph from the current signal, entity, or case context.
- [ ] Add node selection, filtering, expansion, and a shared node inspector.
- [ ] Synchronize selected nodes with Map, Entities, Signals, and Cases without losing context.
- [ ] Define scale controls that prevent the global graph from becoming noisy.

## Cross-lens object workflow

- [x] Keep selected inspectors available while switching lenses.
- [x] Provide an intentional View on map action rather than forcing Map navigation.
- [ ] Create a canonical object route/selection model shared by Signals, Entities, Cases, Graph, Timeline, and Map.
- [ ] Add Open in Graph, Open in Case, Open in Timeline, and Open entity actions where valid.
- [ ] Preserve list query, filters, scroll position, and selection when moving between lenses.
- [ ] Support pinning quick inspectors into the split from every applicable lens.
- [ ] Decide whether Signals becomes the default startup lens; Map remains the current default.

## Longer-term analytical modes

- [ ] Design the Scenario board around hypotheses, supporting and contradicting indicators, confidence, and next indicators.
- [ ] Decide whether Scenario boards live inside Cases or become a separate lens.
- [ ] Build a specialist Media wall only after media availability and analyst demand justify it.
- [ ] Evaluate an advanced analytical table mode after Signals and Entities expose stable bulk workflows.

## Quality and persistence

- [ ] Persist user workspace state server-side where it must follow the user across devices.
- [ ] Add interaction tests for Signals and Entities filters, sorting, watch state, inspector behavior, and responsive breakpoints.
- [ ] Add accessibility coverage for dropdowns, drawers, split resizing, tables/lists, and live updates.
- [ ] Add performance coverage for large signal/entity corpora and continuously updating feeds.
- [ ] Verify the complete object workflow across desktop, split, tablet, and mobile layouts.
