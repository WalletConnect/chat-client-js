import { IChatClient, IChatEngine } from "../types";

export class ChatEngine extends IChatEngine {
  constructor(client: IChatClient) {
    super(client);
  }

  public sendMessage: IChatEngine["sendMessage"] = async ({
    topic,
    payload,
  }) => {
    // TODO: Perform validation checks

    // TODO: Send message
    // await this.sendRequest(topic, "wc_chatMessage", { request, chainId });

    // Set message in ChatMessages store, keyed by thread topic T.
    if (this.client.chatMessages.keys.includes(topic)) {
      const messages = this.client.chatMessages.get(topic);
      await this.client.chatMessages.update(topic, [...messages, payload]);
    } else {
      await this.client.chatMessages.set(topic, payload);
    }
  };
}
