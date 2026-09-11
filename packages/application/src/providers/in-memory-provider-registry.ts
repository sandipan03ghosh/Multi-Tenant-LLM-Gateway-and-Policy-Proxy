import { ConfigurationNotFoundError, ProviderNotFoundError } from "@llm-gateway/domain";
import type { ProviderPort, ProviderRegistry, ConfigurationService, ConfigSubscriptionUnsubscribe, ConfigKey } from "@llm-gateway/domain";
import { providerEnabledConfigKey } from "./provider-config-keys.js";

// Registers exactly the adapters it's constructed with, plus a dynamic gate: provider.{id}.enabled
// (global scope), read in start() and kept current via ConfigurationService.subscribe(). Kept as a
// synchronous Map so the ProviderRegistry port's synchronous signature doesn't have to change.
//
// start() MUST be awaited by the composition root before serving requests — until it resolves,
// the subscription isn't active and every provider defaults to "enabled". stop() must be in the
// shutdown path so the per-provider subscriptions don't linger.
//
// Not configured -> enabled. This is a zero-restart toggle over a fixed set of adapters, not a
// way to register a new provider at runtime.
//
// A disabled provider is treated identically to an unregistered one: resolve() throws
// ProviderNotFoundError, listEnabled() excludes it — so DefaultRoutingEngine fails it over the
// same way it already handles an unknown provider id, with no new error path.
export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<string, ProviderPort>();
  private readonly enabled = new Map<string, boolean>();
  private readonly unsubscribes: ConfigSubscriptionUnsubscribe[] = [];

  constructor(
    providers: readonly ProviderPort[],
    private readonly configurationService: ConfigurationService,
  ) {
    for (const provider of providers) {
      this.providers.set(provider.providerId, provider);
      // Default until start() resolves the real value — "not configured -> enabled".
      this.enabled.set(provider.providerId, true);
    }
  }

  async start(): Promise<void> {
    await Promise.all([...this.providers.keys()].map((providerId) => this.startWatching(providerId)));
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes.length = 0;
  }

  resolve(providerId: string): ProviderPort {
    const provider = this.providers.get(providerId);
    if (!provider || this.enabled.get(providerId) === false) {
      throw new ProviderNotFoundError(providerId);
    }
    return provider;
  }

  listEnabled(): ProviderPort[] {
    return [...this.providers.values()].filter((provider) => this.enabled.get(provider.providerId) !== false);
  }

  // Part of the ProviderRegistry port — so the Admin API can report status through the port.
  isEnabled(providerId: string): boolean {
    return this.enabled.get(providerId) === true;
  }

  private async startWatching(providerId: string): Promise<void> {
    const key = providerEnabledConfigKey(providerId);
    this.enabled.set(providerId, await this.readEnabledFlag(key, providerId));
    this.unsubscribes.push(
      this.configurationService.subscribe(key, (value) => {
        if (typeof value === "boolean") {
          this.enabled.set(providerId, value);
          return;
        }
        console.error(
          `ProviderRegistry: received a non-boolean provider.${providerId}.enabled config update (ignoring, keeping previous value):`,
          JSON.stringify(value),
        );
      }),
    );
  }

  private async readEnabledFlag(key: ConfigKey, providerId: string): Promise<boolean> {
    let raw: unknown;
    try {
      raw = await this.configurationService.get<unknown>(key);
    } catch (error) {
      if (error instanceof ConfigurationNotFoundError) {
        return true;
      }
      throw error;
    }
    if (typeof raw === "boolean") {
      return raw;
    }
    console.error(
      `ProviderRegistry: configured provider.${providerId}.enabled value is not a boolean — defaulting to enabled:`,
      JSON.stringify(raw),
    );
    return true;
  }
}
