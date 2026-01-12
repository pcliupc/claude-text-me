#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FeishuProvider } from "./providers/feishu.js";

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

// 创建 MCP Server
const server = new McpServer({
  name: "claude-text-me",
  version: "0.1.0",
});

// Tool: send_message - 发送简单文本消息
server.tool(
  "send_message",
  "Send a text message to the user's phone via Feishu/Lark. Use this when you need to notify the user about task completion, errors, or any important updates.",
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
  "Send a rich card message with title, content and visual type indicator. Use this for structured notifications like task completion summaries, error reports, or status updates.",
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
  "Send a message to the user and wait for their reply via Feishu. Use this when you need user input or confirmation to proceed with a task. The tool will wait for up to 3 minutes for a response.",
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

    try {
      // 发送消息给用户
      await provider.sendRichMessage(
        "🤖 Claude needs your input",
        message + "\n\n*Please reply to this message to continue.*",
        "info"
      );

      // 等待用户回复
      const reply = await new Promise<string>((resolve, reject) => {
        pendingReplyResolve = resolve;

        replyTimeout = setTimeout(() => {
          pendingReplyResolve = null;
          reject(new Error("Timeout waiting for user reply"));
        }, timeout);
      });

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

// 处理用户消息回调
function handleUserMessage(message: string) {
  if (pendingReplyResolve) {
    pendingReplyResolve(message);
  } else {
    console.error(`[claude-text-me] Received message but no pending request: ${message}`);
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
