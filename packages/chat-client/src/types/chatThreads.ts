import { IStore } from "@walletconnect/types";
import { ChatClientTypes } from "./client";

export type IChatThreads = IStore<string, ChatClientTypes.Thread>;
