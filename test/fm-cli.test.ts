import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFmChatArgs,
  buildFmCountTokensArgs,
  buildFmRespondArgs,
  checkFmAvailability,
  countFmTokens,
  listFmSessions,
  parseFmLicenseStatus,
  parseFmTokenCount,
  runFmChat,
  runFmRespond,
  stripAnsi,
} from "../src/fm-cli.js";
import { parseFmCommandLine } from "../src/index.js";
import { normalizeFmSchema } from "../src/schema.js";

const skipLive = process.env.PI_APPLE_FM_SKIP_LIVE === "1";

describe("Apple Foundation Models CLI integration", () => {
  it("strips ANSI escape codes accurately", () => {
    const colored = "\u001b[38;2;130;215;90mHello\u001b[0m \u001b[1mWorld\u001b[0m";
    assert.equal(stripAnsi(colored), "Hello World");
  });

  it("builds CLI arguments matching `fm chat --help` specifications", () => {
    const args = buildFmChatArgs({
      prompt: "What is Swift?",
      instructions: "You are a compiler expert.",
      model: "system",
      resume: "swift-talk",
      continue: true,
      tools: ["barcode", "ocr"],
      setDefaultModel: "system",
    });

    assert.deepEqual(args, [
      "chat",
      "--continue",
      "-r",
      "swift-talk",
      "-i",
      "You are a compiler expert.",
      "-m",
      "system",
      "--tool",
      "barcode",
      "--tool",
      "ocr",
      "--set-default-model",
      "system",
    ]);
  });

  it("omits blank chat and respond flags", () => {
    assert.deepEqual(
      buildFmChatArgs({
        prompt: "hi",
        continue: false,
        resume: "  ",
        instructions: "",
        model: " \t",
        tools: ["", "  ", "ocr"],
        setDefaultModel: " ",
      }),
      ["chat", "--tool", "ocr"],
    );

    assert.deepEqual(
      buildFmRespondArgs({
        prompt: "hi",
        instructions: " ",
        model: "",
        images: [{ path: "  ", label: "page" }, { path: "photo.jpg", label: " " }],
        texts: ["", "caption"],
        tools: [" ", "barcode"],
      }),
      ["respond", "--image", "photo.jpg", "--text", "caption", "--tool", "barcode"],
    );

    assert.deepEqual(buildFmCountTokensArgs({ prompt: "hi", instructions: " ", texts: [""] }), [
      "count-tokens",
      "--quiet",
    ]);
  });

  it("builds respond and count-tokens arguments", () => {
    assert.deepEqual(
      buildFmRespondArgs({
        prompt: "hi",
        instructions: "Be brief",
        useCase: "content-tagging",
        schemaPath: "/tmp/schema.json",
        images: [{ path: "photo.jpg", label: "page" }],
        texts: ["caption"],
        tools: ["ocr"],
      }),
      [
        "respond",
        "--no-stream",
        "--schema",
        "/tmp/schema.json",
        "-i",
        "Be brief",
        "--use-case",
        "content-tagging",
        "--image",
        "photo.jpg",
        "--label",
        "page",
        "--text",
        "caption",
        "--tool",
        "ocr",
      ],
    );

    assert.deepEqual(
      buildFmCountTokensArgs({
        prompt: "hi",
        instructions: "Be brief",
        images: [{ path: "photo.jpg", label: "ignored" }],
        transcript: "session.json",
      }),
      ["count-tokens", "--quiet", "-i", "Be brief", "--image", "photo.jpg", "--transcript", "session.json"],
    );
  });

  it("parses token counts and license status", () => {
    assert.equal(parseFmTokenCount("Token count: 12\n"), 12);
    assert.equal(parseFmTokenCount("3"), 3);
    assert.equal(parseFmLicenseStatus("Agreed to license FM1 version 1.0 on yesterday.").agreed, true);
    assert.equal(parseFmLicenseStatus("Not agreed").agreed, false);
    assert.equal(parseFmLicenseStatus("").summary, "License status unavailable");
    assert.throws(() => parseFmTokenCount(""), /Unexpected token count/);
  });

  it("fills Apple schema fields the CLI decoder requires", () => {
    const normalized = normalizeFmSchema({
      type: "object",
      properties: {
        ok: { type: "boolean" },
        address: {
          type: "object",
          properties: { street: { type: "string" } },
        },
      },
      required: ["ok"],
    });

    assert.equal(normalized.title, "Response");
    assert.deepEqual(normalized["x-order"], ["ok", "address"]);
    assert.equal(normalized.additionalProperties, false);
    const properties = normalized.properties as { address: { title: string; "x-order": string[] } };
    assert.equal(properties.address.title, "Address");
    assert.deepEqual(properties.address["x-order"], ["street"]);

    const titled = normalizeFmSchema({
      type: "object",
      title: " Kept ",
      properties: { name: { type: "string" } },
      "x-order": ["name"],
      $ref: undefined,
    });
    assert.equal(titled.title, " Kept ");
    assert.deepEqual(titled["x-order"], ["name"]);

    const ref = normalizeFmSchema({ $ref: "#/$defs/Address", title: "Skip" });
    assert.deepEqual(ref, { $ref: "#/$defs/Address", title: "Skip" });

    const items = normalizeFmSchema({
      type: "array",
      items: { type: "object", properties: { id: { type: "string" } } },
    });
    const itemSchema = items.items as { title: string; "x-order": string[] };
    assert.equal(itemSchema.title, "ResponseItem");
    assert.deepEqual(itemSchema["x-order"], ["id"]);
    assert.throws(() => normalizeFmSchema("nope"), /JSON object/);
  });

  it("parses CLI flags from slash command input", () => {
    const parsed = parseFmCommandLine(
      '-i "You are a poet" --resume my-session --tool ocr Tell me a story'
    );

    assert.equal(parsed.instructions, "You are a poet");
    assert.equal(parsed.resume, "my-session");
    assert.deepEqual(parsed.tools, ["ocr"]);
    assert.equal(parsed.prompt, "Tell me a story");
  });

  it("checks availability on the current macOS system", async () => {
    const status = await checkFmAvailability();
    assert.equal(typeof status.available, "boolean");
    assert.ok(Array.isArray(status.models));
  });

  it("lists sessions from ~/.fm/sessions/ safely", async () => {
    const sessions = await listFmSessions();
    assert.ok(Array.isArray(sessions));
    const first = sessions[0];
    if (first) {
      assert.ok(first.name);
      assert.ok(first.path);
      assert.ok(first.mtime instanceof Date);
    }
  });

  it("executes fm chat and streams response on supported macOS", async (t) => {
    if (skipLive) {
      t.skip("Skipping live chat test during mutation testing.");
      return;
    }
    const availability = await checkFmAvailability();
    if (!availability.available) {
      t.skip("Skipping live chat test: Apple Foundation Models not available on this machine.");
      return;
    }

    const chunks: string[] = [];
    const result = await runFmChat({
      prompt: "Reply with the single word 'PI_TEST_SUCCESS'.",
      onChunk: (chunk) => chunks.push(chunk),
    });

    assert.equal(result.success, true);
    assert.ok(result.text.length > 0);
    assert.ok(chunks.length > 0);
    assert.ok(result.durationMs > 0);
  });

  it("counts tokens and returns schema JSON from fm respond", async (t) => {
    if (skipLive) {
      t.skip("Skipping live respond test during mutation testing.");
      return;
    }
    const availability = await checkFmAvailability();
    if (!availability.available) {
      t.skip("Skipping live respond test: Apple Foundation Models not available on this machine.");
      return;
    }

    const counted = await countFmTokens({ prompt: "Hello world" });
    assert.equal(counted.success, true);
    if (counted.success) assert.ok(counted.count > 0);

    const result = await runFmRespond({
      prompt: "Set ok to true.",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
      },
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.json, { ok: true });
    }
  });
});
