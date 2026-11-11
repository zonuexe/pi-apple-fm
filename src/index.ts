import { defineTool, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  checkFmAvailability,
  checkFmLicense,
  checkFmServeHealth,
  contextWindowError,
  countFmTokens,
  listFmSessions,
  runFmChat,
  runFmRespond,
  showFmLicense,
  startFmServe,
  stopFmServe,
} from "./fm-cli.js";
import { renderFmCall, renderFmResult } from "./render.js";
import {
  appendFmLog,
  loadStartServerBeforeRequest,
  LOG_FILE,
  resolveFmPort,
  saveStartServerBeforeRequest,
  SETTINGS_FILE,
  STATUS_KEY,
} from "./runtime.js";
import { normalizeFmServePayload } from "./serve-payload.js";
import {
  FM_CONTEXT_WINDOW,
  fmChatParametersSchema,
  fmCountTokensParametersSchema,
  fmRespondParametersSchema,
  type FmChatOptions,
  type FmChatParameters,
  type FmChatResult,
  type FmCountTokensParameters,
  type FmRespondParameters,
  type FmRespondResult,
  type FmTokenCountResult,
} from "./types.js";

/**
 * Parses raw command-line argument strings into FmChatOptions.
 */
export function parseFmCommandLine(argString: string): FmChatOptions {
  const parts: string[] = [];
  let current = "";
  let quoteChar: '"' | "'" | undefined;

  for (const char of argString) {
    if (quoteChar) {
      if (char === quoteChar) {
        quoteChar = undefined;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quoteChar = char;
    } else if (char === " " || char === "\t") {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }

  const options: FmChatOptions = { prompt: "" };
  const promptWords: string[] = [];
  const tools: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) {
      continue;
    }
    const next = parts[i + 1];
    if (part === "--continue") {
      options.continue = true;
    } else if ((part === "-r" || part === "--resume") && next !== undefined) {
      options.resume = next;
      i++;
    } else if ((part === "-i" || part === "--instructions") && next !== undefined) {
      options.instructions = next;
      i++;
    } else if ((part === "-m" || part === "--model") && next !== undefined) {
      options.model = next;
      i++;
    } else if (part === "--tool" && next !== undefined) {
      tools.push(next);
      i++;
    } else if (part === "--set-default-model" && next !== undefined) {
      options.setDefaultModel = next;
      i++;
    } else {
      promptWords.push(part);
    }
  }

  if (tools.length > 0) {
    options.tools = tools;
  }
  options.prompt = promptWords.join(" ");
  return options;
}

async function readFmStatus(port: number): Promise<{ ok: boolean; text: string }> {
  const [availability, serveHealthy, license] = await Promise.all([
    checkFmAvailability(),
    checkFmServeHealth(port),
    checkFmLicense(),
  ]);
  const licenseText = license.summary;
  if (!availability.available) {
    return {
      ok: false,
      text: `Apple Foundation Models unavailable: ${availability.reason}. ${licenseText}`,
    };
  }
  return {
    ok: true,
    text: `Apple Foundation Models available (models: ${availability.models.join(", ")}). Server (fm serve): ${
      serveHealthy ? "RUNNING (ready for /model)" : "STOPPED"
    }. ${licenseText}`,
  };
}

/**
 * Pi Extension Entrypoint for Apple Foundation Models CLI (fm chat).
 */
export default function appleFmExtension(pi: ExtensionAPI) {
  const port = resolveFmPort();
  let startServerBeforeRequest = true;

  // On-device `system` only. Private Cloud Compute is not a released `fm` model.
  pi.registerProvider("apple", {
    name: "On-device Apple FM",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "none",
    api: "openai-completions",
    models: [
      {
        type: "chat",
        id: "system",
        name: "Apple Foundation Model (On-device)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: FM_CONTEXT_WINDOW,
        maxTokens: 512,
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: true,
          supportsStrictMode: false,
          maxTokensField: "max_tokens",
        },
      },
    ],
  });

  pi.on("session_start", async () => {
    startServerBeforeRequest = await loadStartServerBeforeRequest();
  });

  pi.on("session_shutdown", async () => {
    stopFmServe();
  });

  pi.on("before_provider_request", async (event, ctx) => {
    if (ctx.model?.provider !== "apple") return;

    if (!(await checkFmServeHealth(port))) {
      if (!startServerBeforeRequest) {
        ctx.ui.notify("fm serve is stopped. Run /fm serve start, or /fm auto-start on.", "error");
        ctx.abort();
        return;
      }
      ctx.ui.setStatus(STATUS_KEY, "Starting on-device fm serve…");
      const started = await startFmServe(port);
      ctx.ui.setStatus(STATUS_KEY, undefined);
      await appendFmLog("serve", { port, ok: started.running, spawned: started.spawned });
      if (!started.running) {
        ctx.ui.notify(`Failed to start fm serve: ${started.error ?? "unknown error"}`, "error");
        ctx.abort();
        return;
      }
    }

    return normalizeFmServePayload(event.payload, {
      fitContextWindow: ctx.model.id === "system",
    });
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.model.provider !== "apple") return;
    const mode = startServerBeforeRequest ? "on" : "off";
    ctx.ui.notify(
      `apple/system uses the ${FM_CONTEXT_WINDOW}-token on-device model. Provider calls send the latest turn and bash. Server auto-start is ${mode}.`,
      "info",
    );
  });

  // =========================================================================
  // 2. Register Tool: apple_fm_chat
  // =========================================================================
  pi.registerTool(defineTool<typeof fmChatParametersSchema, FmChatResult>({
    name: "apple_fm_chat",
    label: "Apple FM Chat",
    description:
      "Continue an on-device Apple Foundation Models chat session via `fm chat`. Saves to ~/.fm/sessions/. Does not accept images or JSON schema; use apple_fm_respond for those.",
    promptSnippet: "Continue an on-device Apple Foundation Models chat session",
    promptGuidelines: [
      "Use apple_fm_chat to resume or continue a saved fm chat session. Use apple_fm_respond for one-shot answers, JSON schema output, OCR, or barcode images. Use apple_fm_count_tokens before a long prompt; the on-device window is 4096 tokens.",
    ],
    parameters: fmChatParametersSchema,

    async execute(_toolCallId, params: FmChatParameters, signal, onUpdate) {
      // 1. Verify availability
      const availability = await checkFmAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: "text",
              text: `Apple Foundation Models unavailable: ${availability.reason}`,
            },
          ],
          details: {
            success: false,
            text: availability.reason,
            rawStdout: "",
            rawStderr: "",
            durationMs: 0,
          },
          isError: true,
        };
      }

      // 2. Stream partial tokens via onUpdate
      let accumulatedText = "";
      const handleChunk = (chunk: string) => {
        accumulatedText += chunk;
        onUpdate?.({
          content: [{ type: "text", text: accumulatedText }],
          details: {
            success: true,
            text: accumulatedText,
            rawStdout: accumulatedText,
            rawStderr: "",
            durationMs: 0,
          },
        });
      };

      try {
        const tooLong = await contextWindowError({
          prompt: params.prompt,
          ...(params.instructions ? { instructions: params.instructions } : {}),
          ...(signal ? { signal } : {}),
        });
        if (tooLong) {
          return {
            content: [{ type: "text", text: tooLong }],
            details: {
              success: false,
              text: tooLong,
              rawStdout: "",
              rawStderr: "",
              durationMs: 0,
            },
            isError: true,
          };
        }

        const result = await runFmChat({
          ...params,
          ...(signal ? { signal } : {}),
          onChunk: handleChunk,
        });

        return {
          content: [{ type: "text", text: result.text }],
          details: result,
          isError: !result.success,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Apple FM Chat failed: ${message}` }],
          details: {
            success: false,
            text: message,
            rawStdout: "",
            rawStderr: message,
            durationMs: 0,
          },
          isError: true,
        };
      }
    },

    renderCall(args, theme, context) {
      return renderFmCall(args, theme, context);
    },

    renderResult(result, options, theme, context) {
      return renderFmResult(result, options, theme, context);
    },
  }));

  pi.registerTool(defineTool<typeof fmRespondParametersSchema, FmRespondResult>({
    name: "apple_fm_respond",
    label: "Apple FM Respond",
    description:
      "One-shot Apple Foundation Models response via `fm respond`. Use for structured JSON (schema), image OCR/barcode, or a single answer that should not create a chat session.",
    promptSnippet: "One-shot on-device Apple Foundation Models response, with optional JSON schema and images",
    promptGuidelines: [
      "Prefer apple_fm_respond over apple_fm_chat when you need JSON, an image, or no saved session. Pass a JSON Schema object as schema; title and x-order are added automatically. Attach images for OCR or barcode. Do not use this to agree to the fm license.",
    ],
    parameters: fmRespondParametersSchema,
    async execute(_toolCallId, params: FmRespondParameters, signal, onUpdate) {
      const availability = await checkFmAvailability();
      if (!availability.available) {
        return {
          content: [{ type: "text", text: `Apple Foundation Models unavailable: ${availability.reason}` }],
          details: {
            success: false,
            text: availability.reason,
            rawStdout: "",
            rawStderr: "",
            durationMs: 0,
          },
          isError: true,
        };
      }

      let accumulatedText = "";
      const handleChunk = (chunk: string) => {
        accumulatedText += chunk;
        onUpdate?.({
          content: [{ type: "text", text: accumulatedText }],
          details: {
            success: true,
            text: accumulatedText,
            rawStdout: accumulatedText,
            rawStderr: "",
            durationMs: 0,
          },
        });
      };

      try {
        const tooLong = await contextWindowError({
          prompt: params.prompt,
          ...(params.instructions ? { instructions: params.instructions } : {}),
          ...(params.images ? { images: params.images } : {}),
          ...(params.texts ? { texts: params.texts } : {}),
          ...(signal ? { signal } : {}),
        });
        if (tooLong) {
          return {
            content: [{ type: "text", text: tooLong }],
            details: {
              success: false,
              text: tooLong,
              rawStdout: "",
              rawStderr: "",
              durationMs: 0,
            },
            isError: true,
          };
        }

        const result = await runFmRespond({
          ...params,
          ...(signal ? { signal } : {}),
          onChunk: handleChunk,
        });
        return {
          content: [{ type: "text", text: result.text }],
          details: result,
          isError: !result.success,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Apple FM Respond failed: ${message}` }],
          details: {
            success: false,
            text: message,
            rawStdout: "",
            rawStderr: message,
            durationMs: 0,
          },
          isError: true,
        };
      }
    },
    renderCall(args, theme, context) {
      return renderFmCall(args, theme, context, "respond");
    },
    renderResult(result, options, theme, context) {
      return renderFmResult(result, options, theme, context);
    },
  }));

  pi.registerTool(defineTool<typeof fmCountTokensParametersSchema, FmTokenCountResult>({
    name: "apple_fm_count_tokens",
    label: "Apple FM Tokens",
    description: `Count on-device tokens with \`fm count-tokens\` before sending a prompt. The window is ${FM_CONTEXT_WINDOW} tokens.`,
    promptSnippet: "Count tokens for the on-device Apple Foundation Model",
    parameters: fmCountTokensParametersSchema,
    async execute(_toolCallId, params: FmCountTokensParameters, signal) {
      try {
        const result = await countFmTokens({
          ...params,
          ...(signal ? { signal } : {}),
        });
        const text = result.success
          ? `${result.count} tokens (${FM_CONTEXT_WINDOW - result.count} left in the ${FM_CONTEXT_WINDOW} window)`
          : result.text;
        return {
          content: [{ type: "text", text }],
          details: result,
          isError: !result.success,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: message }],
          details: {
            success: false,
            count: 0,
            text: message,
            rawStdout: "",
            rawStderr: message,
            durationMs: 0,
          },
          isError: true,
        };
      }
    },
    renderCall(args, theme, context) {
      return renderFmCall(args, theme, context, "tokens");
    },
    renderResult(result, options, theme, context) {
      return renderFmResult(
        {
          ...result,
          details: {
            success: result.details.success,
            text: result.details.text,
            durationMs: result.details.durationMs,
          },
        },
        options,
        theme,
        context,
      );
    },
  }));

  // =========================================================================
  // 2. Register Slash Command: /fm
  // =========================================================================
  pi.registerCommand("fm", {
    description: "Run Apple Foundation Models chat (`fm chat`) on macOS",
    getArgumentCompletions: async (prefix: string): Promise<AutocompleteItem[] | null> => {
      const trimmed = prefix.trimStart();

      // Autocomplete session names if user typed -r or --resume
      if (trimmed.startsWith("--resume ") || trimmed.startsWith("-r ")) {
        const parts = trimmed.split(/\s+/);
        const lastPart = parts.at(-1);
        const sessionPrefix = parts.length > 2 && lastPart !== undefined ? lastPart : "";
        const sessions = await listFmSessions();
        const matches = sessions.filter((s) => s.name.startsWith(sessionPrefix));
        if (matches.length > 0) {
          const lead = trimmed.startsWith("-r ") ? "-r " : "--resume ";
          return matches.map((s) => ({
            value: `${lead}${s.name}`,
            label: `${s.name} (${s.messageCount} msgs, ${s.mtime.toLocaleDateString()})`,
            ...(s.preview !== undefined ? { description: s.preview } : {}),
          }));
        }
        return null;
      }

      // Top level flags and subcommands
      const commands: AutocompleteItem[] = [
        { value: "--continue", label: "--continue", description: "Continue the most recent chat session" },
        { value: "--resume ", label: "--resume <name>", description: "Resume a saved chat session" },
        { value: "-i ", label: "-i <instructions>", description: "Set model instructions" },
        { value: "--tool ocr ", label: "--tool ocr", description: "Enable built-in OCR tool" },
        { value: "--tool barcode ", label: "--tool barcode", description: "Enable built-in barcode tool" },
        { value: "serve", label: "serve", description: "Start or check status of fm serve (for /model)" },
        { value: "auto-start on", label: "auto-start on", description: "Start fm serve before apple/system requests" },
        { value: "auto-start off", label: "auto-start off", description: "Do not start fm serve automatically" },
        { value: "auto-start status", label: "auto-start status", description: "Show the saved auto-start setting" },
        { value: "logs", label: "logs", description: "Show recent on-device server actions" },
        { value: "help", label: "help", description: "Show /fm commands" },
        { value: "sessions", label: "sessions", description: "List saved chat sessions in ~/.fm/sessions/" },
        { value: "status", label: "status", description: "Check availability, server, and license status" },
        { value: "tokens ", label: "tokens <prompt>", description: "Count tokens against the 4096 window" },
        { value: "license", label: "license", description: "Show whether the fm license has been agreed to" },
        { value: "license show", label: "license show", description: "Print the license text without agreeing" },
      ];

      const filtered = commands.filter((c) => c.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },

    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();

      // 1. Status command
      if (trimmed === "status") {
        const status = await readFmStatus(port);
        ctx.ui.notify(status.text, status.ok ? "info" : "error");
        return;
      }

      if (trimmed === "help") {
        ctx.ui.notify(
          [
            "/fm — chat menu",
            "/fm serve start|status|stop — headless on-device fm serve",
            "/fm auto-start on|off|status — start the server before apple/system requests",
            "/fm status — availability, server, and license",
            "/fm logs — recent server actions",
            "/fm tokens <prompt> — count tokens",
            "/fm license show — print terms without agreeing",
            "/model — select apple/system. PCC is not registered.",
            `Settings: ${SETTINGS_FILE}`,
            `Log: ${LOG_FILE}`,
          ].join("\n"),
          "info",
        );
        return;
      }

      if (trimmed === "logs") {
        try {
          const { readFile } = await import("node:fs/promises");
          const content = await readFile(LOG_FILE, "utf8");
          const lines = content.trimEnd().split("\n").slice(-20);
          ctx.ui.notify(["Recent on-device FM logs", ...lines, `Log file: ${LOG_FILE}`].join("\n"), "info");
        } catch {
          ctx.ui.notify(`No log entries yet. ${LOG_FILE}`, "info");
        }
        return;
      }

      if (trimmed === "auto-start" || trimmed.startsWith("auto-start ")) {
        const action = trimmed.split(/\s+/)[1] ?? "status";
        if (action !== "on" && action !== "off" && action !== "status") {
          ctx.ui.notify("Usage: /fm auto-start [on|off|status]", "warning");
          return;
        }
        if (action === "status") {
          ctx.ui.notify(
            `Auto-start is ${startServerBeforeRequest ? "on" : "off"}. Settings: ${SETTINGS_FILE}`,
            "info",
          );
          return;
        }
        const enabled = action === "on";
        try {
          await saveStartServerBeforeRequest(enabled);
          startServerBeforeRequest = enabled;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.ui.notify(`Could not save auto-start: ${message}`, "error");
          return;
        }
        ctx.ui.notify(
          enabled
            ? "Auto-start is on. A stopped fm serve starts before apple/system requests."
            : "Auto-start is off. Run /fm serve start before using apple/system.",
          "info",
        );
        return;
      }

      if (trimmed === "license" || trimmed.startsWith("license ")) {
        const sub = trimmed.split(/\s+/)[1];
        if (sub === "show") {
          try {
            const text = await showFmLicense();
            await ctx.ui.editor("Apple Foundation Models license (read only)", text);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(`Could not show the fm license: ${message}`, "error");
          }
          return;
        }
        const license = await checkFmLicense();
        ctx.ui.notify(license.summary, license.agreed ? "info" : "warning");
        return;
      }

      if (trimmed === "tokens" || trimmed.startsWith("tokens ")) {
        const prompt = trimmed.slice("tokens".length).trim();
        if (!prompt) {
          ctx.ui.notify("Usage: /fm tokens <prompt>", "warning");
          return;
        }
        const counted = await countFmTokens({ prompt });
        if (!counted.success) {
          ctx.ui.notify(counted.text, "error");
          return;
        }
        const left = FM_CONTEXT_WINDOW - counted.count;
        ctx.ui.notify(
          `${counted.count} tokens, ${left} left in the ${FM_CONTEXT_WINDOW} window`,
          left < 0 ? "warning" : "info",
        );
        return;
      }

      // 1.5 Serve command (start / check fm serve for /model selection)
      if (trimmed.startsWith("serve")) {
        const sub = trimmed.split(/\s+/)[1] ?? "status";
        if (sub === "stop") {
          stopFmServe();
          ctx.ui.notify("Stopped background fm serve process.", "info");
          return;
        }

        const isRunning = await checkFmServeHealth(port);
        if (sub === "start" || !isRunning) {
          ctx.ui.notify("Starting on-device Apple FM server (fm serve)...", "info");
          const result = await startFmServe(port);
          if (result.running) {
            ctx.ui.notify(
              ` fm serve is running on http://127.0.0.1:${port}. You can now select apple/system in /model.`,
              "info",
            );
          } else {
            ctx.ui.notify(`Failed to start fm serve: ${result.error}`, "error");
          }
          return;
        }

        ctx.ui.notify(
          ` fm serve is already running on http://127.0.0.1:${port}. Select apple/system in /model.`,
          "info",
        );
        return;
      }

      // 2. Sessions list command
      if (trimmed === "sessions" || trimmed === "list") {
        const sessions = await listFmSessions();
        if (sessions.length === 0) {
          ctx.ui.notify("No saved sessions found in ~/.fm/sessions/", "info");
          return;
        }

        const items = sessions.slice(0, 15).map((s) => {
          return `${s.name.padEnd(24)} | ${String(s.messageCount).padStart(3)} msgs | ${s.preview ?? ""}`;
        });

        await ctx.ui.select("Saved Apple Foundation Models Sessions", items);
        return;
      }

      // 3. One-shot command line arguments provided
      if (trimmed.length > 0) {
        const parsed = parseFmCommandLine(trimmed);
        if (!parsed.prompt && !parsed.continue && !parsed.resume) {
          ctx.ui.notify("Usage: /fm [options] <prompt> (see /fm for interactive menu)", "warning");
          return;
        }

        ctx.ui.notify("Invoking Apple Foundation Models...", "info");
        try {
          const result = await runFmChat(parsed);
          if (result.success) {
            const footer = result.sessionName ? ` [session: ${result.sessionName}]` : "";
            ctx.ui.notify(` ${result.text}${footer}`, "info");
          } else {
            ctx.ui.notify(` Error: ${result.text}`, "error");
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.ui.notify(`Apple FM execution failed: ${msg}`, "error");
        }
        return;
      }

      // 4. Interactive menu when /fm is run without arguments
      const action = await ctx.ui.select(" Apple Foundation Models CLI (fm chat)", [
        "💬 New chat message",
        "⏩ Continue last session (--continue)",
        "📂 Resume saved session (--resume)",
        "📋 List saved sessions",
        "🚀 Start / Check API server (fm serve for /model)",
        "ℹ️ Check model availability",
      ]);

      if (!action) return;

      if (action.includes("New chat message")) {
        const prompt = await ctx.ui.input("Enter prompt for Apple Foundation Models:");
        if (!prompt || !prompt.trim()) return;

        ctx.ui.notify("Generating response...", "info");
        const res = await runFmChat({ prompt: prompt.trim() });
        if (res.success) {
          ctx.ui.notify(` ${res.text}`, "info");
        } else {
          ctx.ui.notify(`Error: ${res.text}`, "error");
        }
      } else if (action.includes("Continue last session")) {
        const prompt = await ctx.ui.input("Enter follow-up message (--continue):");
        if (!prompt || !prompt.trim()) return;

        ctx.ui.notify("Continuing session...", "info");
        const res = await runFmChat({ prompt: prompt.trim(), continue: true });
        if (res.success) {
          ctx.ui.notify(` ${res.text}`, "info");
        } else {
          ctx.ui.notify(`Error: ${res.text}`, "error");
        }
      } else if (action.includes("Resume saved session")) {
        const sessions = await listFmSessions();
        if (sessions.length === 0) {
          ctx.ui.notify("No saved sessions found in ~/.fm/sessions/", "info");
          return;
        }

        const chosenSession = await ctx.ui.select(
          "Select a session to resume:",
          sessions.map((s) => `${s.name} (${s.messageCount} msgs) - ${s.preview ?? ""}`)
        );
        if (!chosenSession) return;

        const sessionName = chosenSession.split(" ")[0];
        if (!sessionName) return;
        const prompt = await ctx.ui.input(`Enter message for session '${sessionName}':`);
        if (!prompt || !prompt.trim()) return;

        ctx.ui.notify(`Resuming session ${sessionName}...`, "info");
        const res = await runFmChat({ prompt: prompt.trim(), resume: sessionName });
        if (res.success) {
          ctx.ui.notify(` ${res.text}`, "info");
        } else {
          ctx.ui.notify(`Error: ${res.text}`, "error");
        }
      } else if (action.includes("List saved sessions")) {
        const sessions = await listFmSessions();
        if (sessions.length === 0) {
          ctx.ui.notify("No saved sessions found in ~/.fm/sessions/", "info");
          return;
        }
        await ctx.ui.select(
          "Saved Sessions (Enter to close):",
          sessions.map((s) => `${s.name} [${s.mtime.toLocaleDateString()}] - ${s.preview ?? ""}`)
        );
      } else if (action.includes("Start / Check API server")) {
        const isRunning = await checkFmServeHealth(port);
        if (isRunning) {
          const choice = await ctx.ui.select(`fm serve is running on port ${port}`, [
            "Keep running (select apple/system in /model)",
            "Stop server",
          ]);
          if (choice?.includes("Stop server")) {
            stopFmServe();
            ctx.ui.notify("Stopped background fm serve process.", "info");
          }
        } else {
          ctx.ui.notify(`Starting fm serve on http://127.0.0.1:${port}...`, "info");
          const result = await startFmServe(port);
          if (result.running) {
            ctx.ui.notify(" fm serve is active! You can now select 'apple/system' in /model.", "info");
          } else {
            ctx.ui.notify(`Failed to start fm serve: ${result.error}`, "error");
          }
        }
      } else if (action.includes("Check model availability")) {
        const status = await readFmStatus(port);
        ctx.ui.notify(status.text, status.ok ? "info" : "error");
      }
    },
  });
}
