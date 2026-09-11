import type { ReactElement } from "react";
import { LlmGatewayApiError } from "@llm-gateway/sdk-node";

// Renders any caught error via plain JSX text interpolation only — React escapes it, so an API
// `.message` can never be interpreted as markup. The single place every screen routes errors through.
export function ErrorBanner({ error }: { error: unknown }): ReactElement | null {
  if (!error) {
    return null;
  }
  if (error instanceof LlmGatewayApiError) {
    return (
      <div className="error-banner" role="alert">
        {error.code}: {error.message}
      </div>
    );
  }
  // Avoid String(error) — a plain object would render as unhelpful "[object Object]".
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "An unknown error occurred";
  return (
    <div className="error-banner" role="alert">
      {message}
    </div>
  );
}
