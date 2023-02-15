import { ICore, IStore, CoreTypes } from "@walletconnect/types";
import EventEmitter from "events";
import { Logger } from "@walletconnect/logger";
import { IChatEngine } from "./engine";
import { z } from "zod";

export const ZAccount = z.string().regex(/.*:.*:.*/, {
  message: `Must be valid address with chain specifier.`,
});

const ZPublicKey = z.string().max(100);

export const ZInvite = z.object({
  message: z.string().max(200),
  inviterAccount: ZAccount,
  inviteeAccount: ZAccount,
  inviteePublicKey: ZPublicKey,
});

export const ZMedia = z.object({
  type: z.string().max(20),
  data: z.string().max(500),
});

export const ZSentInvite = z.object({
  id: z.number(),
  message: z.string().max(200),
  inviterAccount: ZAccount,
  inviteeAccount: ZAccount,
  responseTopic: z.string().max(80),
  status: z.enum(["pending", "rejected", "accepted"]),
});

export const ZReceivedInvite = z.object({
  id: z.number(),
  message: z.string().max(200),
  inviterAccount: ZAccount,
  inviteeAccount: ZAccount,
  inviterPublicKey: ZPublicKey,
  inviteePublicKey: ZPublicKey,
});

export const ZMessage = z.object({
  topic: z.string().max(80),
  message: z.string().max(2000),
  authorAccount: ZAccount,
  timestamp: z.number(),
  media: ZMedia.nullish(),
});

export const ZThread = z.object({
  topic: z.string().max(80),
  selfAccount: ZAccount,
  peerAccount: ZAccount,
});

export const ZPendingThread = z.object({
  topic: z.string().max(80).nullable(),
  selfAccount: ZAccount,
  peerAccount: ZAccount,
});

export const ZContact = z.object({
  accountId: ZAccount,
  publicKey: ZPublicKey,
  displayName: z.string().max(40).or(z.undefined()),
});

export const ZChatKey = z.object({
  _key: z.string(),
  account: ZAccount,
  publicKey: ZPublicKey,
});

export declare namespace ChatClientTypes {
  interface Options extends CoreTypes.Options {
    core?: ICore;
    keyseverUrl?: string;
  }

  // ---------- Data Types ----------------------------------------------- //

  type Invite = z.infer<typeof ZInvite>;

  type SentInvite = z.infer<typeof ZSentInvite>;

  type ReceivedInvite = z.infer<typeof ZReceivedInvite>;

  type Media = z.infer<typeof ZMedia>;

  type Message = z.infer<typeof ZMessage>;

  type Thread = z.infer<typeof ZThread>;

  type PendingThread = z.infer<typeof ZPendingThread>;

  type Contact = z.infer<typeof ZContact>;

  type ChatKey = z.infer<typeof ZChatKey>;

  // ---------- Event Types ----------------------------------------------- //

  type Event =
    | "chat_invite"
    | "chat_joined"
    | "chat_message"
    | "chat_ping"
    | "chat_left";

  interface BaseEventArgs<T = unknown> {
    id: number;
    topic: string;
    params: T;
  }

  interface EventArguments {
    chat_invite: BaseEventArgs<Invite>;
    chat_joined: Omit<BaseEventArgs, "params">;
    chat_message: BaseEventArgs<Message>;
    chat_ping: Omit<BaseEventArgs, "params">;
    chat_left: Omit<BaseEventArgs, "params">;
  }
}

export interface IdentityKeychain {
  identityKeyPub: string;
  accountId: string;
  identityKeyPriv: string;
  inviteKeyPub: string;
  inviteKeyPriv: string;
}

export abstract class IChatClient {
  public abstract readonly name: string;
  public abstract readonly keyserverUrl: string;

  public abstract core: ICore;
  public abstract events: EventEmitter;
  public abstract logger: Logger;
  public abstract chatReceivedInvites: IStore<
    number,
    ChatClientTypes.ReceivedInvite
  >;
  public abstract chatSentInvites: IStore<string, ChatClientTypes.SentInvite>;
  public abstract chatContacts: IStore<string, ChatClientTypes.Contact>;
  public abstract chatThreads: IStore<string, ChatClientTypes.Thread>;
  public abstract chatMessages: IStore<
    string,
    { messages: ChatClientTypes.Message[]; topic: string }
  >;
  public abstract chatKeys: IStore<string, IdentityKeychain>;
  public abstract engine: IChatEngine;

  constructor(public opts?: ChatClientTypes.Options) {}

  // ---------- Public Methods ----------------------------------------------- //

  // register a blockchain account with a public key / returns the public key
  public abstract register(params: {
    account: string;
    onSign: (message: string) => Promise<string>;
    private?: boolean;
  }): Promise<string>;

  public abstract resolve(params: { account: string }): Promise<string>;

  // sends a chat invite to peer account / returns an invite id
  public abstract invite(params: ChatClientTypes.Invite): Promise<number>;

  // accepts a chat invite by id / returns thread topic
  public abstract accept(params: { id: number }): Promise<string>;

  // rejects a chat invite by id
  public abstract reject(params: { id: number }): Promise<void>;

  // sends a chat message to an active chat thread
  public abstract message(params: ChatClientTypes.Message): Promise<void>;

  // ping chat peer to evaluate if it's currently online
  public abstract ping(params: { topic: string }): Promise<void>;

  // leaves a chat thread and stops receiving messages
  public abstract leave(params: { topic: string }): Promise<void>;

  // // adds peer account with public key
  // public abstract addContact(params: {
  //   account: string;
  //   publicKey: string;
  // }): Promise<void>;

  // returns all sent invites matching an account / returns maps of invites indexed by id
  public abstract getSentInvites(params: {
    account: string;
  }): ChatClientTypes.SentInvite[];

  // returns all received invites matching an account / returns maps of invites indexed by id
  public abstract getReceivedInvites(params: {
    account: string;
  }): ChatClientTypes.ReceivedInvite[];

  // returns all threads matching an account / returns map of threads indexed by topic
  public abstract getThreads(params?: {
    account: string;
  }): Map<string, ChatClientTypes.Thread>;

  // returns all messages matching a thread's topic / returns array of messages
  public abstract getMessages(params: {
    topic: string;
  }): ChatClientTypes.Message[];

  public abstract addContact(params: {
    account: string;
    publicKey: string;
  }): void;

  // ---------- Event Handlers ----------------------------------------------- //

  public abstract emit: <E extends ChatClientTypes.Event>(
    event: E,
    args: ChatClientTypes.EventArguments[E]
  ) => boolean;

  public abstract on: <E extends ChatClientTypes.Event>(
    event: E,
    listener: (args: ChatClientTypes.EventArguments[E]) => any
  ) => EventEmitter;

  public abstract once: <E extends ChatClientTypes.Event>(
    event: E,
    listener: (args: ChatClientTypes.EventArguments[E]) => any
  ) => EventEmitter;

  public abstract off: <E extends ChatClientTypes.Event>(
    event: E,
    listener: (args: ChatClientTypes.EventArguments[E]) => any
  ) => EventEmitter;

  public abstract removeListener: <E extends ChatClientTypes.Event>(
    event: E,
    listener: (args: ChatClientTypes.EventArguments[E]) => any
  ) => EventEmitter;
}
