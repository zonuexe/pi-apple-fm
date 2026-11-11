import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { Check } from "typebox/value";
import { DEFAULT_FM_SERVE_PORT, resolveFmBin } from "./runtime.js";
import { normalizeFmSchema } from "./schema.js";
import {
  FM_CONTEXT_WINDOW,
  fmTranscriptFileSchema,
  type FmAvailability,
  type FmChatOptions,
  type FmChatResult,
  type FmLicenseStatus,
  type FmRespondOptions,
  type FmRespondResult,
  type FmServeStatus,
  type FmSessionInfo,
  type FmTokenCountOptions,
  type FmTokenCountResult,
} from "./types.js";

export { DEFAULT_FM_SERVE_PORT };

let managedFmServeProcess: ChildProcess | null = null;

/**
 * Strips ANSI escape sequences and colors from text.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "");
}

/**
 * Returns the path to the directory where Apple Foundation Models sessions are stored.
 */
export function getSessionsDirectory(): string {
  return join(homedir(), ".fm", "sessions");
}

/**
 * Builds CLI argument list corresponding directly to `fm chat --help`.
 */
export function buildFmChatArgs(options: FmChatOptions): string[] {
  const args: string[] = ["chat"];

  if (options.continue) {
    args.push("--continue");
  }

  if (options.resume && options.resume.trim().length > 0) {
    args.push("-r", options.resume.trim());
  }

  if (options.instructions && options.instructions.trim().length > 0) {
    args.push("-i", options.instructions.trim());
  }

  if (options.model && options.model.trim().length > 0) {
    args.push("-m", options.model.trim());
  }

  if (Array.isArray(options.tools) && options.tools.length > 0) {
    for (const tool of options.tools) {
      if (typeof tool === "string" && tool.trim().length > 0) {
        args.push("--tool", tool.trim());
      }
    }
  }

  if (options.setDefaultModel && options.setDefaultModel.trim().length > 0) {
    args.push("--set-default-model", options.setDefaultModel.trim());
  }

  return args;
}

function pushTools(args: string[], tools: readonly string[] | undefined): void {
  if (!tools) return;
  for (const tool of tools) {
    if (tool.trim().length > 0) args.push("--tool", tool.trim());
  }
}

function pushImages(
  args: string[],
  images: readonly { path: string; label?: string }[] | undefined,
  includeLabels: boolean,
): void {
  if (!images) return;
  for (const image of images) {
    if (image.path.trim().length === 0) continue;
    args.push("--image", image.path);
    if (includeLabels && image.label && image.label.trim().length > 0) {
      args.push("--label", image.label.trim());
    }
  }
}

function pushTexts(args: string[], texts: readonly string[] | undefined): void {
  if (!texts) return;
  for (const text of texts) {
    if (text.trim().length > 0) args.push("--text", text);
  }
}

export function buildFmRespondArgs(options: FmRespondOptions & { schemaPath?: string }): string[] {
  const args = ["respond"];
  if (options.schemaPath) {
    args.push("--no-stream", "--schema", options.schemaPath);
  }
  if (options.instructions && options.instructions.trim().length > 0) {
    args.push("-i", options.instructions.trim());
  }
  if (options.model && options.model.trim().length > 0) {
    args.push("-m", options.model.trim());
  }
  if (options.useCase) {
    args.push("--use-case", options.useCase);
  }
  pushImages(args, options.images, true);
  pushTexts(args, options.texts);
  pushTools(args, options.tools);
  return args;
}

export function buildFmCountTokensArgs(options: FmTokenCountOptions): string[] {
  const args = ["count-tokens", "--quiet"];
  if (options.instructions && options.instructions.trim().length > 0) {
    args.push("-i", options.instructions.trim());
  }
  pushImages(args, options.images, false);
  pushTexts(args, options.texts);
  if (options.transcript && options.transcript.trim().length > 0) {
    args.push("--transcript", options.transcript.trim());
  }
  return args;
}

export function parseFmTokenCount(text: string): number {
  const clean = stripAnsi(text).trim();
  const match = clean.match(/(\d+)\s*$/);
  const digits = match?.[1];
  if (!digits) {
    throw new Error(`Unexpected token count output: ${clean || "(empty)"}`);
  }
  return Number(digits);
}

export function parseFmLicenseStatus(text: string): FmLicenseStatus {
  const summary = stripAnsi(text).trim();
  return {
    agreed: /^Agreed to license\b/i.test(summary),
    summary: summary || "License status unavailable",
  };
}

function missingImage(images: readonly { path: string }[] | undefined): string | undefined {
  for (const image of images ?? []) {
    if (!existsSync(image.path)) return `Image not found: ${image.path}`;
  }
  return undefined;
}

interface FmSpawnOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function spawnFm(
  args: string[],
  stdin: string | undefined,
  signal: AbortSignal | undefined,
  onChunk?: (chunk: string) => void,
): Promise<FmSpawnOutcome> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let aborted = false;

    const child =
      stdin === undefined
        ? spawn(resolveFmBin(), args, { stdio: ["ignore", "pipe", "pipe"] })
        : spawn(resolveFmBin(), args, { stdio: ["pipe", "pipe", "pipe"] });

    if (signal) {
      if (signal.aborted) {
        child.kill("SIGKILL");
        reject(new Error("Operation was aborted."));
        return;
      }
      signal.addEventListener("abort", () => {
        aborted = true;
        child.kill("SIGINT");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 1000);
      });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      onChunk?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err: Error) => {
      reject(
        new Error(
          `Failed to spawn Apple Foundation Models CLI 'fm': ${err.message}. Ensure you are running macOS 15+ with Apple Intelligence supported hardware.`,
        ),
      );
    });
    child.on("close", (code: number | null) => {
      if (aborted) {
        reject(new Error("Apple Foundation Models command cancelled."));
        return;
      }
      resolve({
        code,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
      });
    });

    if (stdin === undefined) return;
    const promptToSend = stdin.endsWith("\n") ? stdin : `${stdin}\n`;
    const input = child.stdin;
    if (!input) {
      reject(new Error("Failed to open stdin for fm."));
      return;
    }
    input.write(promptToSend, "utf8", (err) => {
      if (err) {
        child.kill("SIGKILL");
        reject(err);
      } else {
        input.end();
      }
    });
  });
}

function commandFailure(outcome: FmSpawnOutcome, fallback: string): FmChatResult {
  const cleanStderr = stripAnsi(outcome.stderr).trim();
  return {
    success: false,
    text: cleanStderr || `${fallback} (code ${outcome.code})`,
    rawStdout: outcome.stdout,
    rawStderr: outcome.stderr,
    durationMs: outcome.durationMs,
  };
}

/**
 * Checks whether `fm serve` is currently running and healthy on the specified port.
 */
export async function checkFmServeHealth(port = DEFAULT_FM_SERVE_PORT): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
        timeout: 1000,
      },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );

    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Starts `fm serve` in the background if not already running.
 */
export async function startFmServe(port = DEFAULT_FM_SERVE_PORT): Promise<FmServeStatus> {
  const isHealthy = await checkFmServeHealth(port);
  if (isHealthy) {
    return { running: true, spawned: false };
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(resolveFmBin(), ["serve", "--host", "127.0.0.1", "--port", String(port)], {
        stdio: "ignore",
        detached: false,
      });

      managedFmServeProcess = child;

      child.on("error", (err) => {
        managedFmServeProcess = null;
        resolve({ running: false, spawned: false, error: err.message });
      });

      // Poll health endpoint for up to 3 seconds
      const start = Date.now();
      const interval = setInterval(async () => {
        const ok = await checkFmServeHealth(port);
        if (ok) {
          clearInterval(interval);
          resolve({ running: true, spawned: true });
        } else if (Date.now() - start > 3000) {
          clearInterval(interval);
          resolve({ running: false, spawned: true, error: "Timed out waiting for fm serve to respond." });
        }
      }, 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({ running: false, spawned: false, error: message });
    }
  });
}

/**
 * Stops any background `fm serve` process started by this extension.
 */
export function stopFmServe(): void {
  if (managedFmServeProcess) {
    try {
      managedFmServeProcess.kill("SIGTERM");
    } catch {
      // Ignore errors on shutdown
    }
    managedFmServeProcess = null;
  }
}

export async function checkFmAvailability(): Promise<FmAvailability> {
  if (process.platform !== "darwin") {
    return {
      available: false,
      reason: "Apple Foundation Models requires macOS (Apple Silicon). Current OS: " + process.platform,
      models: [],
    };
  }

  return new Promise<FmAvailability>((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(resolveFmBin(), ["available"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err: Error) => {
      resolve({
        available: false,
        reason: `Apple Foundation Models CLI 'fm' is not available in PATH: ${err.message}`,
        models: [],
      });
    });

    child.on("close", (code: number | null) => {
      const combined = stripAnsi(stdout + stderr).trim();
      if (code === 0 && (combined.includes("available") || combined.includes("system"))) {
        resolve({
          available: true,
          models: ["system"],
        });
      } else {
        resolve({
          available: false,
          reason: combined || `Apple Foundation Models unavailable (code ${code})`,
          models: [],
        });
      }
    });
  });
}

/**
 * Lists saved chat sessions from ~/.fm/sessions/
 */
export async function listFmSessions(): Promise<FmSessionInfo[]> {
  const sessionsDir = getSessionsDirectory();
  if (!existsSync(sessionsDir)) {
    return [];
  }

  try {
    const files = await readdir(sessionsDir);
    const sessionFiles = files.filter((f) => f.endsWith(".json"));

    const sessions: FmSessionInfo[] = [];

    await Promise.all(
      sessionFiles.map(async (filename) => {
        const fullPath = join(sessionsDir, filename);
        try {
          const fileStat = await stat(fullPath);
          const raw = await readFile(fullPath, "utf8");
          const parsed: unknown = JSON.parse(raw);
          if (!Check(fmTranscriptFileSchema, parsed)) {
            return;
          }

          const entries = parsed.transcript?.transcript?.entries ?? [];
          const sessionName = filename.replace(/\.json$/, "");

          let preview: string | undefined;
          for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (!entry) continue;
            const textContent = entry.contents?.find((c) => c.text)?.text;
            if (textContent) {
              preview = textContent.replace(/\s+/g, " ").trim();
              if (preview.length > 80) {
                preview = preview.slice(0, 77) + "...";
              }
              break;
            }
          }

          sessions.push({
            name: sessionName,
            path: fullPath,
            mtime: fileStat.mtime,
            messageCount: entries.length,
            modelName: parsed.modelName ?? "system",
            ...(preview !== undefined ? { preview } : {}),
          });
        } catch {
          // Ignore corrupt or unreadable session files
        }
      })
    );

    // Sort newest first
    sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return sessions;
  } catch {
    return [];
  }
}

function sessionNameFrom(stderr: string, resume: string | undefined): { sessionName: string } | undefined {
  const matchResume = stripAnsi(stderr).match(/--resume\s+([^\s\r\n]+)/);
  const sessionName = matchResume?.[1] ?? resume;
  return sessionName === undefined ? undefined : { sessionName };
}

/**
 * Executes `fm chat` with piped input and handles streaming output.
 */
export async function runFmChat(options: FmChatOptions): Promise<FmChatResult> {
  const outcome = await spawnFm(buildFmChatArgs(options), options.prompt, options.signal, options.onChunk);
  const session = sessionNameFrom(outcome.stderr, options.resume);
  if (outcome.code !== 0) {
    return {
      ...commandFailure(outcome, "fm chat process exited"),
      ...session,
    };
  }
  return {
    success: true,
    text: stripAnsi(outcome.stdout).trim(),
    rawStdout: outcome.stdout,
    rawStderr: outcome.stderr,
    durationMs: outcome.durationMs,
    ...session,
  };
}

function respondFromOutcome(outcome: FmSpawnOutcome, expectJson: boolean): FmRespondResult {
  if (outcome.code !== 0) return commandFailure(outcome, "fm respond process exited");
  const text = stripAnsi(outcome.stdout).trim();
  if (!expectJson) {
    return {
      success: true,
      text,
      rawStdout: outcome.stdout,
      rawStderr: outcome.stderr,
      durationMs: outcome.durationMs,
    };
  }
  try {
    return {
      success: true,
      text,
      json: JSON.parse(text) as unknown,
      rawStdout: outcome.stdout,
      rawStderr: outcome.stderr,
      durationMs: outcome.durationMs,
    };
  } catch {
    return {
      success: false,
      text: `fm respond did not return JSON: ${text}`,
      rawStdout: outcome.stdout,
      rawStderr: outcome.stderr,
      durationMs: outcome.durationMs,
    };
  }
}

async function withSchemaFile(schema: unknown, run: (path: string) => Promise<FmRespondResult>): Promise<FmRespondResult> {
  const dir = await mkdtemp(join(tmpdir(), "pi-apple-fm-"));
  try {
    const path = join(dir, "schema.json");
    await writeFile(path, JSON.stringify(normalizeFmSchema(schema)), "utf8");
    return await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Executes one-shot `fm respond`. Structured output is requested with `--schema`.
 */
export async function runFmRespond(options: FmRespondOptions): Promise<FmRespondResult> {
  const missing = missingImage(options.images);
  if (missing) {
    return {
      success: false,
      text: missing,
      rawStdout: "",
      rawStderr: missing,
      durationMs: 0,
    };
  }

  const run = async (schemaPath?: string): Promise<FmRespondResult> => {
    const args = buildFmRespondArgs({
      ...options,
      ...(schemaPath ? { schemaPath } : {}),
    });
    const outcome = await spawnFm(args, options.prompt, options.signal, options.onChunk);
    return respondFromOutcome(outcome, schemaPath !== undefined);
  };

  if (typeof options.schema === "string" && existsSync(options.schema)) {
    return run(options.schema);
  }
  if (options.schema !== undefined) {
    const parsed = typeof options.schema === "string" ? (JSON.parse(options.schema) as unknown) : options.schema;
    return withSchemaFile(parsed, run);
  }
  return run();
}

export async function countFmTokens(options: FmTokenCountOptions): Promise<FmTokenCountResult> {
  const hasInput =
    (options.prompt !== undefined && options.prompt.length > 0) ||
    (options.instructions !== undefined && options.instructions.length > 0) ||
    (options.images !== undefined && options.images.length > 0) ||
    (options.texts !== undefined && options.texts.length > 0) ||
    (options.transcript !== undefined && options.transcript.length > 0);
  if (!hasInput) {
    return {
      success: false,
      count: 0,
      text: "count-tokens needs a prompt, instructions, image, text segment, or transcript",
      rawStdout: "",
      rawStderr: "",
      durationMs: 0,
    };
  }
  const missing = missingImage(options.images);
  if (missing) {
    return { success: false, count: 0, text: missing, rawStdout: "", rawStderr: missing, durationMs: 0 };
  }

  const outcome = await spawnFm(buildFmCountTokensArgs(options), options.prompt, options.signal);
  if (outcome.code !== 0) {
    const failure = commandFailure(outcome, "fm count-tokens process exited");
    return { ...failure, success: false, count: 0 };
  }
  try {
    const count = parseFmTokenCount(outcome.stdout);
    return {
      success: true,
      count,
      text: String(count),
      rawStdout: outcome.stdout,
      rawStderr: outcome.stderr,
      durationMs: outcome.durationMs,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      count: 0,
      text: message,
      rawStdout: outcome.stdout,
      rawStderr: outcome.stderr,
      durationMs: outcome.durationMs,
    };
  }
}

/** Returns an error string when the prompt cannot fit the on-device window. */
export async function contextWindowError(options: FmTokenCountOptions): Promise<string | undefined> {
  try {
    const counted = await countFmTokens(options);
    if (!counted.success) return undefined;
    if (counted.count > FM_CONTEXT_WINDOW) {
      return `Prompt is ${counted.count} tokens, which exceeds the on-device window of ${FM_CONTEXT_WINDOW}.`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function checkFmLicense(): Promise<FmLicenseStatus> {
  try {
    const outcome = await spawnFm(["license", "--status"], undefined, undefined);
    return parseFmLicenseStatus(outcome.stdout || outcome.stderr);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { agreed: false, summary: message };
  }
}

export async function showFmLicense(): Promise<string> {
  const outcome = await spawnFm(["license", "--show"], undefined, undefined);
  const text = stripAnsi(outcome.stdout || outcome.stderr).trim();
  if (outcome.code !== 0) {
    throw new Error(text || `fm license --show exited with code ${outcome.code}`);
  }
  return text;
}
