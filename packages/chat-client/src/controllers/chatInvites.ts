import { Logger } from "pino";
import { Store } from "@walletconnect/core";
import { ICore } from "@walletconnect/types";
import { CHAT_CLIENT_STORAGE_PREFIX, CHAT_INVITES_CONTEXT } from "../constants";
import { ChatClientTypes } from "../types";

export class ChatInvites extends Store<number, ChatClientTypes.Invite> {
  constructor(public core: ICore, public logger: Logger) {
    super(
      core,
      logger,
      CHAT_INVITES_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX,
      (invite: ChatClientTypes.Invite) => invite.id
    );
  }
}
