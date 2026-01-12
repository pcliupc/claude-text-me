import * as Lark from "@larksuiteoapi/node-sdk";
import * as fs from "node:fs";
import type {
  MessageProvider,
  FeishuConfig,
} from "./types.js";

// 空的 logger 实现，避免 SDK 日志干扰 MCP 协议的 stdio 通信
const silentLogger: any = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
};

// 调试日志
const DEBUG_LOG = "/tmp/claude-text-me-debug.log";
function debugLog(msg: string) {
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

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
    debugLog("startListening called, callback set");

    try {
      // 使用飞书长连接模式接收事件，无需公网域名和 ngrok
      // 必须使用空 logger，否则 SDK 日志会干扰 MCP 协议的 stdio 通信
      this.wsClient = new Lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        loggerLevel: Lark.LoggerLevel.fatal,
        logger: silentLogger,
      });

      this.wsClient.start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          "im.message.receive_v1": async (data) => {
            debugLog("Event received");
            try {
              const message = data.message;
              debugLog(`message_type: ${message?.message_type}, hasCallback: ${!!this.messageCallback}`);
              // 只处理用户发来的文本消息
              if (message?.message_type === "text" && this.messageCallback) {
                const content = JSON.parse(message.content);
                debugLog(`Calling callback with: ${content.text}`);
                this.messageCallback(content.text);
                debugLog("Callback returned");
              }
            } catch (err) {
              debugLog(`Error: ${err}`);
            }
          },
        }),
      });
      debugLog("WebSocket started");
    } catch (err) {
      debugLog(`WS start error: ${err}`);
      // 启动失败时设为 null，但不影响 send-only 模式
      this.wsClient = null;
    }
  }

  async stopListening(): Promise<void> {
    // WSClient 没有显式的 stop 方法，设置为 null 让 GC 处理
    this.wsClient = null;
  }
}
