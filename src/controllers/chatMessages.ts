import { Logger } from "pino";
import { Store } from "@walletconnect/core";
import { ICore } from "@walletconnect/types";
import {
  CHAT_CLIENT_STORAGE_PREFIX,
  CHAT_MESSAGES_CONTEXT,
} from "../constants";

import { ChatClientTypes, IChatThreads } from "../types";
let i = 0;
export class ChatMessages extends Store<
  string,
  { messages: ChatClientTypes.Message[] }
> {
  constructor(
    public core: ICore,
    public chatThreads: IChatThreads,
    public logger: Logger
  ) {
    super(
      core,
      logger,
      CHAT_MESSAGES_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX,
      () => {
        const index = i;
        i++;
        return chatThreads.getAll()[index].topic;
      }
    );
  }
}
