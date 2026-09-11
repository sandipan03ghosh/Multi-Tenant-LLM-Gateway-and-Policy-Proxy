import type { CanonicalRequest } from "../value-objects/canonical-request.js";
import type { TenantContext } from "../value-objects/tenant-context.js";
import type { EnrichmentResult } from "../value-objects/enrichment-result.js";

// Runs the org/project's ordered chain of EnrichmentStages against a request before it reaches
// the Routing Engine. Implemented once (DefaultRequestEnrichmentPipeline).
export interface RequestEnrichmentPipeline {
  run(request: CanonicalRequest, tenant: TenantContext): Promise<EnrichmentResult>;
}
