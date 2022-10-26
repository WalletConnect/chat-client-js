import {
  ErrorResponse,
  JsonRpcRequest,
  JsonRpcResponse,
} from "@walletconnect/jsonrpc-types";

export declare namespace JsonRpcTypes {
  // -- core ------------------------------------------------------- //
  type DefaultResponse = true | ErrorResponse;

  export type WcMethod =
    | "wc_chatInvite"
    | "wc_chatMessage"
    | "wc_chatPing"
    | "wc_chatLeave";

  type Error = ErrorResponse;

  // -- requests --------------------------------------------------- //

  interface RequestParams {
    wc_chatPing: Record<string, unknown>;
  }

  // -- responses -------------------------------------------------- //
  interface Results {
    wc_chatPing: true;
  }

  // -- events ----------------------------------------------------- //
  interface EventCallback<T extends JsonRpcRequest | JsonRpcResponse> {
    topic: string;
    payload: T;
  }
}
