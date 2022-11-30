import { Logger } from "pino";
import { Store } from "@walletconnect/core";
import { ICore } from "@walletconnect/types";
import { CHAT_CLIENT_STORAGE_PREFIX } from "../constants";
import { ChatClientTypes } from "../types";

// FIXME: `StoreStruct` is opinionated towards SignClient data types -> make it agnostic.
// StoreStruct = SessionTypes.Struct | PairingTypes.Struct | ProposalTypes.Struct;
export class ChatKeys extends Store<string, ChatClientTypes.ChatKey> {
  constructor(public core: ICore, public logger: Logger) {
    super(
      core,
      logger,
      "chat_keys",
      CHAT_CLIENT_STORAGE_PREFIX,
      (chats: ChatClientTypes.ChatKey) => {
        return chats._key;
      }
    );
  }
}
