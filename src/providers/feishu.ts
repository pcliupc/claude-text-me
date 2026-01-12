import type {
  MessageProvider,
  FeishuConfig,
  FeishuTokenResponse,
  FeishuMessageResponse,
  FeishuEventMessage,
} from "./types.js";

export class FeishuProvider implements MessageProvider {
  name = "feishu";
  private config: FeishuConfig;
  private accessToken: string | null = null;
  private tokenExpireAt: number = 0;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private messageCallback: ((message: string) => void) | null = null;
  private ngrokUrl: string | null = null;

  constructor(config: FeishuConfig) {
    this.config = config;
  }

  private async getAccessToken(): Promise<string> {
    // 如果 token 还有效（提前 5 分钟刷新）
    if (this.accessToken && Date.now() < this.tokenExpireAt - 5 * 60 * 1000) {
      return this.accessToken;
    }

    const response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      }
    );

    const data = (await response.json()) as FeishuTokenResponse;
    if (data.code !== 0) {
      throw new Error(`Failed to get access token: ${data.msg}`);
    }

    this.accessToken = data.tenant_access_token;
    this.tokenExpireAt = Date.now() + data.expire * 1000;
    return this.accessToken;
  }

  async sendMessage(message: string): Promise<void> {
    const token = await this.getAccessToken();

    const response = await fetch(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=user_id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: this.config.userId,
          msg_type: "text",
          content: JSON.stringify({ text: message }),
        }),
      }
    );

    const data = (await response.json()) as FeishuMessageResponse;
    if (data.code !== 0) {
      throw new Error(`Failed to send message: ${data.msg}`);
    }
  }

  async sendRichMessage(
    title: string,
    content: string,
    type: "success" | "warning" | "info"
  ): Promise<void> {
    const token = await this.getAccessToken();

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

    const response = await fetch(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=user_id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: this.config.userId,
          msg_type: "interactive",
          content: JSON.stringify(cardContent),
        }),
      }
    );

    const data = (await response.json()) as FeishuMessageResponse;
    if (data.code !== 0) {
      throw new Error(`Failed to send rich message: ${data.msg}`);
    }
  }

  async startListening(onMessage: (message: string) => void): Promise<void> {
    this.messageCallback = onMessage;
    const port = parseInt(process.env.TEXTME_PORT || "3456");

    // 启动本地 HTTP 服务器接收飞书事件 (可选，用于双向通信)
    try {
      this.server = Bun.serve({
        port,
        fetch: async (req) => {
          if (req.method === "POST") {
            const body = await req.json() as Record<string, unknown>;

            // 处理飞书的 URL 验证请求
            if (body.type === "url_verification") {
              return new Response(JSON.stringify({ challenge: body.challenge }), {
                headers: { "Content-Type": "application/json" },
              });
            }

            // 处理消息事件
            const header = body.header as Record<string, unknown> | undefined;
            if (header?.event_type === "im.message.receive_v1") {
              const event = body as unknown as FeishuEventMessage;
              try {
                const messageContent = JSON.parse(event.event.message.content);
                if (event.event.message.message_type === "text" && this.messageCallback) {
                  this.messageCallback(messageContent.text);
                }
              } catch {
                console.error("[claude-text-me] Failed to parse message content");
              }
            }

            return new Response(JSON.stringify({ code: 0 }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response("OK");
        },
        error: (error) => {
          console.error("[claude-text-me] Server error:", error);
          return new Response("Internal Server Error", { status: 500 });
        },
      });

      console.error(`[claude-text-me] Local server running on port ${port}`);

      // 启动 ngrok 隧道
      const ngrokToken = process.env.TEXTME_NGROK_AUTHTOKEN;
      if (ngrokToken && ngrokToken.trim() !== "") {
        try {
          const ngrok = await import("@ngrok/ngrok");
          const listener = await ngrok.forward({
            addr: port,
            authtoken: ngrokToken.trim(),
          });
          this.ngrokUrl = listener.url() || null;
          console.error(`[claude-text-me] Webhook URL: ${this.ngrokUrl}`);
          console.error(`[claude-text-me] Configure this URL in Feishu app event subscription`);
        } catch (error) {
          console.error(`[claude-text-me] Failed to start ngrok:`, error);
          console.error(`[claude-text-me] Bidirectional communication disabled.`);
        }
      } else {
        console.error(`[claude-text-me] Set TEXTME_NGROK_AUTHTOKEN for bidirectional communication`);
      }
    } catch (error) {
      // HTTP 服务器启动失败不影响 MCP Server 运行
      console.error(`[claude-text-me] Failed to start HTTP server:`, error);
      console.error(`[claude-text-me] Bidirectional communication (ask_user) disabled. Send-only mode active.`);
      this.server = null;
    }
  }

  async stopListening(): Promise<void> {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }

    if (this.ngrokUrl) {
      try {
        const ngrok = await import("@ngrok/ngrok");
        await ngrok.disconnect();
      } catch {
        // Ignore ngrok disconnect errors
      }
      this.ngrokUrl = null;
    }
  }
}
