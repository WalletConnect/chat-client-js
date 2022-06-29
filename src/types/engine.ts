import {
  ErrorResponse,
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcResult,
} from "@walletconnect/jsonrpc-utils";
import { ChatClientTypes, IChatClient } from "./client";
import { JsonRpcTypes } from "./jsonrpc";

export declare namespace EngineTypes {
  interface EventCallback<T extends JsonRpcRequest | JsonRpcResponse> {
    topic: string;
    payload: T;
  }
}

export abstract class IChatEngine {
  constructor(public client: IChatClient) {}

  public abstract init(): Promise<void>;

  public abstract register(params: {
    account: string;
    private?: boolean;
  }): Promise<string>;

  public abstract resolve(params: { account: string }): Promise<string>;

  public abstract sendMessage(params: {
    topic: string;
    payload: ChatClientTypes.Message;
  }): Promise<void>;

  // ---------- Protected Helpers --------------------------------------- //

  protected abstract sendRequest<M extends JsonRpcTypes.WcMethod>(
    topic: string,
    method: M,
    // params: JsonRpcTypes.RequestParams[M]
    params: any
  ): Promise<number>;

  // @ts-expect-error - needs Results interface
  protected abstract sendResult<M extends JsonRpcTypes.WcMethod>(
    id: number,
    topic: string,
    // result: JsonRpcTypes.Results[M]
    result: any
  ): Promise<void>;

  protected abstract sendError(
    id: number,
    topic: string,
    error: ErrorResponse
  ): Promise<void>;

  protected abstract setMessage(
    topic: string,
    item: ChatClientTypes.Message
  ): Promise<void>;

  // ---------- Protected Relay Event Methods ----------------------------------- //

  protected abstract onRelayEventRequest(
    event: EngineTypes.EventCallback<JsonRpcRequest>
  ): void;

  protected abstract onRelayEventResponse(
    event: EngineTypes.EventCallback<JsonRpcResponse>
  ): Promise<void>;

  protected abstract onIncomingMessage(
    topic: string,
    payload: JsonRpcRequest<ChatClientTypes.Message>
  ): Promise<void>;

  protected abstract onSendMessageResponse(
    topic: string,
    payload: JsonRpcResult<true> | JsonRpcError
  ): void;
}
