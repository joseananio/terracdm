# Craven semantic backend

TerraCDM can optionally send selected observation domains to Craven for evidence-backed canonical identity, governed corrections, and published queries. Provider observations remain authoritative local records and the application remains usable when Craven is absent.

Configure server-only environment variables:

```text
CRAVEN_BASE_URL=https://platform.semogram.com
CRAVEN_PROJECT_ID=<project UUID>
CRAVEN_API_TOKEN=<user-bound project API key>
CRAVEN_ONTOLOGY_MAPPINGS={"supply-chain":{"ontologyPackageId":"<package UUID>","typeRef":"Supplier"}}
```

Apply `supabase/migrations/20260908202630_add_craven_semantic_links.sql` first. The intelligence API reports `semanticBackend.mode`, synchronization counts, and correction counts. A missing configuration produces `standalone`; remote failures never roll back provider ingestion.
