import type { CanonicalRequest } from "../value-objects/canonical-request.js";
import type { TenantContext } from "../value-objects/tenant-context.js";
import type { EnrichmentResult } from "../value-objects/enrichment-result.js";

// One implementation per built-in stage, registered by name in the composition root and selected
// per request via the org/project's ordered stage list. Takes no config parameter — each stage
// reads its own settings from ConfigurationService. A stage catches its own internal/timeout
// errors and decides fail-open/fail-closed itself; RequestEnrichmentPipeline treats an
// unexpected throw as a bug and fails closed.
export interface EnrichmentStage {
  readonly name: string;
  apply(request: CanonicalRequest, tenant: TenantContext): Promise<EnrichmentResult>;
}
