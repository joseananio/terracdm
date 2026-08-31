import { createAdminClient } from './lib/supabase/admin'
import { listIntegrations } from './lib/integrations/store'

const rows = await listIntegrations(createAdminClient(), { projectId: 'f1b0a27c-6946-4cd0-9f7e-ae3af1ea4286' })
console.log(JSON.stringify(rows.map((row) => ({
  name: row.name,
  capabilities: row.capabilities,
  details: row.capabilities_detail.map((capability) => ({
    kind: capability.kind,
    key: capability.key,
    capabilityInstallationId: capability.capabilityInstallationId,
    contracts: capability.contracts.map((contract) => contract.kind),
  })),
})), null, 2))
