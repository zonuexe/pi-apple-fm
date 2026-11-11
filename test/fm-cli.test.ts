import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFmChatArgs,
  checkFmAvailability,
  listFmSessions,
  runFmChat,
  stripAnsi,
} from "../src/fm-cli.js";
import { parseFmCommandLine } from "../src/index.js";

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
});
