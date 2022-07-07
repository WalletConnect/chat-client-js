import { Logger } from "pino";
import { Store } from "@walletconnect/core";
import { ICore } from "@walletconnect/types";
import { CHAT_CLIENT_STORAGE_PREFIX } from "../constants";

// FIXME: `StoreStruct` is opinionated towards SignClient data types -> make it agnostic.
// StoreStruct = SessionTypes.Struct | PairingTypes.Struct | ProposalTypes.Struct;
// @ts-expect-error - debugging extension of core
export class ChatKeys extends Store<string, any> {
  constructor(public core: ICore, public logger: Logger) {
    // @ts-expect-error - debugging extension of core
    super(core, logger, "chat_keys", CHAT_CLIENT_STORAGE_PREFIX);
  }
}
