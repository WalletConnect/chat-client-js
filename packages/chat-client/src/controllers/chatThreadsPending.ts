import { Logger } from "pino";
import { Store } from "@walletconnect/core";
import { ICore } from "@walletconnect/types";
import {
  CHAT_CLIENT_STORAGE_PREFIX,
  CHAT_THREADS_PENDING_CONTEXT,
} from "../constants";
import { ChatClientTypes } from "../types";

export class ChatThreadsPending extends Store<
  string,
  ChatClientTypes.PendingThread
> {
  constructor(public core: ICore, public logger: Logger) {
    super(
      core,
      logger,
      CHAT_THREADS_PENDING_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX,
      (pendingThread: ChatClientTypes.PendingThread) => pendingThread.topic
    );
  }
}
