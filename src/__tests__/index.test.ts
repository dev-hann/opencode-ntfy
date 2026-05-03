import { describe, test, expect, mock, beforeEach } from "bun:test"

const testConfig = {
  topic: "test-topic",
  server: "https://ntfy.sh",
  token: null,
  minDuration: 0,
  events: { complete: true, error: true, permission: true, question: true, subagent_complete: false },
  priority: { complete: "default", error: "high", permission: "default", question: "default" },
  tags: { complete: ["white_check_mark"], error: ["x"] },
  messages: {
    complete: "Session completed: {sessionTitle}\n{durationFormatted}\n{changeSummary}",
    error: "Session error: {sessionTitle}\n{errorDetail}",
    permission: "Permission required: {sessionTitle}\n{permissionDetail}",
    question: "Question: {sessionTitle}\n{questionText}",
  },
}

const sendNtfyMock = mock(async () => true)

mock.module("../ntfy", () => ({
  sendNtfy: sendNtfyMock,
}))

mock.module("../config", () => ({
  loadConfig: () => testConfig,
  isEventEnabled: (config: any, eventType: string) => config.events[eventType] ?? false,
  getPriority: (config: any, eventType: string) => config.priority[eventType] ?? "default",
  getTags: (config: any, eventType: string) => config.tags[eventType] ?? [],
  getMessage: (config: any, eventType: string, vars?: any) => {
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
      .replace(/\{(sessionTitle|projectName|errorDetail|changeSummary|durationFormatted|permissionDetail|questionText)\}/g,
        (_: any, key: string) => values[key] ?? "")
      .replace(/(?:\r?\n){2,}/g, "\n")
      .split("\n")
      .map((line: string) => line.replace(/\s*[:\-|]\s*$/u, ""))
      .join("\n")
      .trim()
  },
  formatDuration: (createdMs: number, updatedMs: number) => {
    const diffMs = Math.max(0, updatedMs - createdMs)
    if (!Number.isFinite(diffMs) || diffMs < 1000) return ""
    const totalSeconds = Math.floor(diffMs / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `Duration: ${hours}h ${minutes}m ${seconds}s`
    if (minutes > 0) return `Duration: ${minutes}m ${seconds}s`
    return `Duration: ${seconds}s`
  },
  formatChangeSummary: (summary: any) => {
    if (!summary) return ""
    const additions = summary.additions ?? 0
    const deletions = summary.deletions ?? 0
    const files = summary.files ?? 0
    const parts: string[] = []
    if (additions > 0) parts.push(`+${additions}`)
    if (deletions > 0) parts.push(`-${deletions}`)
    if (parts.length === 0) return ""
    return `${parts.join(" ")} across ${files} file${files !== 1 ? "s" : ""}`
  },
  formatErrorDetail: (error: any) => {
    if (!error) return ""
    const name = error.name ?? ""
    const message = error.data?.message ?? ""
    const statusCode = error.data?.statusCode
    if (!name && !message) return ""
    const detail = name && message ? `${name}: ${message}` : (name || message)
    return statusCode ? `${detail} (${statusCode})` : detail
  },
  formatPermissionDetail: (type: any, pattern: any, title: any) => {
    const parts: string[] = []
    if (title) parts.push(title)
    else if (type) parts.push(`[${type}]`)
    if (pattern) {
      const patternStr = Array.isArray(pattern) ? pattern.join(", ") : pattern
      if (patternStr) parts.push(patternStr)
    }
    return parts.join(" ")
  },
}))

const { NtfyPlugin } = await import("../index")

describe("NtfyPlugin", () => {
  let hooks: any
  let clientMock: any

  beforeEach(async () => {
    sendNtfyMock.mockClear()
    clientMock = {
      session: {
        get: mock(async () => ({
          data: {
            id: "sess-1",
            title: "Fix auth bug",
            time: { created: 1000000, updated: 1222000 },
            summary: { additions: 10, deletions: 3, files: 4 },
          },
        })),
      },
    }
    hooks = await NtfyPlugin({ client: clientMock, directory: "/home/user/my-project" } as any)
  })

  test("session.idle → complete 알림 전송", async () => {
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "sess-1" } } })
    await new Promise((r) => setTimeout(r, 500))

    expect(sendNtfyMock).toHaveBeenCalled()
    const call = sendNtfyMock.mock.calls[0][0]
    expect(call.topic).toBe("test-topic")
    expect(call.message).toContain("Fix auth bug")
    expect(call.message).toContain("Duration: 3m 42s")
    expect(call.message).toContain("+10 -3 across 4 files")
  })

  test("session.error (non-cancelled) → error 알림 전송", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "sess-1",
          error: { name: "APIError", data: { message: "Rate limit", statusCode: 429 } },
        },
      },
    })

    expect(sendNtfyMock).toHaveBeenCalled()
    const call = sendNtfyMock.mock.calls[0][0]
    expect(call.message).toContain("APIError: Rate limit (429)")
    expect(call.priority).toBe("high")
  })

  test("session.error (MessageAbortedError) → 알림 전송 안 함", async () => {
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: "sess-1",
          error: { name: "MessageAbortedError" },
        },
      },
    })

    expect(sendNtfyMock).not.toHaveBeenCalled()
  })

  test("permission.ask → 알림 전송", async () => {
    await hooks["permission.ask"]({
      id: "perm-1",
      type: "bash",
      title: "Run tests",
      pattern: "npm test",
    })

    expect(sendNtfyMock).toHaveBeenCalledTimes(1)
    const call = sendNtfyMock.mock.calls[0][0]
    expect(call.message).toContain("Run tests")
    expect(call.message).toContain("npm test")
  })

  test("permission.asked (이미 hook에서 전송) → 중복 알림 안 함", async () => {
    await hooks["permission.ask"]({
      id: "perm-1",
      type: "bash",
      title: "Run tests",
      pattern: "npm test",
    })

    await hooks.event({
      event: {
        type: "permission.asked",
        properties: { id: "perm-1", permission: "bash", patterns: ["npm test"] },
      },
    })

    expect(sendNtfyMock).toHaveBeenCalledTimes(1)
  })

  test("tool.execute.before (question) → 알림 전송", async () => {
    await hooks["tool.execute.before"](
      { tool: "question", sessionID: "sess-1", callID: "call-1" },
      { args: { question: "Which framework?" } }
    )

    expect(sendNtfyMock).toHaveBeenCalledTimes(1)
    const call = sendNtfyMock.mock.calls[0][0]
    expect(call.message).toContain("Which framework?")
  })

  test("tool.execute.before (bash) → 알림 전송 안 함", async () => {
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "sess-1", callID: "call-1" },
      { args: { command: "npm test" } }
    )

    expect(sendNtfyMock).not.toHaveBeenCalled()
  })
})
