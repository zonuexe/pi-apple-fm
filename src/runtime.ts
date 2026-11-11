import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_FM_SERVE_PORT = 1976;
export const FM_PORT_ENV = "PI_APPLE_FM_PORT";
export const FM_BIN_ENV = "PI_APPLE_FM_BIN";
export const DEFAULT_FM_BIN = "/usr/bin/fm";

export const SETTINGS_FILE = join(homedir(), ".pi", "agent", "zonuexe-pi-apple-fm.json");
export const LOG_FILE = join(homedir(), ".pi", "agent", "logs", "zonuexe-pi-apple-fm.log");
export const STATUS_KEY = "zonuexe-fm";

const SETTINGS_VERSION = 1;

interface SettingsFile {
  version: typeof SETTINGS_VERSION;
  startServerBeforeRequest: boolean;
}

export function resolveFmPort(raw: string | undefined = process.env[FM_PORT_ENV]): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_FM_SERVE_PORT;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${FM_PORT_ENV} must be an integer from 1 to 65535, got: ${raw}`);
  }
  const port = Number(raw);
  if (port < 1 || port > 65535) {
    throw new Error(`${FM_PORT_ENV} must be an integer from 1 to 65535, got: ${raw}`);
  }
  return port;
}

export function resolveFmBin(raw: string | undefined = process.env[FM_BIN_ENV]): string {
  const bin = raw?.trim();
  return bin ? bin : DEFAULT_FM_BIN;
}

export async function loadStartServerBeforeRequest(): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await readFile(SETTINGS_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return true;
    const flag = (parsed as { startServerBeforeRequest?: unknown }).startServerBeforeRequest;
    return typeof flag === "boolean" ? flag : true;
  } catch {
    return true;
  }
}

export async function saveStartServerBeforeRequest(enabled: boolean): Promise<void> {
  const settings: SettingsFile = { version: SETTINGS_VERSION, startServerBeforeRequest: enabled };
  await mkdir(dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(settings)}\n`, "utf8");
}

export async function appendFmLog(event: string, fields: Record<string, string | number | boolean>): Promise<void> {
  const line = `${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`;
  try {
    await mkdir(dirname(LOG_FILE), { recursive: true });
    await appendFile(LOG_FILE, line, "utf8");
  } catch {
    // A log failure must not block the model request.
  }
}
