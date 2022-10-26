import {
  ErrorResponse as IErrorResponse,
  JsonRpcRequest as IJsonRpcRequest,
  JsonRpcResponse as IJsonRpcResponse,
} from "@walletconnect/jsonrpc-types";

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
    wc_chatPing: Record<string, unknown>;
  }

  // -- responses -------------------------------------------------- //
  interface Results {
    wc_chatPing: true;
  }

  // -- events ----------------------------------------------------- //
  interface EventCallback<T extends IJsonRpcRequest | IJsonRpcResponse> {
    topic: string;
    payload: T;
  }
}
