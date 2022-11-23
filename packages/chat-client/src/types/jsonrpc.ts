import {
  ErrorResponse as IErrorResponse,
  JsonRpcRequest as IJsonRpcRequest,
  JsonRpcResponse as IJsonRpcResponse,
} from "@walletconnect/jsonrpc-types";
import { ChatClientTypes } from "./client";

export declare namespace JsonRpcTypes {
  // -- core ------------------------------------------------------- //
  type DefaultResponse = true | IErrorResponse;

  export type WcMethod =
    | "wc_chatInvite"
    | "wc_chatMessage"
    | "wc_chatPing"
    | "wc_chatLeave";

  type Error = IErrorResponse;

  // -- requests --------------------------------------------------- //

  interface RequestParams {
    wc_chatInvite: ChatClientTypes.Invite;
    wc_chatMessage: ChatClientTypes.Message;
    wc_chatPing: Record<string, unknown>;
    wc_chatLeave: Record<string, unknown>;
  }

  // -- responses -------------------------------------------------- //
  interface Results {
    wc_chatInvite: { publicKey: string };
    wc_chatMessage: true;
    wc_chatPing: true;
    wc_chatLeave: true;
  }

  // -- events ----------------------------------------------------- //
  interface EventCallback<T extends IJsonRpcRequest | IJsonRpcResponse> {
    topic: string;
    payload: T;
  }
}
