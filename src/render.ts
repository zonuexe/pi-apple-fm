import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import type { FmChatResult } from "./types.js";

interface FmCallView {
  prompt?: string;
  model?: string;
  continue?: boolean;
  resume?: string;
  tools?: readonly string[];
  useCase?: string;
  schema?: unknown;
  images?: readonly unknown[];
}

/** Structural slice of Pi's tool render context. `ToolRenderContext` is not exported. */
interface FmRenderContext {
  lastComponent: object | undefined;
  durationMs: number | undefined;
}

function textComponent(last: FmRenderContext["lastComponent"]): Text {
  return last instanceof Text ? last : new Text("", 0, 0);
}

function firstText(content: readonly (TextContent | ImageContent)[]): string | undefined {
  for (const block of content) {
    if (block.type === "text") {
      return block.text;
    }
  }
  return undefined;
}

/**
 * Custom renderer for the tool call header in Pi TUI.
 */
export function renderFmCall(
  args: FmCallView,
  theme: Theme,
  context: Pick<FmRenderContext, "lastComponent">,
  command = "chat",
): Text {
  const text = textComponent(context.lastComponent);

  let header = theme.fg("toolTitle", theme.bold(` Apple FM [${command}] `));

  const badges: string[] = [];

  if (args.model && args.model !== "system") {
    badges.push(`model:${args.model}`);
  }

  if (args.continue) {
    badges.push("--continue");
  } else if (args.resume) {
    badges.push(`--resume ${args.resume}`);
  }

  if (args.tools && args.tools.length > 0) {
    badges.push(`tools:[${args.tools.join(",")}]`);
  }

  if (args.useCase) {
    badges.push(`use-case:${args.useCase}`);
  }

  if (args.schema !== undefined) {
    badges.push("schema");
  }

  if (args.images && args.images.length > 0) {
    badges.push(`images:${args.images.length}`);
  }

  if (badges.length > 0) {
    header += theme.fg("accent", `(${badges.join(" ")}) `);
  }

  if (args.prompt) {
    const preview = args.prompt.replace(/\s+/g, " ").trim();
    const shortPrompt = preview.length > 60 ? preview.slice(0, 57) + "..." : preview;
    header += theme.fg("dim", `"${shortPrompt}"`);
  }

  text.setText(header);
  return text;
}

/**
 * Custom renderer for the tool call result in Pi TUI.
 */
export function renderFmResult(
  result: AgentToolResult<FmChatResult | { success: boolean; text: string; durationMs: number; sessionName?: string }>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: FmRenderContext,
): Text {
  const text = textComponent(context.lastComponent);

  if (options.isPartial) {
    const rawContent = firstText(result.content) ?? "";
    const preview = rawContent.slice(-100);
    text.setText(theme.fg("warning", "Generating response...") + (preview ? "\n" + theme.fg("dim", preview) : ""));
    return text;
  }

  const details = result.details;
  if (result.isError || !details.success) {
    const errorText = details.text || firstText(result.content) || "Unknown error";
    text.setText(theme.fg("error", `Apple FM Error: ${errorText}`));
    return text;
  }

  let output = details.text;

  const meta: string[] = [];
  if (details.sessionName) {
    meta.push(`session: ${details.sessionName}`);
  }
  const duration = context.durationMs ?? details.durationMs;
  if (duration) {
    meta.push(`${(duration / 1000).toFixed(1)}s`);
  }

  if (meta.length > 0) {
    output += "\n" + theme.fg("dim", `[Apple FM | ${meta.join(" | ")}]`);
  }

  text.setText(output);
  return text;
}
