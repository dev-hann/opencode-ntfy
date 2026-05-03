import { describe, test, expect } from "bun:test"
import {
  formatDuration,
  formatChangeSummary,
  formatErrorDetail,
  formatPermissionDetail,
  getMessage,
  type NtfyConfig,
  type EventType,
} from "../config"

function makeConfig(messages?: Partial<Record<EventType, string>>): NtfyConfig {
  return {
    topic: "test",
    server: "https://ntfy.sh",
    token: null,
    minDuration: 0,
    events: { complete: true, error: true, permission: true, question: true, subagent_complete: true },
    priority: { complete: "default" },
    tags: { complete: ["white_check_mark"] },
    messages: messages ?? {
      complete: "Session completed: {sessionTitle}\n{durationFormatted}\n{changeSummary}",
      error: "Session error: {sessionTitle}\n{errorDetail}",
      permission: "Permission required: {sessionTitle}\n{permissionDetail}",
      question: "Question: {sessionTitle}\n{questionText}",
      subagent_complete: "Subagent completed: {sessionTitle}\n{durationFormatted}\n{changeSummary}",
    },
  }
}

describe("formatDuration", () => {
  test("30초", () => {
    expect(formatDuration(0, 30000)).toBe("Duration: 30s")
  })

  test("2분 30초", () => {
    expect(formatDuration(0, 150000)).toBe("Duration: 2m 30s")
  })

  test("1시간 5분 3초", () => {
    expect(formatDuration(0, 3903000)).toBe("Duration: 1h 5m 3s")
  })

  test("0ms → 빈 문자열", () => {
    expect(formatDuration(0, 0)).toBe("")
  })

  test("500ms → 빈 문자열 (1초 미만)", () => {
    expect(formatDuration(0, 500)).toBe("")
  })

  test("NaN 입력 → 빈 문자열", () => {
    expect(formatDuration(NaN, NaN)).toBe("")
    expect(formatDuration(0, NaN)).toBe("")
    expect(formatDuration(NaN, 1000)).toBe("")
  })

  test("음수 → 빈 문자열", () => {
    expect(formatDuration(5000, 1000)).toBe("")
  })
})

describe("formatChangeSummary", () => {
  test("additions만", () => {
    expect(formatChangeSummary({ additions: 5, deletions: 0, files: 1 })).toBe("+5 across 1 file")
  })

  test("additions + deletions + files", () => {
    expect(formatChangeSummary({ additions: 45, deletions: 12, files: 8 })).toBe("+45 -12 across 8 files")
  })

  test("모두 0 → 빈 문자열", () => {
    expect(formatChangeSummary({ additions: 0, deletions: 0, files: 0 })).toBe("")
  })

  test("null → 빈 문자열", () => {
    expect(formatChangeSummary(null)).toBe("")
  })

  test("undefined → 빈 문자열", () => {
    expect(formatChangeSummary(undefined)).toBe("")
  })

  test("필드 부분 누락 → 디폴트값 사용", () => {
    expect(formatChangeSummary({ additions: 5 } as any)).toBe("+5 across 0 files")
  })

  test("-0 미표시", () => {
    expect(formatChangeSummary({ additions: 5, deletions: 0, files: 1 })).not.toContain("-0")
  })

  test("files=1 → 단수형", () => {
    expect(formatChangeSummary({ additions: 1, deletions: 0, files: 1 })).toBe("+1 across 1 file")
  })
})

describe("formatErrorDetail", () => {
  test("name + message + statusCode", () => {
    expect(formatErrorDetail({ name: "APIError", data: { message: "Rate limit exceeded", statusCode: 429 } }))
      .toBe("APIError: Rate limit exceeded (429)")
  })

  test("name만", () => {
    expect(formatErrorDetail({ name: "UnknownError" })).toBe("UnknownError")
  })

  test("name 빈값 + message만 → 선행 콜론 없음", () => {
    expect(formatErrorDetail({ name: "", data: { message: "something broke" } })).toBe("something broke")
  })

  test("null → 빈 문자열", () => {
    expect(formatErrorDetail(null)).toBe("")
  })

  test("빈 name + 빈 message → 빈 문자열", () => {
    expect(formatErrorDetail({ name: "", data: {} })).toBe("")
  })

  test("undefined → 빈 문자열", () => {
    expect(formatErrorDetail(undefined)).toBe("")
  })
})

describe("formatPermissionDetail", () => {
  test("title + pattern 문자열", () => {
    expect(formatPermissionDetail("bash", "npm test", "Run tests")).toBe("Run tests npm test")
  })

  test("title + pattern 배열", () => {
    expect(formatPermissionDetail("edit", ["src/a.ts", "src/b.ts"], "Edit files")).toBe("Edit files src/a.ts, src/b.ts")
  })

  test("type만 (title 없음)", () => {
    expect(formatPermissionDetail("bash", null, null)).toBe("[bash]")
  })

  test("모두 null → 빈 문자열", () => {
    expect(formatPermissionDetail(null, null, null)).toBe("")
  })
})

describe("getMessage", () => {
  test("기본 템플릿 - 모든 값 채움", () => {
    const config = makeConfig()
    const result = getMessage(config, "complete", {
      sessionTitle: "Fix auth bug",
      durationFormatted: "Duration: 3m 42s",
      changeSummary: "+45 -12 across 8 files",
    })
    expect(result).toBe("Session completed: Fix auth bug\nDuration: 3m 42s\n+45 -12 across 8 files")
  })

  test("빈 값 → 해당 줄 제거 (collapse)", () => {
    const config = makeConfig()
    const result = getMessage(config, "complete", {
      sessionTitle: "Fix auth bug",
    })
    expect(result).toBe("Session completed: Fix auth bug")
  })

  test("sessionTitle 없음 → trailing 콜론 제거", () => {
    const config = makeConfig()
    const result = getMessage(config, "complete", {})
    expect(result).toBe("Session completed")
  })

  test("error 이벤트에 errorDetail 포함", () => {
    const config = makeConfig()
    const result = getMessage(config, "error", {
      sessionTitle: "Fix auth bug",
      errorDetail: "APIError: Rate limit exceeded (429)",
    })
    expect(result).toBe("Session error: Fix auth bug\nAPIError: Rate limit exceeded (429)")
  })

  test("permission 이벤트에 permissionDetail 포함", () => {
    const config = makeConfig()
    const result = getMessage(config, "permission", {
      permissionDetail: "Run tests npm test",
    })
    expect(result).toBe("Permission required\nRun tests npm test")
  })

  test("question 이벤트에 questionText 포함", () => {
    const config = makeConfig()
    const result = getMessage(config, "question", {
      questionText: "Which framework should we use?",
    })
    expect(result).toBe("Question\nWhich framework should we use?")
  })

  test("커스텀 템플릿 사용", () => {
    const config = makeConfig({ complete: "Done! {sessionTitle}" })
    const result = getMessage(config, "complete", { sessionTitle: "Fix bug" })
    expect(result).toBe("Done! Fix bug")
  })

  test("알 수 없는 플레이스홀더는 그대로 유지", () => {
    const config = makeConfig({ complete: "Hello {unknown}" })
    const result = getMessage(config, "complete", {})
    expect(result).toBe("Hello {unknown}")
  })

  test("단일 패스 교체 - 이전 값이 이후 플레이스홀더 주입 안 됨", () => {
    const config = makeConfig({ complete: "{sessionTitle} {errorDetail}" })
    const result = getMessage(config, "complete", {
      sessionTitle: "{errorDetail}",
      errorDetail: "REAL",
    })
    expect(result).toBe("{errorDetail} REAL")
  })

  test("\\r\\n 처리", () => {
    const config = makeConfig({ complete: "A\r\n\r\nB" })
    const result = getMessage(config, "complete", {})
    expect(result).toBe("A\nB")
  })
})
