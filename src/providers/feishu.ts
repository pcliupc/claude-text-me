import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
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
  private server: Server | null = null;
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

  private parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({});
        }
      });
      req.on("error", reject);
    });
  }

  private sendResponse(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  async startListening(onMessage: (message: string) => void): Promise<void> {
    this.messageCallback = onMessage;
    const port = parseInt(process.env.TEXTME_PORT || "3456");

    // 启动本地 HTTP 服务器接收飞书事件
    this.server = createServer(async (req, res) => {
      if (req.method === "POST") {
        const body = (await this.parseBody(req)) as Record<string, unknown>;

        // 处理飞书的 URL 验证请求
        if (body.type === "url_verification") {
          this.sendResponse(res, 200, { challenge: body.challenge });
          return;
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

        this.sendResponse(res, 200, { code: 0 });
        return;
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(port, () => {
        resolve();
      });
    });

    // 启动 ngrok 隧道
    const ngrokToken = process.env.TEXTME_NGROK_AUTHTOKEN;
    if (ngrokToken && ngrokToken.trim() !== "") {
      try {
        const ngrok = await import("ngrok");
        this.ngrokUrl = await ngrok.default.connect({
          addr: port,
          authtoken: ngrokToken.trim(),
        });
        console.error(`[claude-text-me] Webhook URL: ${this.ngrokUrl}`);
        console.error(`[claude-text-me] Configure this URL in Feishu app event subscription`);
      } catch (error) {
        console.error(`[claude-text-me] Failed to start ngrok:`, error);
        console.error(`[claude-text-me] Bidirectional communication disabled. Local server running on port ${port}`);
      }
    } else {
      console.error(`[claude-text-me] Local server running on port ${port}`);
      console.error(`[claude-text-me] Set TEXTME_NGROK_AUTHTOKEN for bidirectional communication`);
    }
  }

  async stopListening(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    if (this.ngrokUrl) {
      try {
        const ngrok = await import("ngrok");
        await ngrok.default.disconnect();
      } catch {
        // Ignore ngrok disconnect errors
      }
      this.ngrokUrl = null;
    }
  }
}
