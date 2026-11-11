/**
 * Types for Apple Foundation Models CLI (fm chat) Pi Extension.
 *
 * @see https://developer.apple.com/foundation-models-framework/
 */

import { Type, type Static } from "typebox";

/** Built-in `fm chat --tool` names. */
export const FM_BUILTIN_TOOLS = ["barcode", "ocr"] as const;

export type FmBuiltinTool = (typeof FM_BUILTIN_TOOLS)[number];

export function isFmBuiltinTool(value: string): value is FmBuiltinTool {
  return (FM_BUILTIN_TOOLS as readonly string[]).includes(value);
}

/** Roles written by `fm` into ~/.fm/sessions. Other strings may appear. */
export const FM_TRANSCRIPT_ROLES = ["instructions", "user", "response"] as const;

export type FmTranscriptRole = (typeof FM_TRANSCRIPT_ROLES)[number];

export function isFmTranscriptRole(role: string): role is FmTranscriptRole {
  return (FM_TRANSCRIPT_ROLES as readonly string[]).includes(role);
}

const fmBuiltinToolSchema = Type.Union([Type.Literal("barcode"), Type.Literal("ocr")]);

/**
 * TypeBox schema corresponding to `fm chat --help` arguments.
 * `FmChatParameters` is derived from this schema so the tool contract cannot drift.
 */
export const fmChatParametersSchema = Type.Object({
  prompt: Type.String({
    description: "The prompt or message to send to Apple Foundation Models",
  }),
  instructions: Type.Optional(
    Type.String({
      description: "Instructions for the model (-i, --instructions <t>)",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Model to use, e.g. 'system' (-m, --model <model>)",
      default: "system",
    }),
  ),
  resume: Type.Optional(
    Type.String({
      description: "Resume a saved chat session by name (-r, --resume <name>)",
    }),
  ),
  continue: Type.Optional(
    Type.Boolean({
      description: "Continue the most recent chat session (--continue)",
    }),
  ),
  tools: Type.Optional(
    Type.Array(fmBuiltinToolSchema, {
      description: "Built-in tools to enable, e.g. ['barcode', 'ocr'] (--tool <name>)",
    }),
  ),
  setDefaultModel: Type.Optional(
    Type.String({
      description: "Persist default model (--set-default-model <m>)",
    }),
  ),
});

export type FmChatParameters = Static<typeof fmChatParametersSchema>;

/**
 * Options for executing `fm chat`.
 * `tools` stays open so slash-command input can forward flags the schema does not list.
 */
export type FmChatOptions = Omit<FmChatParameters, "tools"> & {
  tools?: readonly string[];
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
};

/** On-device system model context window reported by `fm chat`. */
export const FM_CONTEXT_WINDOW = 4096;

export const FM_USE_CASES = ["general", "content-tagging"] as const;

export type FmUseCase = (typeof FM_USE_CASES)[number];

export function isFmUseCase(value: string): value is FmUseCase {
  return (FM_USE_CASES as readonly string[]).includes(value);
}

const fmUseCaseSchema = Type.Union([Type.Literal("general"), Type.Literal("content-tagging")], {
  description: "Model use case (--use-case): general or content-tagging",
});

const fmImageSchema = Type.Object({
  path: Type.String({
    description: "Image file path passed to fm respond --image",
  }),
  label: Type.Optional(
    Type.String({
      description: "Label for this image, paired by order with --label",
    }),
  ),
});

/**
 * One-shot `fm respond` arguments.
 * `schema` is a JSON Schema object or a JSON string. It is rewritten to the
 * Apple schema shape (`title`, `x-order`) before the CLI sees it.
 */
export const fmRespondParametersSchema = Type.Object({
  prompt: Type.String({
    description: "The prompt to answer in one shot. Does not create a ~/.fm/sessions entry.",
  }),
  instructions: Type.Optional(
    Type.String({
      description: "Instructions for the model (-i, --instructions <t>)",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Model to use, e.g. 'system' (-m, --model <model>)",
      default: "system",
    }),
  ),
  schema: Type.Optional(
    Type.Unknown({
      description:
        "JSON Schema object for structured output (fm respond --schema). Nested objects are accepted; title and x-order are added if missing.",
    }),
  ),
  images: Type.Optional(
    Type.Array(fmImageSchema, {
      description: "Images to include. Required for OCR and barcode; fm chat cannot attach images.",
    }),
  ),
  texts: Type.Optional(
    Type.Array(Type.String(), {
      description: "Additional text segments (--text), repeatable",
    }),
  ),
  tools: Type.Optional(
    Type.Array(fmBuiltinToolSchema, {
      description: "Built-in tools to enable with images, e.g. ['ocr'] or ['barcode']",
    }),
  ),
  useCase: Type.Optional(fmUseCaseSchema),
});

export type FmRespondParameters = Static<typeof fmRespondParametersSchema>;

export interface FmImageInput {
  path: string;
  label?: string;
}

export type FmRespondOptions = Omit<FmRespondParameters, "tools" | "images" | "texts" | "schema"> & {
  tools?: readonly string[];
  images?: readonly FmImageInput[];
  texts?: readonly string[];
  schema?: unknown;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
};

export const fmCountTokensParametersSchema = Type.Object({
  prompt: Type.Optional(
    Type.String({
      description: "Prompt text to count",
    }),
  ),
  instructions: Type.Optional(
    Type.String({
      description: "Instructions included in the count (-i)",
    }),
  ),
  images: Type.Optional(
    Type.Array(fmImageSchema, {
      description: "Images included in the count (--image)",
    }),
  ),
  texts: Type.Optional(
    Type.Array(Type.String(), {
      description: "Additional text segments included in the count (--text)",
    }),
  ),
  transcript: Type.Optional(
    Type.String({
      description: "Path to a saved transcript JSON (--transcript)",
    }),
  ),
});

export type FmCountTokensParameters = Static<typeof fmCountTokensParametersSchema>;

export type FmTokenCountOptions = FmCountTokensParameters & {
  signal?: AbortSignal;
};

export type FmLicenseStatus = {
  agreed: boolean;
  summary: string;
};

export type FmRespondResult =
  | (FmChatResultBase & { success: true; json?: unknown })
  | (FmChatResultBase & { success: false });

export type FmTokenCountResult = {
  success: boolean;
  count: number;
  text: string;
  rawStdout: string;
  rawStderr: string;
  durationMs: number;
};

interface FmChatResultBase {
  /** Cleaned response text generated by the model (ANSI stripped). */
  text: string;
  /** Raw standard output from the `fm` process. */
  rawStdout: string;
  /** Raw standard error from the `fm` process. */
  rawStderr: string;
  /** Identified session name (from stdout/stderr or the requested resume name). */
  sessionName?: string;
  /** Process execution time in milliseconds. */
  durationMs: number;
}

/** Result returned from executing `fm chat`. */
export type FmChatResult =
  | (FmChatResultBase & { success: true })
  | (FmChatResultBase & { success: false });

/** Information about a saved session in ~/.fm/sessions/ */
export interface FmSessionInfo {
  /** Session identifier / file name without .json extension. */
  name: string;
  /** Absolute file path to the session JSON. */
  path: string;
  /** Last modified timestamp. */
  mtime: Date;
  /** Total number of dialogue entries in this session. */
  messageCount: number;
  /** Excerpt or preview of the last user or assistant message. */
  preview?: string;
  /** Underlying model name (e.g. "system"). */
  modelName?: string;
}

/** Foundation Models availability status on the current machine. */
export type FmAvailability =
  | {
      available: true;
      models: readonly string[];
    }
  | {
      available: false;
      reason: string;
      models: readonly [];
    };

/** Result of ensuring a background `fm serve` process. */
export type FmServeStatus =
  | { running: true; spawned: boolean }
  | { running: false; spawned: boolean; error: string };

const fmTranscriptContentSchema = Type.Object(
  {
    type: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    id: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const fmTranscriptEntrySchema = Type.Object(
  {
    role: Type.String(),
    id: Type.Optional(Type.String()),
    contents: Type.Optional(Type.Array(fmTranscriptContentSchema)),
  },
  { additionalProperties: true },
);

/**
 * Raw JSON format of ~/.fm/sessions/<name>.json.
 * Extra fields written by `fm` are allowed.
 */
export const fmTranscriptFileSchema = Type.Object(
  {
    transcript: Type.Optional(
      Type.Object(
        {
          type: Type.Optional(Type.String()),
          version: Type.Optional(Type.String()),
          transcript: Type.Optional(
            Type.Object(
              {
                entries: Type.Optional(Type.Array(fmTranscriptEntrySchema)),
              },
              { additionalProperties: true },
            ),
          ),
        },
        { additionalProperties: true },
      ),
    ),
    modelName: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export type FmTranscriptFile = Static<typeof fmTranscriptFileSchema>;
export type FmTranscriptEntry = Static<typeof fmTranscriptEntrySchema>;
