import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { metricsRegistry } from "./registry.js";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

// A minimal bare http.createServer, not the full Express app. Network isolation is
// docker-compose.yml's job (METRICS_PORT must stay off any published `ports:` list).
//
// extraRoutes lets a composition root attach additional bare routes onto this same server/port —
// the worker's /health, /live, /ready, /version reuse this rather than a second server. Keyed by
// exact path, not a router.
export function startMetricsServer(port: number, extraRoutes: Readonly<Record<string, RouteHandler>> = {}): Server {
  const server = createServer((req, res) => {
    if (req.url === "/metrics") {
      metricsRegistry
        .metrics()
        .then((body) => {
          res.writeHead(200, { "content-type": metricsRegistry.contentType });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(500).end();
        });
      return;
    }
    const handler = req.url ? extraRoutes[req.url] : undefined;
    if (handler) {
      Promise.resolve(handler(req, res)).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port);
  return server;
}
