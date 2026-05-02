# opencode-ntfy

OpenCode plugin that sends push notifications to your phone via [ntfy](https://ntfy.sh) when sessions complete, encounter errors, need permission, or ask questions.

## Quick Start

### 1. Install ntfy on your phone

Download the [ntfy app](https://ntfy.sh) (iOS / Android) and subscribe to a topic.

### 2. Add the plugin to your OpenCode config

In your `opencode.json`:

```json
{
  "plugin": ["opencode-ntfy"]
}
```

### 3. Configure your topic

Create `~/.config/opencode/opencode-ntfy.json`:

```json
{
  "topic": "my-opencode-alerts"
}
```

Replace `my-opencode-alerts` with your own topic name. Use the same topic in the ntfy app.

### 4. Restart OpenCode

That's it. You'll now get push notifications on your phone.

## What triggers notifications

| Event | Default | Priority |
|---|---|---|
| Session completed | On | default |
| Session error | On | high |
| Permission required | On | default |
| Session has a question | On | default |
| Subagent completed | Off | low |

## Configuration

All settings go in `~/.config/opencode/opencode-ntfy.json`.

### Full config with defaults

```json
{
  "topic": "my-opencode-alerts",
  "server": "https://ntfy.sh",
  "token": null,
  "minDuration": 0,
  "events": {
    "complete": true,
    "error": true,
    "permission": true,
    "question": true,
    "subagent_complete": false
  },
  "priority": {
    "complete": "default",
    "error": "high",
    "permission": "default",
    "question": "default",
    "subagent_complete": "low"
  },
  "tags": {
    "complete": ["white_check_mark"],
    "error": ["x"],
    "permission": ["warning"],
    "question": ["question"],
    "subagent_complete": ["white_check_mark"]
  },
  "messages": {
    "complete": "Session completed: {sessionTitle}",
    "error": "Session error: {sessionTitle}",
    "permission": "Permission required: {sessionTitle}",
    "question": "Session has a question: {sessionTitle}",
    "subagent_complete": "Subagent completed: {sessionTitle}"
  }
}
```

### Options

- `topic` - (Required) Your ntfy topic name
- `server` - ntfy server URL (default: `https://ntfy.sh`)
- `token` - ntfy access token for authenticated topics (default: `null`)
- `minDuration` - Minimum session duration in seconds to trigger `complete` notification (default: `0`)
- `events` - Enable/disable notifications per event type
- `priority` - ntfy priority per event: `min`, `low`, `default`, `high`, `max`
- `tags` - ntfy tags (emoji shortcodes) per event
- `messages` - Custom notification messages. Supports `{sessionTitle}` and `{projectName}` placeholders

### Self-hosted ntfy

```json
{
  "server": "https://ntfy.example.com",
  "topic": "my-topic",
  "token": "tk_abc123..."
}
```

## How it works

- Listens to OpenCode session events (`session.idle`, `session.error`, `permission.asked`, etc.)
- Sends a POST request to the ntfy HTTP API via `curl`
- No external npm dependencies - uses only Bun's built-in shell (`$`)

## Requirements

- [OpenCode](https://opencode.ai)
- `curl` (pre-installed on most systems)

## License

MIT
