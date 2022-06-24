import { RELAYER_EVENTS } from "@walletconnect/core";
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
} from "@walletconnect/jsonrpc-utils";
import { RelayerTypes } from "@walletconnect/types";
import { IChatClient, IChatEngine } from "../types";
import { JsonRpcTypes } from "../types/jsonrpc";

export class ChatEngine extends IChatEngine {
  private initialized = false;

  constructor(client: IChatClient) {
    super(client);
  }

  public init: IChatEngine["init"] = async () => {
    if (!this.initialized) {
      // await this.cleanup();
      this.registerRelayerEvents();
      // this.registerExpirerEvents();
      this.initialized = true;
    }
  };

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

  // ---------- Relay Event Routing ----------------------------------- //

  private registerRelayerEvents() {
    this.client.core.relayer.on(
      RELAYER_EVENTS.message,
      async (event: RelayerTypes.MessageEvent) => {
        const { topic, message } = event;
        const payload = this.client.core.crypto.decode(topic, message);
        if (isJsonRpcRequest(payload)) {
          this.client.history.set(topic, payload);
          this.onRelayEventRequest({ topic, payload });
        } else if (isJsonRpcResponse(payload)) {
          await this.client.history.resolve(payload);
          this.onRelayEventResponse({ topic, payload });
        }
      }
    );
  }

  protected onRelayEventRequest: IChatEngine["onRelayEventRequest"] = (
    event
  ) => {
    const { topic, payload } = event;
    const reqMethod = payload.method as JsonRpcTypes.WcMethod;

    switch (reqMethod) {
      case "wc_chatMessage":
        return this.onReceiveMessage(topic, payload);
      default:
        this.client.logger.info(`Unsupported request method ${reqMethod}`);
        return;
    }
  };

  protected onRelayEventResponse: IChatEngine["onRelayEventResponse"] = async (
    event
  ) => {
    const { topic, payload } = event;
    const record = await this.client.history.get(topic, payload.id);
    const resMethod = record.request.method as JsonRpcTypes.WcMethod;

    switch (resMethod) {
      case "wc_chatMessage":
        return this.onSendMessageResponse(topic, payload);

      default:
        this.client.logger.info(`Unsupported response method ${resMethod}`);
        return;
    }
  };

  // ---------- Relay Event Handlers ----------------------------------- //

  protected onReceiveMessage: IChatEngine["onReceiveMessage"] = async (
    topic,
    payload
  ) => {
    const { params, id } = payload;
    try {
      // TODO: input validation
      // TODO: effects/mutations (store message, ack received, emit chat_message, ...)
      this.client.emit("chat_message", { id, topic, params });
    } catch (err) {
      this.client.logger.error(err);
    }
  };

  // TODO: implement
  protected onSendMessageResponse: any = async (topic: any, payload: any) => {
    // const { params, id } = payload;
    try {
      // TODO: input validation
      // TODO: effects/mutations (update message status,  emit message_acknowledged event?, ...)
    } catch (err) {
      this.client.logger.error(err);
    }
  };
}
