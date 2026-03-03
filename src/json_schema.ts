import { OrbitError } from "./errors.js";

export interface JsonSchemaValidationIssue {
  path: string;
  message: string;
}

type JsonSchema = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asSchema(value: unknown): JsonSchema | null {
  return isObject(value) ? value : null;
}

function typeMatches(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function pushIssue(issues: JsonSchemaValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateType(value: unknown, schema: JsonSchema, path: string, issues: JsonSchemaValidationIssue[]): boolean {
  const rawType = schema.type;
  if (typeof rawType === "string") {
    if (!typeMatches(value, rawType)) {
      pushIssue(issues, path, `expected type ${rawType}`);
      return false;
    }
    return true;
  }
  if (Array.isArray(rawType) && rawType.length > 0) {
    const expected = rawType.filter((v): v is string => typeof v === "string");
    if (expected.length > 0 && !expected.some((t) => typeMatches(value, t))) {
      pushIssue(issues, path, `expected one of types: ${expected.join(", ")}`);
      return false;
    }
  }
  return true;
}

function validateEnum(value: unknown, schema: JsonSchema, path: string, issues: JsonSchemaValidationIssue[]): void {
  const options = schema.enum;
  if (!Array.isArray(options) || options.length === 0) return;
  const ok = options.some((option) => JSON.stringify(option) === JSON.stringify(value));
  if (!ok) pushIssue(issues, path, "value not present in enum");
}

function validateString(value: string, schema: JsonSchema, path: string, issues: JsonSchemaValidationIssue[]): void {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    pushIssue(issues, path, `string length must be >= ${schema.minLength}`);
  }
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    pushIssue(issues, path, `string length must be <= ${schema.maxLength}`);
  }
  if (typeof schema.pattern === "string") {
    try {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) pushIssue(issues, path, `string does not match pattern ${schema.pattern}`);
    } catch {
      pushIssue(issues, path, `invalid regex pattern ${schema.pattern}`);
    }
  }
}

function validateNumber(value: number, schema: JsonSchema, path: string, issues: JsonSchemaValidationIssue[]): void {
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    pushIssue(issues, path, `number must be >= ${schema.minimum}`);
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    pushIssue(issues, path, `number must be <= ${schema.maximum}`);
  }
}

function validateArray(value: unknown[], schema: JsonSchema, path: string, issues: JsonSchemaValidationIssue[]): void {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    pushIssue(issues, path, `array length must be >= ${schema.minItems}`);
  }
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    pushIssue(issues, path, `array length must be <= ${schema.maxItems}`);
  }
  const itemSchema = asSchema(schema.items);
  if (!itemSchema) return;
  for (let i = 0; i < value.length; i += 1) {
    validateAgainstSchema(value[i], itemSchema, `${path}[${i}]`, issues);
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  issues: JsonSchemaValidationIssue[]
): void {
  const required = Array.isArray(schema.required) ? schema.required.filter((v): v is string => typeof v === "string") : [];
  for (const key of required) {
    if (!(key in value)) {
      pushIssue(issues, `${path}.${key}`, "required property is missing");
    }
  }

  const props = asSchema(schema.properties) ?? {};
  const allowAdditional = schema.additionalProperties !== false;
  for (const key of Object.keys(value)) {
    const childPath = `${path}.${key}`;
    const childSchema = asSchema(props[key]);
    if (!childSchema) {
      if (!allowAdditional) pushIssue(issues, childPath, "additional properties are not allowed");
      continue;
    }
    validateAgainstSchema(value[key], childSchema, childPath, issues);
  }
}

function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema,
  path: string,
  issues: JsonSchemaValidationIssue[]
): void {
  validateEnum(value, schema, path, issues);
  if (Object.prototype.hasOwnProperty.call(schema, "const")) {
    const constValue = schema.const;
    if (JSON.stringify(constValue) !== JSON.stringify(value)) {
      pushIssue(issues, path, "value does not match const");
    }
  }

  const typeOk = validateType(value, schema, path, issues);
  if (!typeOk) return;

  if (typeof value === "string") {
    validateString(value, schema, path, issues);
  } else if (typeof value === "number") {
    validateNumber(value, schema, path, issues);
  } else if (Array.isArray(value)) {
    validateArray(value, schema, path, issues);
  } else if (isObject(value)) {
    validateObject(value, schema, path, issues);
  }
}

export function validateJsonSchema(value: unknown, schema: unknown): JsonSchemaValidationIssue[] {
  const schemaObj = asSchema(schema);
  if (!schemaObj) return [];
  const issues: JsonSchemaValidationIssue[] = [];
  validateAgainstSchema(value, schemaObj, "$", issues);
  return issues;
}

export function assertJsonSchema(value: unknown, schema: unknown, context: string): void {
  const issues = validateJsonSchema(value, schema);
  if (issues.length === 0) return;
  throw new OrbitError("SCHEMA_VALIDATION_FAILED", `${context} failed schema validation`, { issues });
}
