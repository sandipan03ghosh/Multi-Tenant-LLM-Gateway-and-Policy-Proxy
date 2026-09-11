import { lookup as dnsLookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";
import * as http from "node:http";
import * as https from "node:https";
import type { LookupAddress } from "node:dns";
import type { JobHandler } from "@llm-gateway/domain";

interface DeliverWebhookPayload {
  readonly url: string;
  readonly body: unknown;
}

function isDeliverWebhookPayload(payload: unknown): payload is DeliverWebhookPayload {
  return typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).url === "string";
}

// Strict decimal-digit parse of a dotted-quad, rejecting octal/hex/whitespace/out-of-range —
// precise integer range checks below, not regex against the raw string.
function parseIPv4Octets(address: string): [number, number, number, number] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets as [number, number, number, number];
}

function isPrivateIPv4(address: string): boolean {
  const octets = parseIPv4Octets(address);
  if (!octets) {
    return false;
  }
  const [a, b] = octets;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, incl. cloud metadata
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

const PRIVATE_IPV6_PATTERNS: readonly RegExp[] = [
  /^::1$/, // loopback
  /^f[cd][0-9a-f]{2}:/i, // fc00::/7 unique local
  /^fe80:/i, // fe80::/10 link-local
];

// IPv4-mapped IPv6 (e.g. "::ffff:127.0.0.1") — unwrap and apply the IPv4 range check.
function extractIPv4MappedAddress(address: string): string | null {
  const match = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(address);
  return match ? (match[1] ?? null) : null;
}

// Applied to an IP-literal hostname and to every address DNS resolves — node:net family
// detection plus range checks, not regex.
function isPrivateAddress(address: string): boolean {
  const normalized = address.trim();
  if (isIPv4(normalized)) {
    return isPrivateIPv4(normalized);
  }
  const mappedIPv4 = extractIPv4MappedAddress(normalized);
  if (mappedIPv4) {
    return isPrivateIPv4(mappedIPv4);
  }
  if (isIPv6(normalized)) {
    const lower = normalized.toLowerCase();
    return PRIVATE_IPV6_PATTERNS.some((pattern) => pattern.test(lower));
  }
  return false;
}

// Allowlist: only standard web ports are valid webhook targets.
function isAllowedPort(target: URL): boolean {
  const port = target.port ? Number(target.port) : target.protocol === "https:" ? 443 : 80;
  return port === 80 || port === 443;
}

const DELIVERY_TIMEOUT_MS = 10_000;
// The response body isn't used — just capped to avoid unbounded memory/time from a bad endpoint.
const MAX_RESPONSE_BYTES = 1_048_576;

export interface DeliverWebhookHandlerConfig {
  /** Dev/test convenience only — production wiring should never set this. */
  readonly allowInsecureHttp?: boolean;
}

// Webhook/alert delivery. Registered under JobScheduler, so any failure (network, non-2xx,
// unsafe/invalid URL) rethrows and gets JobScheduler's lease/attempt/backoff. An unsafe URL
// always throws — never counted as a successful delivery.
//
// SSRF handling, more than a URL-string check:
//   - Rejects non-http(s) schemes (HTTPS unless allowInsecureHttp), non-standard ports, and
//     localhost/private/loopback/link-local hostnames.
//   - Resolves DNS itself, validates every returned address, then pins the connection to those
//     addresses via Node's `lookup` option — the connection does no separate DNS resolution,
//     closing the DNS-rebinding gap a hostname-only check leaves open.
//   - Uses node:http/node:https directly so redirects are never followed — a 3xx is a failed
//     delivery, not a hop that could land on an internal address.
export function createDeliverWebhookHandler(config: DeliverWebhookHandlerConfig = {}): JobHandler {
  const allowInsecureHttp = config.allowInsecureHttp ?? false;

  return async (payload: unknown): Promise<void> => {
    if (!isDeliverWebhookPayload(payload)) {
      throw new Error("deliver_webhook: payload does not match the expected shape");
    }

    let target: URL;
    try {
      target = new URL(payload.url);
    } catch {
      throw new Error(`deliver_webhook: "${payload.url}" is not a valid URL`);
    }
    const isHttps = target.protocol === "https:";
    if (!isHttps && !(allowInsecureHttp && target.protocol === "http:")) {
      throw new Error(`deliver_webhook: unsupported URL scheme "${target.protocol}" (HTTPS required)`);
    }
    if (!isAllowedPort(target)) {
      throw new Error(`deliver_webhook: unsupported port in "${payload.url}" (only 80/443 are allowed)`);
    }
    const hostname = target.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateAddress(hostname)) {
      throw new Error(`deliver_webhook: refusing to deliver to an unsafe host "${hostname}"`);
    }

    const pinnedAddresses = await dnsLookup(hostname, { all: true, verbatim: true });
    if (pinnedAddresses.length === 0) {
      throw new Error(`deliver_webhook: DNS resolution for "${hostname}" returned no addresses`);
    }
    if (pinnedAddresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error(`deliver_webhook: "${hostname}" resolves to a private/internal address, refusing delivery`);
    }

    await deliverOnce(target, payload.body, pinnedAddresses);
  };
}

function deliverOnce(target: URL, body: unknown, pinnedAddresses: readonly LookupAddress[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const settleReject = (error: Error): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const requestModule = target.protocol === "https:" ? https : http;
    const payloadBody = JSON.stringify(body);
    const firstAddress = pinnedAddresses[0];
    if (!firstAddress) {
      settleReject(new Error("deliver_webhook: no pinned address available"));
      return;
    }

    const req = requestModule.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payloadBody),
        },
        timeout: DELIVERY_TIMEOUT_MS,
        // Pins the connection to the already-validated address(es), no fresh DNS at connect time.
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options !== null && options.all) {
            callback(null, pinnedAddresses as LookupAddress[]);
          } else {
            callback(null, firstAddress.address, firstAddress.family);
          }
        },
      },
      (res) => {
        // Never follows redirects — a 3xx is just a failed delivery.
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            res.destroy();
            req.destroy();
            settleReject(new Error(`Webhook response from ${target.toString()} exceeded ${MAX_RESPONSE_BYTES} bytes, aborting`));
          }
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            settleResolve();
          } else {
            settleReject(new Error(`Webhook delivery to ${target.toString()} failed with status ${status}`));
          }
        });
        res.on("error", (error) => settleReject(error));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Webhook delivery to ${target.toString()} timed out`)));
    req.on("error", (error) => settleReject(error));
    req.write(payloadBody);
    req.end();
  });
}
