import type { Plugin } from "@opencode-ai/plugin"
import { basename } from "path"
import { sendNtfy } from "./ntfy"
import {
  loadConfig,
  isEventEnabled,
  getPriority,
  getTags,
  getMessage,
  formatDuration,
  formatChangeSummary,
  formatErrorDetail,
  formatPermissionDetail,
  type EventType,
  type NtfyConfig,
  type MessageVars,
} from "./config"

const IDLE_COMPLETE_DELAY_MS = 350

const pendingIdleTimers = new Map<string, ReturnType<typeof setTimeout>>()
const sessionIdleSequence = new Map<string, number>()
const sessionErrorSuppressionAt = new Map<string, number>()
const subagentSessionIds = new Set<string>()
const recentPermissionIds = new Set<string>()

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : null
}

function getNestedRecord(
  root: unknown,
  ...path: string[]
): UnknownRecord | null {
  let current: unknown = root
  for (const key of path) {
    const record = asRecord(current)
    if (!record || !(key in record)) return null
    current = record[key]
  }
  return asRecord(current)
}

function getStringField(
  record: UnknownRecord | null,
  key: string
): string | null {
  if (!record) return null
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function getSessionIDFromEvent(event: unknown): string | null {
  const properties = getNestedRecord(event, "properties")
  return getStringField(properties, "sessionID")
}

interface SessionLifecycleInfo {
  id: string | null
  title: string | null
  parentID: string | null
}

function getSessionLifecycleInfo(event: unknown): SessionLifecycleInfo {
  const info = getNestedRecord(event, "properties", "info")
  return {
    id: getStringField(info, "id"),
    title: getStringField(info, "title"),
    parentID: getStringField(info, "parentID"),
  }
}

interface SessionInfo {
  isChild: boolean
  title: string | null
  summary?: { additions?: number; deletions?: number; files?: number }
  time?: { created: number; updated: number }
}

async function getSessionInfo(
  client: any,
  sessionID: string
): Promise<SessionInfo> {
  try {
    const response = await client.session.get({ path: { id: sessionID } })
    const data = response.data
    return {
      isChild: !!data?.parentID,
      title: typeof data?.title === "string" ? data.title : null,
      summary: data?.summary,
      time: data?.time,
    }
  } catch {
    return { isChild: false, title: null }
  }
}

function clearPendingIdleTimer(sessionID: string): void {
  const timer = pendingIdleTimers.get(sessionID)
  if (!timer) return
  clearTimeout(timer)
  pendingIdleTimers.delete(sessionID)
}

function bumpSessionIdleSequence(sessionID: string): number {
  const next = (sessionIdleSequence.get(sessionID) ?? 0) + 1
  sessionIdleSequence.set(sessionID, next)
  return next
}

function hasCurrentSessionIdleSequence(
  sessionID: string,
  sequence: number
): boolean {
  return sessionIdleSequence.get(sessionID) === sequence
}

function markSessionError(sessionID: string | null): void {
  if (!sessionID) return
  sessionErrorSuppressionAt.set(sessionID, Date.now())
  bumpSessionIdleSequence(sessionID)
  clearPendingIdleTimer(sessionID)
}

function shouldSuppressSessionIdle(
  sessionID: string,
  consume: boolean = true
): boolean {
  const errorAt = sessionErrorSuppressionAt.get(sessionID)
  if (errorAt === undefined) return false
  if (consume) sessionErrorSuppressionAt.delete(sessionID)
  return true
}

let configWarningShown = false

async function notifyNtfy(
  config: NtfyConfig,
  eventType: EventType,
  projectName: string | null,
  vars?: MessageVars
): Promise<void> {
  if (!config.topic) {
    if (!configWarningShown) {
      configWarningShown = true
      console.log(
        "[opencode-ntfy] No topic configured. Create ~/.config/opencode/opencode-ntfy.json with { \"topic\": \"your-topic\" }"
      )
    }
    return
  }

  if (!isEventEnabled(config, eventType)) return

  const title = projectName ? `OpenCode (${projectName})` : "OpenCode"
  const message = getMessage(config, eventType, { ...vars, projectName })
  const priority = getPriority(config, eventType)
  const tags = getTags(config, eventType)

  if (!message) return

  await sendNtfy({
    server: config.server,
    topic: config.topic,
    title,
    message,
    priority,
    token: config.token,
    tags,
  })
}

async function processSessionIdle(
  client: any,
  config: NtfyConfig,
  projectName: string | null,
  sessionID: string,
  sequence: number
): Promise<void> {
  if (!hasCurrentSessionIdleSequence(sessionID, sequence)) return
  if (shouldSuppressSessionIdle(sessionID)) return

  const isSubagent = subagentSessionIds.has(sessionID)
  const eventType: EventType = isSubagent ? "subagent_complete" : "complete"

  if (!isEventEnabled(config, eventType)) return

  const sessionInfo = await getSessionInfo(client, sessionID)

  if (!hasCurrentSessionIdleSequence(sessionID, sequence)) return
  if (shouldSuppressSessionIdle(sessionID)) return

  const resolvedEventType: EventType = isSubagent || sessionInfo.isChild
    ? "subagent_complete"
    : "complete"

  const durationFormatted = sessionInfo.time
    ? formatDuration(sessionInfo.time.created, sessionInfo.time.updated)
    : null
  const changeSummary = formatChangeSummary(sessionInfo.summary ?? null)

  await notifyNtfy(config, resolvedEventType, projectName, {
    sessionTitle: sessionInfo.title,
    durationFormatted,
    changeSummary,
  })
}

function scheduleSessionIdle(
  client: any,
  config: NtfyConfig,
  projectName: string | null,
  sessionID: string
): void {
  clearPendingIdleTimer(sessionID)
  const sequence = bumpSessionIdleSequence(sessionID)

  const timer = setTimeout(() => {
    pendingIdleTimers.delete(sessionID)
    void processSessionIdle(
      client,
      config,
      projectName,
      sessionID,
      sequence
    ).catch(() => undefined)
  }, IDLE_COMPLETE_DELAY_MS)

  pendingIdleTimers.set(sessionID, timer)
}

setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000
  for (const [sessionID] of sessionIdleSequence) {
    if (!pendingIdleTimers.has(sessionID)) {
      sessionIdleSequence.delete(sessionID)
      subagentSessionIds.delete(sessionID)
    }
  }
  for (const [sessionID, timestamp] of sessionErrorSuppressionAt) {
    if (timestamp < cutoff) sessionErrorSuppressionAt.delete(sessionID)
  }
}, 5 * 60 * 1000)

export const NtfyPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig()
  const projectName = directory ? basename(directory) : null

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const info = getSessionLifecycleInfo(event)
        if (info.parentID && info.id) {
          subagentSessionIds.add(info.id)
        }
      }

      if (event.type === "session.updated") {
        const info = getSessionLifecycleInfo(event)
        if (info.parentID && info.id) {
          subagentSessionIds.add(info.id)
        }
      }

      if (event.type === "session.deleted") {
        const info = getSessionLifecycleInfo(event)
        if (info.id) subagentSessionIds.delete(info.id)
      }

      if ((event as any).type === "permission.asked") {
        const id = (event as any).properties?.id
        if (id && recentPermissionIds.has(id)) {
          recentPermissionIds.delete(id)
        } else {
          const props = (event as any).properties
          await notifyNtfy(config, "permission", projectName, {
            permissionDetail: formatPermissionDetail(
              props?.permission ?? null,
              props?.patterns ?? null,
              props?.metadata?.title ?? null
            ),
          })
        }
      }

      if (event.type === "session.idle") {
        const sessionID = getSessionIDFromEvent(event)
        if (sessionID) {
          scheduleSessionIdle(client, config, projectName, sessionID)
        } else {
          await notifyNtfy(config, "complete", projectName)
        }
      }

      if (event.type === "session.error") {
        const sessionID = getSessionIDFromEvent(event)
        markSessionError(sessionID)
        const error = (event as any).properties?.error
        const isCancelled = error?.name === "MessageAbortedError"
        if (!isCancelled) {
          let sessionTitle: string | null = null
          if (sessionID) {
            const info = await getSessionInfo(client, sessionID)
            sessionTitle = info.title
          }
          await notifyNtfy(config, "error", projectName, {
            sessionTitle,
            errorDetail: formatErrorDetail(error ?? null),
          })
        }
      }
    },
    "permission.ask": async (input: any) => {
      const id = input?.id
      if (id) recentPermissionIds.add(id)
      await notifyNtfy(config, "permission", projectName, {
        permissionDetail: formatPermissionDetail(input?.type, input?.pattern, input?.title),
      })
    },
    "tool.execute.before": async (input: any, output: any) => {
      if (input.tool === "question") {
        const questionText = output?.args?.question ?? output?.args?.message ?? null
        await notifyNtfy(config, "question", projectName, {
          questionText,
        })
      }
    },
  }
}

export default NtfyPlugin
