import { ChatClientTypes, IChatClient } from "./client";

export abstract class IChatEngine {
  constructor(public client: IChatClient) {}

  public abstract sendMessage(params: {
    topic: string;
    payload: ChatClientTypes.Message;
  }): Promise<void>;
}
