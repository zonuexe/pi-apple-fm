import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import {
  FM_BUILTIN_TOOLS,
  FM_TRANSCRIPT_ROLES,
  fmChatParametersSchema,
  fmCountTokensParametersSchema,
  fmRespondParametersSchema,
  fmTranscriptFileSchema,
  isFmBuiltinTool,
  isFmTranscriptRole,
} from "../src/types.js";

function descriptions(schema: { properties: object }): string[] {
  return Object.entries(schema.properties).map(([name, property]) => {
    const description = (property as { description?: unknown }).description;
    assert.equal(typeof description, "string", name);
    assert.ok(typeof description === "string" && description.length > 0, name);
    return description;
  });
}

describe("tool schemas", () => {
  it("keeps the built-in tool names and non-empty parameter descriptions", () => {
    assert.deepEqual(FM_BUILTIN_TOOLS, ["barcode", "ocr"]);
    assert.deepEqual(FM_TRANSCRIPT_ROLES, ["instructions", "user", "response"]);
    assert.equal(isFmBuiltinTool("barcode"), true);
    assert.equal(isFmBuiltinTool("camera"), false);
    assert.equal(isFmTranscriptRole("response"), true);
    assert.equal(isFmTranscriptRole("tool"), false);
    assert.equal(descriptions(fmChatParametersSchema).length, 7);
    assert.equal(descriptions(fmRespondParametersSchema).length, 8);
    assert.equal(descriptions(fmCountTokensParametersSchema).length, 5);
  });

  it("accepts extra fields in a saved fm session", () => {
    assert.equal(
      Check(fmTranscriptFileSchema, {
        modelName: "system",
        extra: 1,
        transcript: {
          type: "FoundationModels.Transcript",
          extra: true,
          transcript: {
            entries: [{ role: "user", extra: true, contents: [{ text: "hi", extra: true }] }],
          },
        },
      }),
      true,
    );
    assert.equal(Check(fmTranscriptFileSchema, { transcript: { transcript: { entries: "nope" } } }), false);
  });
});
