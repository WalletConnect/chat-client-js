import { JsonRpcRequest, JsonRpcResponse } from "@walletconnect/jsonrpc-utils";
import { ChatClientTypes, IChatClient } from "./client";

export declare namespace EngineTypes {
  interface EventCallback<T extends JsonRpcRequest | JsonRpcResponse> {
    topic: string;
    payload: T;
  }
}

export abstract class IChatEngine {
  constructor(public client: IChatClient) {}

  public abstract init(): Promise<void>;

  public abstract sendMessage(params: {
    topic: string;
    payload: ChatClientTypes.Message;
  }): Promise<void>;

  // ---------- Protected Relay Event Methods ----------------------------------- //

  protected abstract onRelayEventRequest(
    event: EngineTypes.EventCallback<JsonRpcRequest>
  ): void;

  protected abstract onRelayEventResponse(
    event: EngineTypes.EventCallback<JsonRpcResponse>
  ): Promise<void>;

  protected abstract onReceiveMessage(
    topic: string,
    payload: JsonRpcRequest<ChatClientTypes.Message>
  ): Promise<void>;
}
