import { IStore } from "@walletconnect/types";
import { ChatClientTypes } from "./client";

export type IChatMessages = IStore<
  string,
  { messages: ChatClientTypes.Message[]; topic: string }
>;
