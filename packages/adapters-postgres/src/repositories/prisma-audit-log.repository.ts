import type {
  AuditLogRepository,
  AuditLogEntry,
  AuditLogListOptions,
  AuditLogPage,
  CreateAuditLogEntryInput,
  AuditActorType,
} from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface AuditLogEntryRow {
  id: string;
  organizationId: string;
  projectId: string | null;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}

// actorType crosses the domain (lowercase) / Prisma (uppercase enum) boundary. Only create()/
// list() exist here — no update/delete, the application half of "append-only".
const ACTOR_TYPE_TO_PRISMA: Record<AuditActorType, string> = {
  user: "USER",
  api_key: "API_KEY",
};
const ACTOR_TYPE_FROM_PRISMA: Record<string, AuditActorType> = {
  USER: "user",
  API_KEY: "api_key",
};

const DEFAULT_LIST_LIMIT = 100;

// Opaque at the port level — only this adapter knows the shape. Built from both createdAt and id
// (id as the tiebreaker for entries sharing one millisecond), ordered like the query's ORDER BY.
interface AuditLogCursor {
  readonly createdAt: string; // ISO 8601
  readonly id: string;
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  const payload: AuditLogCursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): AuditLogCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid audit log cursor");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).createdAt !== "string" ||
    typeof (parsed as Record<string, unknown>).id !== "string" ||
    Number.isNaN(Date.parse((parsed as Record<string, unknown>).createdAt as string))
  ) {
    throw new Error("Invalid audit log cursor");
  }
  return parsed as AuditLogCursor;
}

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateAuditLogEntryInput): Promise<AuditLogEntry> {
    const row = await this.prisma.auditLogEntry.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorType: ACTOR_TYPE_TO_PRISMA[input.actorType] as never,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata as never,
      },
    });
    return this.toDomain(row);
  }

  // Keyset (cursor) pagination, not OFFSET. Orders by (createdAt DESC, id DESC) so the cursor
  // boundary is stable across pages. Fetches one row past the limit to learn whether a next page
  // exists without a second round trip.
  async listByOrganization(organizationId: string, options: AuditLogListOptions = {}): Promise<AuditLogPage> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    const decoded = options.cursor !== undefined ? decodeCursor(options.cursor) : null;
    const cursorCreatedAt = decoded ? new Date(decoded.createdAt) : null;

    const rows = await this.prisma.auditLogEntry.findMany({
      where: {
        organizationId,
        ...(decoded && cursorCreatedAt
          ? {
              OR: [
                { createdAt: { lt: cursorCreatedAt } },
                { createdAt: cursorCreatedAt, id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = page[page.length - 1];
    const nextCursor = hasMore && lastRow ? encodeCursor(lastRow) : null;

    return {
      entries: page.map((row) => this.toDomain(row)),
      nextCursor,
    };
  }

  private toDomain(row: AuditLogEntryRow): AuditLogEntry {
    return {
      id: row.id,
      organizationId: row.organizationId,
      projectId: row.projectId,
      actorType: ACTOR_TYPE_FROM_PRISMA[row.actorType] ?? "user",
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.createdAt,
    };
  }
}
