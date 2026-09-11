import type { CostLedgerRepository, CostLedgerEntry, CreateCostLedgerEntryInput } from "@llm-gateway/domain";
import type { PrismaClient } from "../prisma-client.js";

interface CostLedgerEntryRow {
  id: string;
  organizationId: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  inputCostMicros: bigint;
  outputCostMicros: bigint;
  totalCostMicros: bigint;
  currency: string;
  createdAt: Date;
}

export class PrismaCostLedgerRepository implements CostLedgerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(input: CreateCostLedgerEntryInput): Promise<CostLedgerEntry> {
    const row = await this.prisma.costLedgerEntry.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        providerId: input.providerId,
        modelId: input.modelId,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        // *CostMicros are Postgres bigint — BigInt() on the way in, Number() on the way out.
        inputCostMicros: BigInt(input.inputCostMicros),
        outputCostMicros: BigInt(input.outputCostMicros),
        totalCostMicros: BigInt(input.totalCostMicros),
        currency: input.currency,
      },
    });
    return this.toDomain(row);
  }

  // Budget Enforcement's reconciliation job re-derives the Redis fast-path counter from this sum.
  // Explicit `projectId !== null` check — an empty-string projectId must not widen the scope.
  async sumCostMicrosForPeriod(
    organizationId: string,
    projectId: string | null,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    const result = await this.prisma.costLedgerEntry.aggregate({
      where: {
        organizationId,
        ...(projectId !== null ? { projectId } : {}),
        createdAt: { gte: periodStart, lt: periodEnd },
      },
      _sum: { totalCostMicros: true },
    });
    // A period's aggregate sum is expected to stay well under Number.MAX_SAFE_INTEGER.
    return Number(result._sum.totalCostMicros ?? 0n);
  }

  private toDomain(row: CostLedgerEntryRow): CostLedgerEntry {
    return {
      id: row.id,
      organizationId: row.organizationId,
      projectId: row.projectId,
      providerId: row.providerId,
      modelId: row.modelId,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      // Per-entry micros stay well under Number.MAX_SAFE_INTEGER. A raw bigint is never passed
      // through — it throws on JSON.stringify().
      inputCostMicros: Number(row.inputCostMicros),
      outputCostMicros: Number(row.outputCostMicros),
      totalCostMicros: Number(row.totalCostMicros),
      currency: row.currency,
      createdAt: row.createdAt,
    };
  }
}
