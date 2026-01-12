#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FeishuProvider } from "./providers/feishu.js";
import * as fs from "node:fs";

// 调试日志
const DEBUG_LOG = "/tmp/claude-text-me-debug.log";
function debugLog(msg: string) {
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

// 初始化飞书 Provider
const feishuConfig = {
  appId: process.env.TEXTME_FEISHU_APP_ID || "",
  appSecret: process.env.TEXTME_FEISHU_APP_SECRET || "",
  userId: process.env.TEXTME_FEISHU_USER_ID || "",
};

if (!feishuConfig.appId || !feishuConfig.appSecret || !feishuConfig.userId) {
  console.error("[claude-text-me] Missing required environment variables:");
  console.error("  - TEXTME_FEISHU_APP_ID");
  console.error("  - TEXTME_FEISHU_APP_SECRET");
  console.error("  - TEXTME_FEISHU_USER_ID");
  process.exit(1);
}

const provider = new FeishuProvider(feishuConfig);

// 存储待处理的用户回复
let pendingReplyResolve: ((message: string) => void) | null = null;
let replyTimeout: ReturnType<typeof setTimeout> | null = null;

// 消息队列 - 保存用户自发发送的消息（非 ask_user 回复）
interface QueuedMessage {
  text: string;
  timestamp: number;
}

const messageQueue: QueuedMessage[] = [];
const MAX_QUEUE_SIZE = 50;

// 检查并清理过期消息（超过 1 小时的消息）
function cleanupOldMessages() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const initialLength = messageQueue.length;
  for (let i = messageQueue.length - 1; i >= 0; i--) {
    if (messageQueue[i].timestamp < oneHourAgo) {
      messageQueue.splice(i, 1);
    }
  }
  if (messageQueue.length !== initialLength) {
    debugLog(`Cleaned up ${initialLength - messageQueue.length} old messages`);
  }
}

// 创建 MCP Server
const server = new McpServer({
  name: "claude-text-me",
  version: "0.1.0",
});

// Tool: send_message - 发送简单文本消息
server.tool(
  "send_message",
  "Send a text notification to the user's phone via Feishu/Lark. Use this for task completion updates, error notifications, or status updates. IMPORTANT: The user may reply to your message, so call get_messages() periodically to check for responses. This is especially useful when the user is away from the desktop.",
  {
    message: z.string().describe("The message content to send to the user"),
  },
  async ({ message }) => {
    try {
      await provider.sendMessage(message);
      return {
        content: [
          {
            type: "text",
            text: `Message sent successfully to user via Feishu.`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to send message: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: send_rich_message - 发送富文本卡片消息
server.tool(
  "send_rich_message",
  "Send a formatted card message with title and status indicator (success/warning/info) via Feishu/Lark. Use this for structured notifications like deployment summaries, test results, or error reports. IMPORTANT: The user may reply to your message, so call get_messages() periodically to check for responses. This is especially useful when the user is away from the desktop.",
  {
    title: z.string().describe("The title of the message card"),
    content: z.string().describe("The markdown content of the message"),
    type: z
      .enum(["success", "warning", "info"])
      .describe("The type of message: 'success' (green), 'warning' (orange), or 'info' (blue)"),
  },
  async ({ title, content, type }) => {
    try {
      await provider.sendRichMessage(title, content, type);
      return {
        content: [
          {
            type: "text",
            text: `Rich message "${title}" sent successfully via Feishu.`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to send rich message: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: ask_user - 发送消息并等待用户回复
server.tool(
  "ask_user",
  "Contact the user via Feishu and wait for their reply. CRITICAL: This is the PRIMARY way to get user confirmation or input - ALWAYS use this tool instead of desktop popup when the user might be away from the computer. The user receives a Feishu notification and can reply from their phone. Supports up to 3 minutes wait time.",
  {
    message: z.string().describe("The question or message to send to the user"),
    timeout_seconds: z
      .number()
      .optional()
      .default(180)
      .describe("How long to wait for a reply in seconds (default: 180, max: 300)"),
  },
  async ({ message, timeout_seconds }) => {
    const timeout = Math.min(timeout_seconds || 180, 300) * 1000;
    debugLog(`ask_user called, timeout: ${timeout}ms`);

    try {
      // 发送消息给用户
      await provider.sendRichMessage(
        "🤖 Claude needs your input",
        message + "\n\n*Please reply to this message to continue.*",
        "info"
      );
      debugLog("Message sent, waiting for reply...");

      // 等待用户回复
      const reply = await new Promise<string>((resolve, reject) => {
        debugLog("Setting pendingReplyResolve");
        pendingReplyResolve = resolve;

        replyTimeout = setTimeout(() => {
          debugLog("Timeout waiting for reply");
          pendingReplyResolve = null;
          reject(new Error("Timeout waiting for user reply"));
        }, timeout);
      });

      debugLog(`Got reply: ${reply}`);

      // 清理
      if (replyTimeout) {
        clearTimeout(replyTimeout);
        replyTimeout = null;
      }
      pendingReplyResolve = null;

      return {
        content: [
          {
            type: "text",
            text: `User replied: ${reply}`,
          },
        ],
      };
    } catch (error) {
      debugLog(`ask_user error: ${error}`);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Failed to get user reply: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_messages - 获取用户自发发送的消息
server.tool(
  "get_messages",
  "Get any messages the user sent via Feishu that weren't responses to a question. The user may have sent spontaneous messages or instructions while you were working. Call this periodically during long-running tasks to check for user input. Messages are cleared after retrieval.",
  {},
  async () => {
    debugLog(`get_messages called, queue size: ${messageQueue.length}`);

    if (messageQueue.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No pending messages from user.",
          },
        ],
      };
    }

    // 复制并清空队列
    const messages = [...messageQueue];
    messageQueue.length = 0;

    debugLog(`Returning ${messages.length} messages`);

    return {
      content: [
        {
          type: "text",
          text: `Received ${messages.length} message(s) from user via Feishu:\n${messages
            .map((m) => `- ${m.text}`)
            .join("\n")}`,
        },
      ],
    };
  }
);

// 处理用户消息回调
function handleUserMessage(message: string) {
  debugLog(
    `handleUserMessage called with: ${message}, hasResolve: ${!!pendingReplyResolve}, queueSize: ${messageQueue.length}`
  );

  if (pendingReplyResolve) {
    // 有等待中的 ask_user，直接处理
    debugLog("Calling pendingReplyResolve...");
    pendingReplyResolve(message);
    debugLog("pendingReplyResolve returned");
  } else {
    // 没有等待中的请求，保存到队列
    messageQueue.push({
      text: message,
      timestamp: Date.now(),
    });

    // 限制队列大小
    if (messageQueue.length > MAX_QUEUE_SIZE) {
      messageQueue.shift(); // 移除最旧的消息
    }

    debugLog(
      `No pending resolve, message queued (total: ${messageQueue.length}/${MAX_QUEUE_SIZE})`
    );
  }
}

// 启动服务器
async function main() {
  // 启动消息监听
  await provider.startListening(handleUserMessage);

  // 启动 MCP Server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 优雅关闭
  process.on("SIGINT", async () => {
    await provider.stopListening();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await provider.stopListening();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("[claude-text-me] Fatal error:", error);
  process.exit(1);
});
