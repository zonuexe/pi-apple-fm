import { defineTool, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  checkFmAvailability,
  checkFmServeHealth,
  DEFAULT_FM_SERVE_PORT,
  listFmSessions,
  runFmChat,
  startFmServe,
  stopFmServe,
} from "./fm-cli.js";
import { renderFmCall, renderFmResult } from "./render.js";
import { fmChatParametersSchema, type FmChatOptions, type FmChatParameters, type FmChatResult } from "./types.js";

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

/**
 * Pi Extension Entrypoint for Apple Foundation Models CLI (fm chat).
 */
export default function appleFmExtension(pi: ExtensionAPI) {
  // =========================================================================
  // 1. Register Provider: apple (Enables model selection in /model)
  // =========================================================================
  pi.registerProvider("apple", {
    name: "Apple Foundation Models",
    baseUrl: `http://127.0.0.1:${DEFAULT_FM_SERVE_PORT}/v1`,
    apiKey: "none",
    api: "openai-completions",
    models: [
      {
        type: "chat",
        id: "system",
        name: "Apple Foundation Model (System)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 2048,
      },
    ],
  });

  // Clean up any background `fm serve` process on session shutdown
  pi.on("session_shutdown", async () => {
    stopFmServe();
  });

  // =========================================================================
  // 2. Register Tool: apple_fm_chat
  // =========================================================================
  pi.registerTool(defineTool<typeof fmChatParametersSchema, FmChatResult>({
    name: "apple_fm_chat",
    label: "Apple FM Chat",
    description:
      "Interact with Apple Foundation Models on macOS via the native 'fm chat' CLI. Supports session continuity (--continue, --resume), system instructions, and vision tools (barcode, ocr).",
    promptSnippet: "Chat with on-device Apple Foundation Models via macOS 'fm chat' CLI",
    promptGuidelines: [
      "Use apple_fm_chat when you need to query Apple's on-device Foundation Model, continue previous dialogue sessions, or utilize built-in vision tools like OCR and barcode parsing on macOS.",
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
        { value: "sessions", label: "sessions", description: "List saved chat sessions in ~/.fm/sessions/" },
        { value: "status", label: "status", description: "Check Apple Foundation Models availability" },
      ];

      const filtered = commands.filter((c) => c.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },

    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();

      // 1. Status command
      if (trimmed === "status") {
        const availability = await checkFmAvailability();
        const serveHealthy = await checkFmServeHealth();
        if (availability.available) {
          ctx.ui.notify(
            `Apple Foundation Models available (models: ${availability.models.join(", ")}). Server (fm serve): ${
              serveHealthy ? "RUNNING (ready for /model)" : "STOPPED"
            }`,
            "info"
          );
        } else {
          ctx.ui.notify(`Apple Foundation Models unavailable: ${availability.reason}`, "error");
        }
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

        const isRunning = await checkFmServeHealth();
        if (sub === "start" || !isRunning) {
          ctx.ui.notify("Starting Apple Foundation Models server (fm serve)...", "info");
          const result = await startFmServe();
          if (result.running) {
            ctx.ui.notify(
              ` fm serve is running on http://127.0.0.1:${DEFAULT_FM_SERVE_PORT}. You can now select 'apple/system' in /model!`,
              "info"
            );
          } else {
            ctx.ui.notify(`Failed to start fm serve: ${result.error}`, "error");
          }
          return;
        }

        ctx.ui.notify(
          ` fm serve is already running on http://127.0.0.1:${DEFAULT_FM_SERVE_PORT}. Select 'apple/system' in /model.`,
          "info"
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
        const isRunning = await checkFmServeHealth();
        if (isRunning) {
          const choice = await ctx.ui.select("fm serve is running on port 1976", [
            "Keep running (select 'apple/system' in /model)",
            "Stop server",
          ]);
          if (choice?.includes("Stop server")) {
            stopFmServe();
            ctx.ui.notify("Stopped background fm serve process.", "info");
          }
        } else {
          ctx.ui.notify("Starting fm serve on http://127.0.0.1:1976...", "info");
          const result = await startFmServe();
          if (result.running) {
            ctx.ui.notify(" fm serve is active! You can now select 'apple/system' in /model.", "info");
          } else {
            ctx.ui.notify(`Failed to start fm serve: ${result.error}`, "error");
          }
        }
      } else if (action.includes("Check model availability")) {
        const status = await checkFmAvailability();
        if (status.available) {
          ctx.ui.notify(`Apple Foundation Models available (models: ${status.models.join(", ")})`, "info");
        } else {
          ctx.ui.notify(`Apple Foundation Models unavailable: ${status.reason}`, "error");
        }
      }
    },
  });
}
