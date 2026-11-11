/**
 * Fit a Pi chat-completions body to on-device `fm serve`.
 *
 * The server accepts string message content and string enums. Object unions are
 * dropped with the tool that contains them. A 4096-token model cannot carry
 * Pi's full transcript, so the system model sends the latest user turn and bash.
 */

type JsonRecord = Record<string, unknown>;

export interface FitServePayloadOptions {
  /** When true, drop history before the latest user message and non-bash tools. */
  fitContextWindow?: boolean;
}

function record(value: unknown): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

function stringConsts(branches: readonly JsonRecord[]): string[] | undefined {
  const values: string[] = [];
  for (const branch of branches) {
    if (branch.type !== "string" || typeof branch.const !== "string") return undefined;
    values.push(branch.const);
  }
  return values.length > 0 ? values : undefined;
}

/**
 * Returns undefined when the schema cannot be expressed to `fm serve`.
 */
function adaptSchema(node: unknown): unknown | undefined {
  if (Array.isArray(node)) {
    const items: unknown[] = [];
    for (const item of node) {
      const adapted = adaptSchema(item);
      if (adapted === undefined) return undefined;
      items.push(adapted);
    }
    return items;
  }

  const schema = record(node);
  if (!schema) return node;

  const next: JsonRecord = {};
  for (const [key, child] of Object.entries(schema)) {
    if (key === "patternProperties") continue;
    if (key === "anyOf" || key === "oneOf") continue;
    if (key === "additionalProperties" && child === true) {
      next.additionalProperties = false;
      continue;
    }
    const adapted = adaptSchema(child);
    if (adapted === undefined) return undefined;
    next[key] = adapted;
  }

  const union = schema.anyOf ?? schema.oneOf;
  if (!Array.isArray(union)) return next;

  const branches = union.flatMap((item) => {
    const branch = record(item);
    return branch ? [branch] : [];
  });
  if (branches.length !== union.length) return undefined;

  const enums = stringConsts(branches);
  if (enums) {
    delete next.const;
    return { ...next, type: "string", enum: enums };
  }

  if (branches.some((branch) => branch.type === "object")) return undefined;

  const fallback = branches.find((branch) => branch.type !== "object");
  if (!fallback) return undefined;
  const adaptedFallback = adaptSchema(fallback);
  if (adaptedFallback === undefined || record(adaptedFallback) === undefined) return adaptedFallback;
  return { ...next, ...record(adaptedFallback) };
}

function textOf(message: JsonRecord): JsonRecord {
  if (!Array.isArray(message.content)) return message;
  const lines: string[] = [];
  for (const block of message.content) {
    const item = record(block);
    if (!item || item.type !== "text" || typeof item.text !== "string") return message;
    lines.push(item.text);
  }
  return { ...message, content: lines.join("\n") };
}

function latestTurn(messages: readonly unknown[]): unknown[] {
  const flattened = messages.map((message) => {
    const row = record(message);
    return row ? textOf(row) : message;
  });

  let start = 0;
  for (let index = flattened.length - 1; index >= 0; index -= 1) {
    const row = record(flattened[index]);
    if (row?.role === "user") {
      start = index;
      break;
    }
  }

  const cwdLine = flattened
    .map(record)
    .find((row) => row?.role === "system" && typeof row.content === "string")
    ?.content;
  const cwd = typeof cwdLine === "string" ? cwdLine.split("\n").find((line) => line.startsWith("Current working directory:")) : undefined;

  const turn = flattened.slice(start).filter((message) => {
    const row = record(message);
    return !row || (row.role !== "system" && row.role !== "developer");
  });

  return [
    {
      role: "system",
      content: ["Answer the current request. Prefer the bash tool. Older turns were omitted.", cwd]
        .filter((line) => typeof line === "string" && line.length > 0)
        .join("\n"),
    },
    ...turn,
  ];
}

function toolName(tool: unknown): string | undefined {
  const row = record(tool);
  const fn = row ? record(row.function) : undefined;
  return typeof fn?.name === "string" ? fn.name : undefined;
}

function adaptTool(tool: unknown): unknown | undefined {
  const row = record(tool);
  if (!row) return tool;
  const fn = record(row.function);
  if (!fn) return tool;
  const parameters = adaptSchema(fn.parameters);
  if (parameters === undefined) return undefined;
  return { ...row, function: { ...fn, parameters } };
}

export function normalizeFmServePayload(payload: unknown, options: FitServePayloadOptions = {}): unknown {
  const body = record(payload);
  if (!body) return payload;

  const fitted: JsonRecord = { ...body };
  if (Array.isArray(body.messages)) {
    const messages = body.messages.map((message) => {
      const row = record(message);
      return row ? textOf(row) : message;
    });
    fitted.messages = options.fitContextWindow ? latestTurn(messages) : messages;
  }
  if (Array.isArray(body.tools)) {
    const tools = body.tools.flatMap((tool) => {
      const adapted = adaptTool(tool);
      return adapted === undefined ? [] : [adapted];
    });
    fitted.tools = options.fitContextWindow ? tools.filter((tool) => toolName(tool) === "bash") : tools;
  }
  return fitted;
}
