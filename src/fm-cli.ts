import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { Check } from "typebox/value";
import {
  fmTranscriptFileSchema,
  type FmAvailability,
  type FmChatOptions,
  type FmChatResult,
  type FmServeStatus,
  type FmSessionInfo,
} from "./types.js";

export const DEFAULT_FM_SERVE_PORT = 1976;

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
      const child = spawn("fm", ["serve", "--port", String(port)], {
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

    const child = spawn("fm", ["available"], {
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

/**
 * Executes `fm chat` with piped input and handles streaming output.
 */
export async function runFmChat(options: FmChatOptions): Promise<FmChatResult> {
  const startTime = Date.now();
  const args = buildFmChatArgs(options);

  return new Promise<FmChatResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const child = spawn("fm", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (options.signal) {
      if (options.signal.aborted) {
        child.kill("SIGKILL");
        return reject(new Error("Operation was aborted."));
      }

      options.signal.addEventListener("abort", () => {
        killed = true;
        child.kill("SIGINT");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 1000);
      });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      options.onChunk?.(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err: Error) => {
      reject(
        new Error(
          `Failed to spawn Apple Foundation Models CLI 'fm': ${err.message}. Ensure you are running macOS 15+ with Apple Intelligence supported hardware.`
        )
      );
    });

    child.on("close", (code: number | null) => {
      const durationMs = Date.now() - startTime;
      const cleanStdout = stripAnsi(stdout);
      const cleanStderr = stripAnsi(stderr);

      // Extract session name if available from stderr
      // e.g. "Resume conversation with: fm chat --resume my-session"
      let sessionName: string | undefined;
      const matchResume = cleanStderr.match(/--resume\s+([^\s\r\n]+)/);
      if (matchResume && matchResume[1]) {
        sessionName = matchResume[1];
      } else if (options.resume) {
        sessionName = options.resume;
      }

      if (killed) {
        return reject(new Error("Apple Foundation Models chat cancelled."));
      }

      const session = sessionName === undefined ? {} : { sessionName };

      if (code !== 0) {
        const errorMsg = cleanStderr.trim() || `fm chat process exited with code ${code}`;
        return resolve({
          success: false,
          text: errorMsg,
          rawStdout: stdout,
          rawStderr: stderr,
          durationMs,
          ...session,
        });
      }

      resolve({
        success: true,
        text: cleanStdout.trim(),
        rawStdout: stdout,
        rawStderr: stderr,
        durationMs,
        ...session,
      });
    });

    // Send the prompt to stdin and close stdin to signal EOF
    const promptToSend = options.prompt.endsWith("\n") ? options.prompt : options.prompt + "\n";
    child.stdin.write(promptToSend, "utf8", (err) => {
      if (err) {
        child.kill("SIGKILL");
        reject(err);
      } else {
        child.stdin.end();
      }
    });
  });
}
