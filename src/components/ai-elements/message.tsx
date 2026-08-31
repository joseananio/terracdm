"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

/** AI Elements' markdown response renderer, kept on TerraCDM's CSS surface. */
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={["agent-chat-message-response", className].filter(Boolean).join(" ")}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (previous, next) => previous.children === next.children && previous.isAnimating === next.isAnimating,
);

MessageResponse.displayName = "MessageResponse";
