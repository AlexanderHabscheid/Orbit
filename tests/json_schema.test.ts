import test from "node:test";
import assert from "node:assert/strict";
import { assertJsonSchema, validateJsonSchema } from "../src/json_schema.js";

test("validateJsonSchema validates required fields and types", () => {
  const schema = {
    type: "object",
    required: ["name", "age"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      age: { type: "integer", minimum: 0 }
    }
  };
  const ok = validateJsonSchema({ name: "a", age: 3 }, schema);
  assert.equal(ok.length, 0);

  const bad = validateJsonSchema({ age: -1, extra: true }, schema);
  assert.ok(bad.length >= 2);
});

test("assertJsonSchema throws OrbitError on invalid payload", () => {
  assert.throws(
    () => assertJsonSchema({ value: "x" }, { type: "object", required: ["value"], properties: { value: { type: "integer" } } }, "payload"),
    /schema validation/
  );
});
