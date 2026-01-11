export interface MessageProvider {
  name: string;
  sendMessage(message: string): Promise<void>;
  sendRichMessage(title: string, content: string, type: "success" | "warning" | "info"): Promise<void>;
  startListening(onMessage: (message: string) => void): Promise<void>;
  stopListening(): Promise<void>;
}

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  userId: string; // 接收消息的用户 ID
}

export interface FeishuTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

export interface FeishuMessageResponse {
  code: number;
  msg: string;
  data?: {
    message_id: string;
  };
}

export interface FeishuEventMessage {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: {
    sender: {
      sender_id: {
        open_id: string;
        user_id: string;
        union_id: string;
      };
      sender_type: string;
    };
    message: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      create_time: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
    };
  };
}
