# Search feature todo

The global navbar search currently supports Signals, Entities, and Places; combines the live intelligence corpus with geocoding; and includes loading, empty, clear, blur, Escape, and `Cmd/Ctrl+K` behavior.

## Result coverage

- [ ] Add Cases as a searchable result group.
- [ ] Add persistent Briefs as a searchable result group once briefs have stable IDs and destinations.
- [ ] Add Actions derived from the current query.
- [ ] Add an “Ask TerraCDM” result that starts an analyst conversation with the query.
- [ ] Define grouping and ordering rules when all result types are present.

## Result destinations

- [x] Stop forcing every selected Signal or Entity into Map mode.
- [x] Open Signals in the shared inspector over the current workspace.
- [x] Open Entities in the shared quick inspector over the current workspace.
- [x] Add an explicit “View on map” action to Signal and Entity detail surfaces.
- [ ] Open Cases in the Cases workspace.
- [ ] Open Briefs in the Brief workspace.
- [x] Keep Place selection as an intentional switch to Map and fly to the selected location.
- [ ] Preserve the current query when opening and returning from a result where appropriate.

## Keyboard interaction

- [ ] Add Up/Down navigation across grouped results.
- [ ] Add an active-result state with visible focus treatment.
- [ ] Open the active result with Enter.
- [ ] Ensure keyboard navigation continues correctly as remote geocoding results arrive.
- [ ] Add accessible announcements for result counts and the active result.

## Query tools

- [ ] Add recent searches when the field opens without a query.
- [ ] Add optional filters represented as removable chips.
- [ ] Parse scope commands such as `in:signals`, `type:vessel`, and `risk:high`.
- [ ] Define how free text, chips, and scope commands combine.
- [ ] Add a clear-all action for query text and filters.

## Preview and spatial search

- [ ] Add an active-result preview for records that benefit from more context.
- [ ] Add a Map-only “Search this area” action after meaningful viewport movement.
- [ ] Keep “Search this area” separate from global search and scope it to visible geography.

## Quality and verification

- [ ] Add unit coverage for matching, grouping, deduplication, and scope parsing.
- [ ] Add interaction coverage for keyboard navigation and result selection.
- [ ] Verify global search behavior from Map, Brief, Signals, Cases, Entities, Graph, and Settings.
- [ ] Verify narrow-screen layout, long labels, empty groups, loading failures, and large result sets.
