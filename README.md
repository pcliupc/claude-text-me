# claude-text-me

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that sends messages to your phone via Feishu/Lark when Claude needs your attention. Inspired by [call-me](https://github.com/ZeframLou/call-me), but uses text messages instead of phone calls.

**Why?** When Claude Code is running long tasks (builds, deployments, refactoring), you don't want to stare at the screen waiting. This plugin lets Claude notify you via Feishu when it's done or needs your input - so you can grab a coffee and come back when needed.

## Features

| Tool | Description |
|------|-------------|
| `send_message` | Send simple text notifications to your phone |
| `send_rich_message` | Send formatted card messages with title and status colors (success/warning/info) |
| `ask_user` | Send a message and wait for your reply - true bidirectional communication |

### Demo

```
You: "Refactor all the API endpoints to use async/await, and text me when you're done"

Claude: [works for 10 minutes...]

📱 Your phone buzzes with a Feishu message:
   "✅ Refactoring Complete - Updated 15 files, all tests passing"
```

## Quick Start

### 1. Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Claude Code** - [Installation Guide](https://docs.anthropic.com/en/docs/claude-code)
- **Feishu Account** - Personal or enterprise account
- **ngrok** (optional) - Required only for bidirectional communication

### 2. Create Feishu App

1. Go to [Feishu Open Platform](https://open.feishu.cn/) and create a new **Enterprise Self-built App**
2. Navigate to **Credentials & Basic Info** and copy your **App ID** and **App Secret**
3. Go to **Permissions & Scopes** and add:
   - `im:message` - Send messages
   - `im:message.receive_v1` - Receive messages (for bidirectional communication)
4. Go to **App Release** and publish the app to make it available

### 3. Get Your User ID

You need your Feishu User ID to receive messages. Here's how to get it:

**Option A: Via Feishu Admin Console**
- Go to Admin Console → Organization → Members → Find yourself → Copy User ID

**Option B: Via API**
```bash
# First get tenant access token
curl -X POST 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
  -H 'Content-Type: application/json' \
  -d '{"app_id":"YOUR_APP_ID","app_secret":"YOUR_APP_SECRET"}'

# Then get your user info by email or mobile
curl 'https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id?user_id_type=user_id' \
  -H 'Authorization: Bearer YOUR_TENANT_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"emails":["your-email@company.com"]}'
```

### 4. Install the Plugin

```bash
# Clone the repository
git clone https://github.com/pcliupc/claude-text-me.git
cd claude-text-me

# Install dependencies
npm install

# Install as Claude Code plugin
claude /plugin install /path/to/claude-text-me
```

### 5. Configure Environment Variables

Add to your `~/.zshrc`, `~/.bashrc`, or `~/.claude/settings.json`:

**Shell Profile:**
```bash
export TEXTME_FEISHU_APP_ID="cli_xxxxxxxxxxxx"
export TEXTME_FEISHU_APP_SECRET="xxxxxxxxxxxxxxxxxxxxxxxx"
export TEXTME_FEISHU_USER_ID="ou_xxxxxxxxxxxxxxxxxxxxxxxx"

# Optional: for bidirectional communication
export TEXTME_NGROK_AUTHTOKEN="your_ngrok_token"
```

**Or in `~/.claude/settings.json`:**
```json
{
  "env": {
    "TEXTME_FEISHU_APP_ID": "cli_xxxxxxxxxxxx",
    "TEXTME_FEISHU_APP_SECRET": "xxxxxxxxxxxxxxxxxxxxxxxx",
    "TEXTME_FEISHU_USER_ID": "ou_xxxxxxxxxxxxxxxxxxxxxxxx",
    "TEXTME_NGROK_AUTHTOKEN": "your_ngrok_token"
  }
}
```

### 6. Start Using

Restart Claude Code and try these prompts:

```
"Run the test suite and text me the results"
"Deploy to staging, but ask me for confirmation first via Feishu"
"Refactor this module and send me a summary when done"
```

## Bidirectional Communication Setup

For the `ask_user` tool to work (where Claude waits for your reply), you need to set up a webhook:

1. Get an ngrok auth token from [ngrok.com](https://ngrok.com)
2. Set the `TEXTME_NGROK_AUTHTOKEN` environment variable
3. Start Claude Code - you'll see a log message like:
   ```
   [claude-text-me] Webhook URL: https://abc123.ngrok.io
   ```
4. Go to your Feishu app → **Events & Callbacks** → **Event Subscription**
5. Set the Request URL to the ngrok URL
6. Add subscription: `im.message.receive_v1`
7. Save and verify

**Note:** Free ngrok URLs change on restart. For a stable URL, use [ngrok's paid plans](https://ngrok.com/pricing) or deploy to a server with a fixed domain.

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TEXTME_FEISHU_APP_ID` | Yes | - | Your Feishu app's App ID |
| `TEXTME_FEISHU_APP_SECRET` | Yes | - | Your Feishu app's App Secret |
| `TEXTME_FEISHU_USER_ID` | Yes | - | Your Feishu User ID (receiver) |
| `TEXTME_NGROK_AUTHTOKEN` | No | - | ngrok token for bidirectional communication |
| `TEXTME_PORT` | No | `3456` | Local server port for webhook |

## How It Works

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Claude Code   │ MCP  │  claude-text-me │ API  │   Feishu API    │
│                 │─────▶│   MCP Server    │─────▶│                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                  │                        │
                                  │◀───────────────────────┤
                                  │   Webhook (optional)   │
                                  │                        ▼
                                  │               ┌─────────────────┐
                                  └──────────────▶│   Your Phone    │
                                                  └─────────────────┘
```

1. Claude Code connects to the plugin via MCP (Model Context Protocol)
2. When Claude decides to notify you, it calls `send_message` or `send_rich_message`
3. The plugin uses Feishu's API to send a message to your account
4. For bidirectional communication, ngrok creates a tunnel so Feishu can send your replies back

## Contributing

Contributions are welcome! Here's how to get started:

### Development Setup

```bash
# Clone and install
git clone https://github.com/pcliupc/claude-text-me.git
cd claude-text-me
npm install

# Run type checking
npm run typecheck

# Run in development mode (with auto-reload)
npm run dev
```

### Project Structure

```
claude-text-me/
├── .claude-plugin/
│   └── plugin.json       # Plugin manifest for Claude Code
├── .mcp.json              # MCP server configuration
├── src/
│   ├── index.ts           # MCP server entry point & tool definitions
│   └── providers/
│       ├── feishu.ts      # Feishu API implementation
│       └── types.ts       # TypeScript type definitions
├── package.json
├── tsconfig.json
└── README.md
```

### Adding a New Provider (e.g., WeChat Work)

1. Create `src/providers/wecom.ts` implementing the `MessageProvider` interface
2. Add configuration options in `src/index.ts`
3. Update `.mcp.json` with new environment variables
4. Update README with setup instructions
5. Submit a PR!

## Roadmap

- [ ] WeChat Work (企业微信) support
- [ ] DingTalk (钉钉) support
- [ ] Slack support
- [ ] Telegram support
- [ ] Stable webhook without ngrok (Cloudflare Tunnel support)
- [ ] Message templates / customization
- [ ] Rate limiting / message batching

## Related Projects

- [call-me](https://github.com/ZeframLou/call-me) - The original inspiration, uses phone calls instead of messages
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - Anthropic's official CLI for Claude

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Made with Claude Code
