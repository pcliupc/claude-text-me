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

- **Bun** - [Install Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)
- **Claude Code** - [Installation Guide](https://docs.anthropic.com/en/docs/claude-code)
- **Feishu Account** - Personal or enterprise account

### 2. Create Feishu App

1. Go to [Feishu Open Platform](https://open.feishu.cn/) and create a new **Enterprise Self-built App**
2. Navigate to **Credentials & Basic Info** and copy your **App ID** and **App Secret**
3. Go to **Permissions & Scopes** and add the following permissions:
   - `im:message` - Send messages
   - `im:message.receive_v1` - Receive messages (for bidirectional communication)

   **Important**: After adding each permission, click **"Edit Scope"** (编辑权限范围) and add your account to the available scope.

4. Go to **Events & Callbacks** → **Event Subscription**:
   - Enable **Long Connection Mode** (长连接模式)
   - Add subscription: **`im.message.receive_v1`**
5. Go to **App Release** and publish the app to make it available

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
# Add the marketplace
/plugin marketplace add pcliupc/claude-text-me

# Install the plugin (Bun auto-installs dependencies)
/plugin install claude-text-me@claude-text-me
```

**Alternative: Manual Installation**

```bash
# Clone the repository
git clone https://github.com/pcliupc/claude-text-me.git
cd claude-text-me

# Install dependencies
bun install

# Install as Claude Code plugin
/plugin install /path/to/claude-text-me
```

### 5. Configure Environment Variables

Add to your `~/.zshrc`, `~/.bashrc`, or `~/.claude/settings.json`:

**Shell Profile:**
```bash
export TEXTME_FEISHU_APP_ID="cli_xxxxxxxxxxxx"
export TEXTME_FEISHU_APP_SECRET="xxxxxxxxxxxxxxxxxxxxxxxx"
export TEXTME_FEISHU_USER_ID="ou_xxxxxxxxxxxxxxxxxxxxxxxx"
```

**Or in `~/.claude/settings.json`:**
```json
{
  "env": {
    "TEXTME_FEISHU_APP_ID": "cli_xxxxxxxxxxxx",
    "TEXTME_FEISHU_APP_SECRET": "xxxxxxxxxxxxxxxxxxxxxxxx",
    "TEXTME_FEISHU_USER_ID": "ou_xxxxxxxxxxxxxxxxxxxxxxxx"
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

## Usage Guide

### Available Tools

| Tool | Purpose | Example |
|------|---------|---------|
| `send_message` | Send a simple text notification | "Text me when the build is done" |
| `send_rich_message` | Send a formatted card with title/status | "Send me a success notification when deployment completes" |
| `ask_user` | Ask for user input via Feishu (waits for reply) | "Ask me which branch to deploy to" |
| `get_messages` | Check for user's spontaneous messages | "Check if I sent any messages while you were working" |

### Working Away from the Computer

When you're away from your desk, you have two ways to interact with Claude:

#### 1. Using `ask_user` (Wait for Response)

Use this when Claude needs to ask you something:

```
"Deploy to production, but confirm with me first"
"Ask me which branch to deploy via Feishu"
```

Claude will send a Feishu message and wait up to 3 minutes for your reply.

#### 2. Using `send_message` + `get_messages` (Spontaneous Communication)

Use this when you want to initiate communication or when you might have questions:

```
"Deploy the application. I'll send you a message if I have any questions - check periodically using get_messages"
```

This pattern allows you to:
1. Receive notifications via `send_message`
2. Reply to those messages in Feishu
3. Have Claude check for your replies using `get_messages`

### Remote Mode Prompts

Here are some prompt patterns that work well:

```
"I'll be away from my desk. Run the deployment and use Feishu for any confirmations."

"I'm leaving my computer. Monitor the build and text me if there are issues. Check for my messages every few minutes."

"Start the long-running task. Send me progress updates, and use ask_user if you need my input."
```

### Getting Notifications

Simply tell Claude to notify you:

```
"Run the full test suite and send me a message with the results"
"Deploy to production and text me when it's done"
```

### Example Conversations

**Task Completion Notification:**
```
You: Run all tests and send me the results

Claude: [runs tests...] Sending message via Feishu...

📱 Your phone: "All tests passed (127/127)"
```

**Confirmation Before Deployment:**
```
You: Deploy to production, but confirm with me via Feishu first

Claude: [sends Feishu message] "Ready to deploy to production. Proceed?"

📱 You reply: "Yes"

Claude: Deploying...
```

**Interactive Decision Making:**
```
You: Check which branches are available and ask me via Feishu which one to deploy

Claude: [sends Feishu message] "Available branches: main, staging, dev-v2. Which one should I deploy?"

📱 You reply: "staging"

Claude: Deploying staging...
```

**Spontaneous Communication with get_messages:**
```
You: I'll be away from my desk. Deploy to staging and check if I send any messages

Claude: [sends Feishu message] "Starting deployment to staging..."

📱 You reply: "Wait, deploy to dev-v2 instead"

[After some time...]

Claude: [calls get_messages] "Received 1 message from user via Feishu:
- Wait, deploy to dev-v2 instead"

Claude: Got it! Changing target to dev-v2. Deploying...
```

**Long-Running Task with Check-ins:**
```
You: Start the production deployment. I'll be away, so send me updates and check for my messages every 5 minutes

Claude: Starting deployment... [sends progress update via send_message]

[5 minutes later...]

Claude: [calls get_messages] "No pending messages from user."
[deployment continues]

📱 You reply to earlier message: "How's the deployment going?"

Claude: [calls get_messages] "Received 1 message:
- How's the deployment going?"

Claude: Deployment is 60% complete. All containers are healthy...
```

## How It Works

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Claude Code   │ MCP  │  claude-text-me │ API  │   Feishu API    │
│                 │─────▶│   MCP Server    │─────▶│                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                  │                        │
                                  │◀───────────────────────┤
                                  │  WebSocket (长连接)     │
                                  │  + Message Queue       ▼
                                  │               ┌─────────────────┐
                                  └──────────────▶│   Your Phone    │
                                                  └─────────────────┘
```

1. Claude Code connects to the plugin via MCP (Model Context Protocol)
2. When Claude needs to notify you, it calls `send_message` or `send_rich_message`
3. The plugin uses Feishu's API to send a message to your account
4. If you reply to a notification, the message is saved to an internal queue
5. When Claude calls `get_messages`, it retrieves your queued replies
6. For confirmations, use `ask_user` - it waits synchronously for your reply via Feishu

**Message Queue Behavior:**
- Messages you send in Feishu are saved when there's no pending `ask_user` waiting
- Queue holds up to 50 messages, with 1-hour expiration
- `get_messages` retrieves and clears the queue

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `TEXTME_FEISHU_APP_ID` | Yes | Your Feishu app's App ID |
| `TEXTME_FEISHU_APP_SECRET` | Yes | Your Feishu app's App Secret |
| `TEXTME_FEISHU_USER_ID` | Yes | Your Feishu User ID (receiver) |

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
│   ├── plugin.json        # Plugin manifest for Claude Code
│   └── marketplace.json   # Marketplace configuration
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
- [ ] Message templates / customization
- [ ] Rate limiting / message batching

## Related Projects

- [call-me](https://github.com/ZeframLou/call-me) - The original inspiration, uses phone calls instead of messages
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - Anthropic's official CLI for Claude

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Made with Claude Code
