import { Logger } from "pino";
import { Store } from "@walletconnect/core";
import { ICore } from "@walletconnect/types";
import { CHAT_CLIENT_STORAGE_PREFIX, CHAT_THREADS_CONTEXT } from "../constants";
import { ChatClientTypes } from "../types";

export class ChatThreads extends Store<string, ChatClientTypes.Thread> {
  constructor(public core: ICore, public logger: Logger) {
    super(core, logger, CHAT_THREADS_CONTEXT, CHAT_CLIENT_STORAGE_PREFIX);
  }
}
