import type {
  BatchRequestRepository,
  BatchRequestRecord,
  BatchRequestStatus,
  CreateBatchRequestInput,
  CanonicalRequest,
  CanonicalResponse,
  RoutingPolicy,
} from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface BatchRequestRow {
  id: string;
  organizationId: string;
  projectId: string | null;
  requestClass: string;
  canonicalRequest: unknown;
  routingPolicy: unknown;
  webhookUrl: string | null;
  status: string;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

// requestClass/status cross the domain (lowercase string) / Prisma (uppercase enum) boundary.
// Verify the generated BatchRequestClass/BatchRequestStatus enum member names after the first
// `pnpm prisma:generate`.
const REQUEST_CLASS_TO_PRISMA: Record<"batch" | "background", string> = {
  batch: "BATCH",
  background: "BACKGROUND",
};
const REQUEST_CLASS_FROM_PRISMA: Record<string, "batch" | "background"> = {
  BATCH: "batch",
  BACKGROUND: "background",
};
const STATUS_FROM_PRISMA: Record<string, BatchRequestStatus> = {
  PENDING: "pending",
  PROCESSING: "processing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
};
const STATUS_TO_PRISMA: Record<BatchRequestStatus, string> = {
  pending: "PENDING",
  processing: "PROCESSING",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
};

export class PrismaBatchRequestRepository implements BatchRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateBatchRequestInput): Promise<void> {
    await this.prisma.batchRequest.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        requestClass: REQUEST_CLASS_TO_PRISMA[input.requestClass] as never,
        canonicalRequest: input.canonicalRequest as never,
        routingPolicy: input.routingPolicy as never,
        webhookUrl: input.webhookUrl,
      },
    });
  }

  // organizationId always required; projectId applied as an additional filter only when non-null
  // (explicit null check, not truthy — an empty-string projectId must not bypass filtering).
  async findById(id: string, organizationId: string, projectId: string | null): Promise<BatchRequestRecord | null> {
    const row = await this.prisma.batchRequest.findFirst({
      where: {
        id,
        organizationId,
        ...(projectId !== null ? { projectId } : {}),
      },
    });
    return row ? this.toDomain(row) : null;
  }

  // No tenant scoping — trusted internal callers (the worker) only, never a tenant-facing route.
  async findByIdUnscoped(id: string): Promise<BatchRequestRecord | null> {
    const row = await this.prisma.batchRequest.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  // A single atomic UPDATE ... WHERE status = 'PENDING', not a read-then-write. `count > 0` means
  // this call won the transition; `count === 0` means the row was already claimed/completed.
  async markProcessing(id: string): Promise<boolean> {
    const result = await this.prisma.batchRequest.updateMany({
      where: { id, status: STATUS_TO_PRISMA.pending as never },
      data: { status: STATUS_TO_PRISMA.processing as never },
    });
    return result.count > 0;
  }

  async markSucceeded(id: string, result: CanonicalResponse): Promise<void> {
    await this.prisma.batchRequest.update({
      where: { id },
      data: {
        status: STATUS_TO_PRISMA.succeeded as never,
        result: result as never,
        completedAt: new Date(),
      },
    });
  }

  async markFailed(id: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.prisma.batchRequest.update({
      where: { id },
      data: {
        status: STATUS_TO_PRISMA.failed as never,
        errorCode,
        errorMessage,
        completedAt: new Date(),
      },
    });
  }

  private toDomain(row: BatchRequestRow): BatchRequestRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      projectId: row.projectId,
      requestClass: REQUEST_CLASS_FROM_PRISMA[row.requestClass] ?? "batch",
      // Already typed `unknown` — no intermediate `as unknown` needed before the domain-type assertion.
      canonicalRequest: row.canonicalRequest as CanonicalRequest,
      routingPolicy: row.routingPolicy as RoutingPolicy,
      webhookUrl: row.webhookUrl,
      status: STATUS_FROM_PRISMA[row.status] ?? "pending",
      result: row.result ? (row.result as unknown as CanonicalResponse) : null,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
    };
  }
}
