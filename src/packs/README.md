# Contributor packs

Signal packs are the unit of extension. A pack owns one domain, its subdomains,
providers, signal definitions, map presentation, graph rules, and agent context.

For a trusted code-backed pack:

1. Add the serializable manifest to `src/lib/catalog/user-packs.ts` or create a
   module under this directory and import it there.
2. Declare at least one `subdomains` entry. Use an explicit `default` entry when
   the domain has only one group, and make every signal reference its declared
   `subdomainId`.
3. Use one of the declarative provider types: `http-json`, `geojson`, `rss`, or
   `csv`. For custom provider code, use `type: "code"` and an
   `implementation` id.
4. Supply the server-only implementation through `registerPack()` in
   `src/lib/server/pack-registry.ts` when the source needs custom
   authentication, pagination, WebSockets, or enrichment. The server assembly
   loads these registered code packs before it reads instance configuration.
5. Put pack-owned graph facts, Wikidata properties, resolver id, node type, and
   relations in `presentation.graph`. The production MapLibre node graph and
   its local context operation both evaluate these relations through the same
   pack graph service. Built-in graph resolvers use the `pack:<pack-id>`
   namespace, so graph behavior is no longer coupled to legacy provider ids.
6. Put pack-owned agent context, capabilities, and tools in `agents`.

The manifest must stay serializable. Provider and graph code belongs on the
server and is selected through an explicit provider type and implementation or
resolver id. The runtime
provider endpoint is catalog-addressed as `/api/providers/:providerId`, so a
new pack does not require a new domain route. Graph requests are repository
backed: send a `selectedObservationId`, or query domains for a context graph.
Do not add domain-specific request or graph fallback logic; put new facts,
relationships, and Wikidata properties in the pack.

For a code-backed pack, register the manifest and its trusted implementations
as one server-side unit:

```ts
registerPack({
  manifest: aviationManifest,
  implementations: {
    providers: { "pack:aviation": aviationProviderImplementation },
    graph: { "pack:aviation": aviationGraphResolver },
    agents: { "aviation.signal-search": aviationSearchHandler },
  },
});
```

Trusted contributor registrations are collected by the server assembly through
`src/lib/server/contributor-code-packs.ts`; the application imports that
boundary before startup assembly. Contributors do not edit a central provider
dispatch map.

The manifest contains only data. The implementation ids are references into
the server registry; the functions themselves are never serialized or sent to
the browser. Declarative packs omit `implementations` and use the generic
provider runtime.

For a config-only pack, place a `.json`, `.yaml`, or `.yml` manifest on a
`terracdm.yaml` instance entry. The assembly loads and validates it with the
same catalog compiler before applying instance overrides. Config packs may use
`http-json`, `geojson`, `rss`, and `csv` providers plus declarative graph rules,
but cannot contain provider code, graph resolver ids, or executable agent
handlers. `loadPackManifestFile()` remains available for embedding runtimes that
need to inspect a manifest directly.

An instance can select built-in and config-only packs without code changes from
the server-only `terracdm.yaml`:

```yaml
version: 1
packs:
  defaults: disabled
  entries:
    aviation:
      enabled: true
      providers:
        aviation-network:
          enabled: true
          pollSeconds: 120
    air-quality:
      source: ./packs/air-quality.yaml
      enabled: true
```

`packs.defaults: disabled` makes the configured entries an allow-list. Use
`enabled` to toggle a pack or provider, and use provider overrides for endpoint,
auth environment, source mode, polling, cache, coverage, or notes. Code provider
implementation ids cannot be changed through instance YAML. Set
`TERRACDM_CONFIG` when the file is outside the repository root.

The complete server startup path is implemented in
`src/lib/server/catalog-assembly.ts`: built-in code packs, registered
contributor code packs, YAML/JSON config packs, manifest validation, instance
selection and provider overrides, then one catalog runtime commit. Providers,
graph resolvers, agent handlers, and the public catalog all read that committed
runtime.

Same-domain contributions are merged during assembly. Additive collections
such as subdomains, providers, signals, map details, menus, graph relations,
and agent tools/capabilities are combined by id; identical entries are
deduplicated. A conflicting entry or domain-level presentation metadata is a
configuration error. A source pack in `terracdm.yaml` can therefore extend
an existing code pack while remaining one public domain layer.

The public configuration contract is available at `/api/catalog/packs` and
`/api/catalog/packs/:packId`. Pack agent context, capabilities, and tool
descriptors are public metadata; executable tool handlers and provider auth
environment names are server-only.

## Verification

Run `pnpm lint` for the repository typecheck and `pnpm test` for the catalog
contract tests. The tests include a representative code-backed custom pack and
verify its domain, provider, signal, graph, agent, and observation references. The
graph contract test also proves a custom pack relation is used and that an
unregistered domain does not receive a built-in relationship fallback. Background
snapshot consumers derive their default domains from the catalog, so packs with
`defaultEnabled: true` are included in scheduled overviews and agent context.
