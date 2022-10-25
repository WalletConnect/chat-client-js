import { IStore } from "@walletconnect/types";
import { ChatClientTypes } from "./client";

export type IChatThreadsPending = IStore<string, ChatClientTypes.PendingThread>;
