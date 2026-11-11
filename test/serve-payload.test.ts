import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeFmServePayload } from "../src/serve-payload.js";
import { FM_BIN_ENV, FM_PORT_ENV, resolveFmBin, resolveFmPort, SETTINGS_FILE, LOG_FILE, STATUS_KEY } from "../src/runtime.js";

describe("fm serve payload", () => {
  it("turns string unions into enums and drops object unions", () => {
    const payload = normalizeFmServePayload({
      tools: [
        {
          type: "function",
          function: {
            name: "bash",
            parameters: {
              type: "object",
              properties: {
                mode: { anyOf: [{ type: "string", const: "read" }, { type: "string", const: "write" }] },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "edit",
            parameters: {
              type: "object",
              properties: {
                value: { anyOf: [{ type: "object" }, { type: "object" }] },
              },
            },
          },
        },
      ],
    }) as { tools: Array<{ function: { name: string; parameters: { properties: { mode: { enum: string[] } } } } }> };

    assert.equal(payload.tools.length, 1);
    assert.equal(payload.tools[0]?.function.name, "bash");
    assert.deepEqual(payload.tools[0]?.function.parameters.properties.mode.enum, ["read", "write"]);
  });

  it("keeps the current turn and bash when compacting the system model", () => {
    const payload = normalizeFmServePayload(
      {
        messages: [
          { role: "system", content: "Current working directory: /tmp/project" },
          { role: "user", content: [{ type: "text", text: "old" }] },
          { role: "assistant", content: "old answer" },
          { role: "user", content: [{ type: "text", text: "current" }] },
        ],
        tools: [
          { type: "function", function: { name: "bash", parameters: { type: "object" } } },
          { type: "function", function: { name: "read", parameters: { type: "object" } } },
        ],
      },
      { fitContextWindow: true },
    ) as { messages: Array<{ role: string; content: string }>; tools: Array<{ function: { name: string } }> };

    assert.equal(payload.messages.at(-1)?.content, "current");
    assert.equal(payload.messages[0]?.role, "system");
    assert.match(payload.messages[0]?.content ?? "", /Current working directory: \/tmp\/project/);
    assert.deepEqual(
      payload.tools.map((tool) => tool.function.name),
      ["bash"],
    );
  });

  it("leaves history and non-bash tools alone when not fitting the window", () => {
    const payload = normalizeFmServePayload({
      messages: [
        { role: "user", content: [{ type: "text", text: "old" }] },
        { role: "user", content: [{ type: "image" }, { type: "text", text: "keep" }] },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "read",
            parameters: { type: "object", additionalProperties: true, patternProperties: { x: {} } },
          },
        },
      ],
    }) as {
      messages: Array<{ content: unknown }>;
      tools: Array<{ function: { parameters: { additionalProperties: boolean; patternProperties?: unknown } } }>;
    };

    assert.equal(payload.messages[0]?.content, "old");
    assert.deepEqual(payload.messages[1]?.content, [{ type: "image" }, { type: "text", text: "keep" }]);
    assert.equal(payload.tools[0]?.function.parameters.additionalProperties, false);
    assert.equal(payload.tools[0]?.function.parameters.patternProperties, undefined);
    assert.equal(normalizeFmServePayload("nope"), "nope");
  });
});

describe("runtime symbols", () => {
  it("does not reuse adstastic/pi-apple-fm settings, logs, status keys, or env names", () => {
    assert.equal(SETTINGS_FILE.endsWith("/zonuexe-pi-apple-fm.json"), true);
    assert.equal(SETTINGS_FILE.endsWith("/pi-apple-fm.json"), false);
    assert.equal(LOG_FILE.endsWith("/zonuexe-pi-apple-fm.log"), true);
    assert.equal(LOG_FILE.endsWith("/pi-apple-fm.log"), false);
    assert.notEqual(STATUS_KEY, "apple-fm");
    assert.equal(FM_PORT_ENV, "PI_APPLE_FM_PORT");
    assert.equal(FM_BIN_ENV, "PI_APPLE_FM_BIN");
  });

  it("resolves the on-device port and binary without reading APPLE_FM_*", () => {
    assert.equal(resolveFmPort(""), 1976);
    assert.equal(resolveFmPort("   "), 1976);
    assert.equal(resolveFmPort("1"), 1);
    assert.equal(resolveFmPort("65535"), 65535);
    assert.equal(resolveFmPort("1977"), 1977);
    assert.throws(() => resolveFmPort("0"), /PI_APPLE_FM_PORT/);
    assert.throws(() => resolveFmPort("65536"), /PI_APPLE_FM_PORT/);
    assert.throws(() => resolveFmPort("12a"), /PI_APPLE_FM_PORT/);
    assert.equal(resolveFmBin(""), "/usr/bin/fm");
    assert.equal(resolveFmBin("  "), "/usr/bin/fm");
    assert.equal(resolveFmBin("  /opt/fm  "), "/opt/fm");
  });
});
