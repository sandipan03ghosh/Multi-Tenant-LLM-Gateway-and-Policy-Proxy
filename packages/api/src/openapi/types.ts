// Minimal structural OpenAPI 3.1 types — just enough to assemble this document with type-checked
// field names. `JsonSchema` is untyped beyond `Record<string, unknown>` — zod's z.toJSONSchema()
// output is already correct by construction.
export type JsonSchema = Record<string, unknown>;

export interface OpenApiParameter {
  readonly name: string;
  readonly in: "path" | "query" | "header";
  readonly required?: boolean;
  readonly description?: string;
  readonly schema: JsonSchema;
}

export interface OpenApiMediaType {
  readonly schema: JsonSchema;
}

export interface OpenApiRequestBody {
  readonly required?: boolean;
  readonly content: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  readonly description: string;
  readonly content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  readonly summary: string;
  readonly description?: string;
  readonly operationId: string;
  readonly tags: readonly string[];
  readonly security?: readonly Record<string, readonly string[]>[];
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
  readonly responses: Record<string, OpenApiResponse>;
}

export type OpenApiPathItem = Partial<Record<"get" | "post" | "put" | "patch" | "delete", OpenApiOperation>>;

export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly servers: readonly { readonly url: string; readonly description?: string }[];
  readonly paths: Record<string, OpenApiPathItem>;
  readonly components: {
    readonly securitySchemes: Record<string, JsonSchema>;
    readonly schemas?: Record<string, JsonSchema>;
  };
}
