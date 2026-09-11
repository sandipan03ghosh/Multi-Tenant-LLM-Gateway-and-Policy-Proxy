import { DomainValidationError } from "@llm-gateway/domain";
import type {
  RoutingStrategy,
  ProviderCandidate,
  CanonicalRequest,
  RoutingPolicy,
} from "@llm-gateway/domain";

// The policy names an explicit provider; the model comes directly from the client's request.
export class ManualRoutingStrategy implements RoutingStrategy {
  async selectCandidates(
    request: CanonicalRequest,
    policy: RoutingPolicy,
  ): Promise<ProviderCandidate[]> {
    if (policy.type !== "manual") {
      throw new DomainValidationError("ManualRoutingStrategy", "policy.type", `expected "manual", got "${policy.type}"`);
    }
    return [{ providerId: policy.providerId, modelId: request.model }];
  }
}
