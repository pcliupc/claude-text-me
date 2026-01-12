import * as Lark from "@larksuiteoapi/node-sdk";
import type {
  MessageProvider,
  FeishuConfig,
} from "./types.js";

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

    try {
      // 使用飞书长连接模式接收事件，无需公网域名和 ngrok
      // 注意：必须关闭 SDK 日志，否则会干扰 MCP 协议的 stdio 通信
      this.wsClient = new Lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        loggerLevel: Lark.LoggerLevel.off,
      });

      this.wsClient.start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          "im.message.receive_v1": async (data) => {
            console.error("[claude-text-me] Received event:", JSON.stringify(data, null, 2));
            try {
              const message = data.message;
              console.error("[claude-text-me] Message type:", message?.message_type, "Sender:", message?.sender?.sender_id?.user_id);
              // 只处理用户发来的文本消息，忽略机器人自己发的消息
              if (message?.message_type === "text" && this.messageCallback) {
                const content = JSON.parse(message.content);
                console.error("[claude-text-me] Message content:", content.text);
                this.messageCallback(content.text);
              }
            } catch (error) {
              console.error("[claude-text-me] Failed to parse message:", error);
            }
          },
        }),
      });

      console.error("[claude-text-me] WebSocket connection started (long connection mode)");
      console.error("[claude-text-me] Listening for messages...");
    } catch (error) {
      console.error("[claude-text-me] Failed to start WebSocket connection:", error);
      console.error("[claude-text-me] Bidirectional communication (ask_user) disabled. Send-only mode active.");
      this.wsClient = null;
    }
  }

  async stopListening(): Promise<void> {
    // WSClient 没有显式的 stop 方法，设置为 null 让 GC 处理
    this.wsClient = null;
  }
}
