import type { Request, Response, NextFunction } from "express";
import type { TenantContext } from "@llm-gateway/domain";
import type { DefaultBudgetEnforcer, BudgetReservation } from "@llm-gateway/application";
import { withSpan, budgetChecksTotal } from "@llm-gateway/adapters-observability";

declare global {
  namespace Express {
    interface Request {
      // Set on an allowed reservation only — the route handler's debit() reads `.period` off this
      // to true up against the exact window the reservation was taken against.
      budgetReservation?: BudgetReservation;
    }
  }
}

// Budget Reserve sits after Rate Limit, before Enrichment — mounted ahead of every business
// router. A denial is a 402 (not 429): the caller has exhausted a spend limit, not a rate.
export function createBudgetMiddleware(budgetEnforcer: DefaultBudgetEnforcer) {
  return async function budgetMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    await withSpan("middleware.budget", async () => {
      const tenant: TenantContext | undefined = req.tenantContext;
      if (!tenant) {
        res.status(401).json({ code: "UNAUTHENTICATED", message: "Authentication required" });
        return;
      }

      try {
        const reservation = await budgetEnforcer.checkAndReserve(tenant);
        if (!reservation.allowed) {
          budgetChecksTotal.inc({ outcome: "rejected" });
          res.status(402).json({ code: "BUDGET_EXCEEDED", message: "Budget exceeded" });
          return;
        }
        budgetChecksTotal.inc({ outcome: "allowed" });
        req.budgetReservation = reservation;
        next();
      } catch (error) {
        next(error);
      }
    });
  };
}
