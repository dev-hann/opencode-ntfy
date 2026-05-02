import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

export type EventType =
  | "complete"
  | "error"
  | "permission"
  | "question"
  | "subagent_complete"

export interface NtfyConfig {
  topic: string
  server: string
  token: string | null
  minDuration: number
  events: Partial<Record<EventType, boolean>>
  priority: Partial<Record<EventType, string>>
  tags: Partial<Record<EventType, string[]>>
  messages: Partial<Record<EventType, string>>
}

const DEFAULT_CONFIG: NtfyConfig = {
  topic: "",
  server: "https://ntfy.sh",
  token: null,
  minDuration: 0,
  events: {
    complete: true,
    error: true,
    permission: true,
    question: true,
    subagent_complete: false,
  },
  priority: {
    complete: "default",
    error: "high",
    permission: "default",
    question: "default",
    subagent_complete: "low",
  },
  tags: {
    complete: ["white_check_mark"],
    error: ["x"],
    permission: ["warning"],
    question: ["question"],
    subagent_complete: ["white_check_mark"],
  },
  messages: {
    complete: "Session completed: {sessionTitle}",
    error: "Session error: {sessionTitle}",
    permission: "Permission required: {sessionTitle}",
    question: "Session has a question: {sessionTitle}",
    subagent_complete: "Subagent completed: {sessionTitle}",
  },
}

function getConfigPath(): string {
  return join(homedir(), ".config", "opencode", "opencode-ntfy.json")
}

export function loadConfig(): NtfyConfig {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG }
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const userConfig = JSON.parse(content) as Partial<NtfyConfig>

    return {
      topic: userConfig.topic ?? DEFAULT_CONFIG.topic,
      server: userConfig.server ?? DEFAULT_CONFIG.server,
      token: userConfig.token ?? DEFAULT_CONFIG.token,
      minDuration: userConfig.minDuration ?? DEFAULT_CONFIG.minDuration,
      events: { ...DEFAULT_CONFIG.events, ...userConfig.events },
      priority: { ...DEFAULT_CONFIG.priority, ...userConfig.priority },
      tags: { ...DEFAULT_CONFIG.tags, ...userConfig.tags },
      messages: { ...DEFAULT_CONFIG.messages, ...userConfig.messages },
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function isEventEnabled(config: NtfyConfig, eventType: EventType): boolean {
  return config.events[eventType] ?? false
}

export function getPriority(config: NtfyConfig, eventType: EventType): string {
  return config.priority[eventType] ?? "default"
}

export function getTags(config: NtfyConfig, eventType: EventType): string[] {
  return config.tags[eventType] ?? []
}

export function getMessage(
  config: NtfyConfig,
  eventType: EventType,
  vars?: { sessionTitle?: string | null; projectName?: string | null }
): string {
  const template = config.messages[eventType] ?? ""
  return template
    .replace(/\{sessionTitle\}/g, vars?.sessionTitle ?? "")
    .replace(/\{projectName\}/g, vars?.projectName ?? "")
    .replace(/\s*[:\-|]\s*$/u, "")
    .trim()
}
