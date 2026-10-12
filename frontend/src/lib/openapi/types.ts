/* eslint-disable @typescript-eslint/no-explicit-any */
/** A raw OpenAPI document or a part of one (2.0, 3.0 or 3.1). */
export type SpecObject = Record<string, any>;
/** A JSON schema as written in the spec, $refs not yet followed. */
export type Schema = SpecObject;

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

export type Parameter = {
  name: string;
  in: ParameterLocation;
  required: boolean;
  deprecated: boolean;
  description: string;
  schema?: Schema;
  example?: unknown;
};

export type MediaType = {
  contentType: string;
  schema?: Schema;
  example?: unknown;
  examples: { name: string; summary?: string; value: unknown }[];
};

export type RequestBody = { required: boolean; description: string; content: MediaType[] };

export type Response = {
  status: string;
  description: string;
  content: MediaType[];
  headers: { name: string; description: string; schema?: Schema }[];
};

export type SecurityScheme = {
  key: string;
  type: string; // apiKey, http, oauth2, openIdConnect, basic (2.0)
  name?: string; // apiKey: header / query / cookie name
  in?: string;
  scheme?: string; // http: bearer, basic
  description?: string;
};

export type Operation = {
  /** Stable id in URLs: the operationId when unique, else "METHOD /path". */
  key: string;
  method: string;
  path: string;
  operationId?: string;
  summary: string;
  description: string;
  tags: string[];
  deprecated: boolean;
  parameters: Parameter[];
  requestBody?: RequestBody;
  responses: Response[];
  /** Alternatives: any one of them is enough; each lists the schemes it needs. */
  security: SecurityScheme[][];
};

export type NormalizedSpec = {
  openapi: string; // "2.0", "3.0.3", "3.1.0"
  title: string;
  version: string;
  description: string;
  tags: { name: string; description: string }[];
  operations: Operation[];
  /** The document, for resolving schema $refs. */
  raw: SpecObject;
};
