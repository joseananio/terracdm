"use client";

import type { ComponentProps } from "react";
import { memo, useEffect, useMemo, useState } from "react";
import { Streamdown, type PluginConfig } from "streamdown";

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

type PluginName = "cjk" | "code" | "math" | "mermaid";

const cjkPattern = /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u;
const mathPattern = /\$\$|\\\[|\\\(/u;
const fencePattern = /(?:^|\n) {0,3}(?:```+|~~~+)\s*([^\s`~]*)/gu;
const pluginLoaders: Record<PluginName, () => Promise<unknown>> = {
  cjk: () => import("@streamdown/cjk").then((module) => module.cjk),
  code: () => import("@streamdown/code").then((module) => module.code),
  math: () => import("@streamdown/math").then((module) => module.math),
  mermaid: () => import("@streamdown/mermaid").then((module) => module.mermaid),
};
const pluginPromises = new Map<PluginName, Promise<unknown>>();

function requestedPlugins(content: unknown) {
  const text = typeof content === "string" ? content : String(content ?? "");
  const names = new Set<PluginName>();
  if (cjkPattern.test(text)) names.add("cjk");
  if (mathPattern.test(text)) names.add("math");
  for (const match of text.matchAll(fencePattern)) {
    if (match[1]?.toLowerCase() === "mermaid") names.add("mermaid");
    else names.add("code");
  }
  return [...names].sort();
}

function loadPlugin(name: PluginName) {
  const existing = pluginPromises.get(name);
  if (existing) return existing;
  const promise = pluginLoaders[name]().catch((cause) => {
    pluginPromises.delete(name);
    throw cause;
  });
  pluginPromises.set(name, promise);
  return promise;
}

/** AI Elements' markdown response renderer, kept on TerraCDM's CSS surface. */
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => {
    const pluginNames = useMemo(() => requestedPlugins(props.children), [props.children]);
    const pluginKey = pluginNames.join(",");
    const [loadedPlugins, setLoadedPlugins] = useState<PluginConfig>({});

    useEffect(() => {
      if (!pluginNames.length) return;
      let active = true;
      void Promise.all(pluginNames.map(async (name) => [name, await loadPlugin(name)] as const)).then((entries) => {
        if (active) setLoadedPlugins((current) => ({ ...current, ...Object.fromEntries(entries) } as PluginConfig));
      }).catch(() => undefined);
      return () => { active = false; };
    }, [pluginKey]);

    const plugins = useMemo(() => Object.fromEntries(pluginNames.flatMap((name) => loadedPlugins[name] ? [[name, loadedPlugins[name]]] : [])) as PluginConfig, [loadedPlugins, pluginKey]);

    return <Streamdown className={["agent-chat-message-response", className].filter(Boolean).join(" ")} plugins={plugins} {...props} />;
  },
  (previous, next) => previous.children === next.children && previous.isAnimating === next.isAnimating,
);

MessageResponse.displayName = "MessageResponse";
