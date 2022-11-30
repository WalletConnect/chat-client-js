import { IStore } from "@walletconnect/types";
import { ChatClientTypes } from "./client";

export type IChatInvites = IStore<number, ChatClientTypes.Invite>;
