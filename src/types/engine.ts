import {
  ErrorResponse,
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcResult,
} from "@walletconnect/jsonrpc-utils";
import { CryptoTypes } from "@walletconnect/types";
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

  public abstract invite(params: {
    account: string;
    invite: ChatClientTypes.PartialInvite;
  }): Promise<number>;

  public abstract accept(params: { id: number }): Promise<string>;

  public abstract reject(params: { id: number }): Promise<void>;

  public abstract sendMessage(params: {
    topic: string;
    payload: ChatClientTypes.Message;
  }): Promise<void>;

  public abstract ping(params: { topic: string }): Promise<void>;

  public abstract leave(params: { topic: string }): Promise<void>;

  // ---------- Protected Helpers --------------------------------------- //

  protected abstract sendRequest<M extends JsonRpcTypes.WcMethod>(
    topic: string,
    method: M,
    params: JsonRpcTypes.RequestParams[M],
    opts?: CryptoTypes.EncodeOptions
  ): Promise<number>;

  protected abstract sendResult<M extends JsonRpcTypes.WcMethod>(
    id: number,
    topic: string,
    result: JsonRpcTypes.Results[M],
    opts?: CryptoTypes.EncodeOptions
  ): Promise<void>;

  protected abstract sendError(
    id: number,
    topic: string,
    error: ErrorResponse,
    opts?: CryptoTypes.EncodeOptions
  ): Promise<void>;

  protected abstract setMessage(
    topic: string,
    item: ChatClientTypes.Message
  ): Promise<void>;

  protected abstract leaveChat(topic: string): Promise<void>;

  // ---------- Protected Relay Event Methods ----------------------------------- //

  protected abstract onRelayEventRequest(
    event: EngineTypes.EventCallback<JsonRpcRequest>
  ): void;

  protected abstract onRelayEventResponse(
    event: EngineTypes.EventCallback<JsonRpcResponse>
  ): Promise<void>;

  protected abstract onIncomingInvite(
    topic: string,
    payload: JsonRpcRequest<ChatClientTypes.Invite>
  ): Promise<void>;

  protected abstract onInviteResponse(
    topic: string,
    payload: JsonRpcResult<{ publicKey: string }> | JsonRpcError
  ): void;

  protected abstract onIncomingMessage(
    topic: string,
    payload: JsonRpcRequest<ChatClientTypes.Message>
  ): Promise<void>;

  protected abstract onRejectedChatInvite(params: {
    topic: string;
  }): Promise<void>;

  protected abstract onSendMessageResponse(
    topic: string,
    payload: JsonRpcResult<true> | JsonRpcError
  ): void;

  protected abstract onChatPingRequest(
    topic: string,
    payload: JsonRpcRequest<JsonRpcTypes.RequestParams["wc_chatPing"]>
  ): Promise<void>;

  protected abstract onChatPingResponse(
    topic: string,
    payload: JsonRpcResult<JsonRpcTypes.Results["wc_chatPing"]> | JsonRpcError
  ): void;

  protected abstract onChatLeaveRequest(
    topic: string,
    payload: JsonRpcRequest<JsonRpcTypes.RequestParams["wc_chatLeave"]>
  ): Promise<void>;
}
