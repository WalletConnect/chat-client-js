import { Logger } from "pino";
import { Store } from "@walletconnect/core";
import { ICore } from "@walletconnect/types";
import {
  CHAT_CLIENT_STORAGE_PREFIX,
  CHAT_MESSAGES_CONTEXT,
} from "../constants";

import { ChatClientTypes } from "../types";
export class ChatMessages extends Store<
  string,
  { messages: ChatClientTypes.Message[]; topic: string }
> {
  constructor(public core: ICore, public logger: Logger) {
    super(core, logger, CHAT_MESSAGES_CONTEXT, CHAT_CLIENT_STORAGE_PREFIX);
  }
}
