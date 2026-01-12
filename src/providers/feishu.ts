import * as Lark from "@larksuiteoapi/node-sdk";
import * as fs from "node:fs";
import type {
  MessageProvider,
  FeishuConfig,
} from "./types.js";

// 调试日志文件路径 - 不会干扰 MCP 协议
const DEBUG_LOG_PATH = "/tmp/claude-text-me-debug.log";

// 写入调试日志到文件
function debugLog(...args: unknown[]) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${args.join(" ")}\n`);
}

// 空的 logger 实现，避免 SDK 日志干扰 MCP 协议的 stdio 通信
const silentLogger: any = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
};

export class FeishuProvider implements MessageProvider {
  name = "feishu";
  private config: FeishuConfig;
  private client: Lark.Client;
  private wsClient: Lark.WSClient | null = null;
  private messageCallback: ((message: string) => void) | null = null;

  constructor(config: FeishuConfig) {
    this.config = config;
    this.client = new Lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
    });
  }

  async sendMessage(message: string): Promise<void> {
    const result = await this.client.im.v1.message.create({
      params: {
        receive_id_type: "user_id",
      },
      data: {
        receive_id: this.config.userId,
        msg_type: "text",
        content: JSON.stringify({ text: message }),
      },
    });

    if (result.code !== 0) {
      throw new Error(`Failed to send message: ${result.msg}`);
    }
  }

  async sendRichMessage(
    title: string,
    content: string,
    type: "success" | "warning" | "info"
  ): Promise<void> {
    const colorMap = {
      success: "green",
      warning: "orange",
      info: "blue",
    };

    const cardContent = {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: "plain_text",
          content: title,
        },
        template: colorMap[type],
      },
      elements: [
        {
          tag: "markdown",
          content: content,
        },
      ],
    };

    const result = await this.client.im.v1.message.create({
      params: {
        receive_id_type: "user_id",
      },
      data: {
        receive_id: this.config.userId,
        msg_type: "interactive",
        content: JSON.stringify(cardContent),
      },
    });

    if (result.code !== 0) {
      throw new Error(`Failed to send rich message: ${result.msg}`);
    }
  }

  async startListening(onMessage: (message: string) => void): Promise<void> {
    this.messageCallback = onMessage;

    // 清空旧日志
    try {
      fs.writeFileSync(DEBUG_LOG_PATH, `=== claude-text-me debug log started ===\n`);
    } catch {
      // 忽略
    }

    try {
      // 使用飞书长连接模式接收事件，无需公网域名和 ngrok
      // 必须使用空 logger，否则 SDK 日志会干扰 MCP 协议的 stdio 通信
      this.wsClient = new Lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        loggerLevel: Lark.LoggerLevel.fatal,
        logger: silentLogger,
      });

      // 注册所有可能的事件，用于调试
      const dispatcher = new Lark.EventDispatcher({});

      // 注册所有可能的事件类型
      const eventTypes = [
        "im.message.receive_v1",
        "message.read_v1",
        "message.message_read_v1",
      ];

      for (const eventType of eventTypes) {
        dispatcher.register({
          [eventType]: async (data: any) => {
            debugLog(`Event received: ${eventType}`, JSON.stringify(data));
            try {
              if (eventType === "im.message.receive_v1") {
                const message = data.message;
                debugLog(`Message type:`, message?.message_type, `Sender:`, message?.sender?.sender_id?.user_id);
                if (message?.message_type === "text" && this.messageCallback) {
                  const content = JSON.parse(message.content);
                  debugLog(`Message content:`, content.text);
                  this.messageCallback(content.text);
                }
              }
            } catch (error) {
              debugLog(`Error handling event:`, error);
            }
          },
        });
      }

      this.wsClient.start({ eventDispatcher: dispatcher });
      debugLog(`WebSocket client started, listening for events...`);
    } catch (error) {
      debugLog(`Failed to start WebSocket:`, error);
      // 启动失败时设为 null，但不影响 send-only 模式
      this.wsClient = null;
    }
  }

  async stopListening(): Promise<void> {
    // WSClient 没有显式的 stop 方法，设置为 null 让 GC 处理
    this.wsClient = null;
  }
}
