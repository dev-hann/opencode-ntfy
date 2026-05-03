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

export interface MessageVars {
  sessionTitle?: string | null
  projectName?: string | null
  errorDetail?: string | null
  changeSummary?: string | null
  durationFormatted?: string | null
  permissionDetail?: string | null
  questionText?: string | null
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
    complete: "Session completed: {sessionTitle}\n{durationFormatted}\n{changeSummary}",
    error: "Session error: {sessionTitle}\n{errorDetail}",
    permission: "Permission required: {sessionTitle}\n{permissionDetail}",
    question: "Question: {sessionTitle}\n{questionText}",
    subagent_complete: "Subagent completed: {sessionTitle}\n{durationFormatted}\n{changeSummary}",
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

export function formatDuration(createdMs: number, updatedMs: number): string {
  const diffMs = Math.max(0, updatedMs - createdMs)
  if (!Number.isFinite(diffMs) || diffMs < 1000) return ""
  const totalSeconds = Math.floor(diffMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `Duration: ${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `Duration: ${minutes}m ${seconds}s`
  return `Duration: ${seconds}s`
}

export function formatChangeSummary(
  summary: { additions?: number; deletions?: number; files?: number } | null | undefined
): string {
  if (!summary) return ""
  const additions = summary.additions ?? 0
  const deletions = summary.deletions ?? 0
  const files = summary.files ?? 0
  const parts: string[] = []
  if (additions > 0) parts.push(`+${additions}`)
  if (deletions > 0) parts.push(`-${deletions}`)
  if (parts.length === 0) return ""
  return `${parts.join(" ")} across ${files} file${files !== 1 ? "s" : ""}`
}

export function formatErrorDetail(
  error: { name?: string; data?: { message?: string; statusCode?: number } } | null | undefined
): string {
  if (!error) return ""
  const name = error.name ?? ""
  const message = error.data?.message ?? ""
  const statusCode = error.data?.statusCode
  if (!name && !message) return ""
  const detail = name && message ? `${name}: ${message}` : (name || message)
  return statusCode ? `${detail} (${statusCode})` : detail
}

export function formatPermissionDetail(
  type: string | null | undefined,
  pattern: string | string[] | null | undefined,
  title: string | null | undefined
): string {
  const parts: string[] = []
  if (title) parts.push(title)
  else if (type) parts.push(`[${type}]`)
  if (pattern) {
    const patternStr = Array.isArray(pattern) ? pattern.join(", ") : pattern
    if (patternStr) parts.push(patternStr)
  }
  return parts.join(" ")
}

const PLACEHOLDER_KEYS = [
  "sessionTitle",
  "projectName",
  "errorDetail",
  "changeSummary",
  "durationFormatted",
  "permissionDetail",
  "questionText",
] as const

const PLACEHOLDER_RE = new RegExp(
  `\\{(${PLACEHOLDER_KEYS.join("|")})\\}`,
  "g"
)

export function getMessage(
  config: NtfyConfig,
  eventType: EventType,
  vars?: MessageVars
): string {
  const template = config.messages[eventType] ?? ""
  const values: Record<string, string> = {
    sessionTitle: vars?.sessionTitle ?? "",
    projectName: vars?.projectName ?? "",
    errorDetail: vars?.errorDetail ?? "",
    changeSummary: vars?.changeSummary ?? "",
    durationFormatted: vars?.durationFormatted ?? "",
    permissionDetail: vars?.permissionDetail ?? "",
    questionText: vars?.questionText ?? "",
  }
  return template
    .replace(PLACEHOLDER_RE, (_, key: string) => values[key] ?? "")
    .replace(/(?:\r?\n){2,}/g, "\n")
    .split("\n")
    .map((line: string) => line.replace(/\s*[:\-|]\s*$/u, ""))
    .join("\n")
    .trim()
}
