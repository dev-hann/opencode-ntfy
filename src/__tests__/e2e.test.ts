import { describe, test, expect } from "bun:test"
import { sendNtfy } from "../ntfy"

const E2E_SERVER = process.env.NTFY_TEST_SERVER ?? "https://ntfy.sh"
const E2E_TOPIC = `test-opencode-ntfy-${Date.now()}`

const SKIP_E2E = !!process.env.SKIP_E2E

describe.skipIf(SKIP_E2E)("E2E: sendNtfy → ntfy server", () => {
  test("단일 메시지 전송 후 조회로 검증", async () => {
    const title = "OpenCode (my-project)"
    const message = "Session completed: Fix auth bug\nDuration: 3m 42s\n+45 -12 across 8 files"

    const sent = await sendNtfy({
      server: E2E_SERVER,
      topic: E2E_TOPIC,
      title,
      message,
      priority: "default",
      tags: ["white_check_mark"],
    })

    expect(sent).toBe(true)

    const res = await fetch(`${E2E_SERVER}/${E2E_TOPIC}/json?poll=1`)
    const text = await res.text()
    const lines = text.trim().split("\n")
    const messages = lines.map((l) => JSON.parse(l))
    const last = messages[messages.length - 1]

    expect(last.title).toBe(title)
    expect(last.message).toBe(message)
  })

  test("멀티라인 메시지가 ntfy에서 줄바꿈 유지", async () => {
    const message = "Line 1\nLine 2\nLine 3"

    await sendNtfy({
      server: E2E_SERVER,
      topic: E2E_TOPIC,
      title: "Multi-line test",
      message,
      priority: "default",
    })

    const res = await fetch(`${E2E_SERVER}/${E2E_TOPIC}/json?poll=1`)
    const text = await res.text()
    const lines = text.trim().split("\n")
    const messages = lines.map((l) => JSON.parse(l))
    const last = messages[messages.length - 1]

    expect(last.message).toContain("\n")
  })

  test("에러 메시지에 특수문자 있어도 정상 전송", async () => {
    const sent = await sendNtfy({
      server: E2E_SERVER,
      topic: E2E_TOPIC,
      title: "Error test",
      message: 'Session error: Fix "auth" bug\nAPIError: rate-limit (429)',
      priority: "high",
      tags: ["x"],
    })

    expect(sent).toBe(true)
  })
})
