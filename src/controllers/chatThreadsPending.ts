import { Logger } from "pino";
import { Store } from "@walletconnect/core";
import { ICore } from "@walletconnect/types";
import {
  CHAT_CLIENT_STORAGE_PREFIX,
  CHAT_THREADS_PENDING_CONTEXT,
} from "../constants";

// FIXME: `StoreStruct` is opinionated towards SignClient data types -> make it agnostic.
// StoreStruct = SessionTypes.Struct | PairingTypes.Struct | ProposalTypes.Struct;
export class ChatThreadsPending extends Store<string, any> {
  constructor(public core: ICore, public logger: Logger) {
    super(
      core,
      logger,
      CHAT_THREADS_PENDING_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
  }
}
