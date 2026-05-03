import { $ } from "bun"

export interface NtfyOptions {
  server: string
  topic: string
  title: string
  message: string
  priority?: string
  token?: string | null
  tags?: string[]
  click?: string
}

export async function sendNtfy(options: NtfyOptions): Promise<boolean> {
  const {
    server,
    topic,
    title,
    message,
    priority = "default",
    token,
    tags = [],
    click,
  } = options

  const url = `${server.replace(/\/+$/, "")}/${topic}`

  const headers: string[] = [
    `-H "Title: ${escapeShell(title)}"`,
    `-H "Priority: ${escapeShell(priority)}"`,
  ]

  if (tags.length > 0) {
    headers.push(`-H "Tags: ${tags.map(escapeShell).join(",")}"`)
  }

  if (click) {
    headers.push(`-H "Click: ${escapeShell(click)}"`)
  }

  if (token) {
    headers.push(`-H "Authorization: Bearer ${escapeShell(token)}"`)
  }

  const headerStr = headers.join(" ")

  try {
    await $`curl -s ${headerStr} -d ${message} ${url}`.quiet()
    return true
  } catch {
    try {
      await $`curl -s -H ${`Title: ${title}`} -H ${`Priority: ${priority}`} -d ${message} ${url}`.quiet()
      return true
    } catch {
      return false
    }
  }
}

function escapeShell(str: string): string {
  return str.replace(/["\\$`!]/g, "").replace(/[\r\n]/g, " ")
}
