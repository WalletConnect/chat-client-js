import { ICore, IStore, CoreTypes } from "@walletconnect/types";
import EventEmitter from "events";
import { Logger } from "@walletconnect/logger";
import { IChatEngine } from "./engine";

export declare namespace ChatClientTypes {
  interface Options extends CoreTypes.Options {
    core?: ICore;
  }

  // ---------- Data Types ----------------------------------------------- //
  interface Invite {
    message: string; // character limit is 200. Must be checked by SDK before sending
    inviterAccount: string;
    inviteeAccount: string;
    inviteePublicKey: string;
  }

  interface SentInvite {
    id: number;
    message: string; // character limit is 200
    inviterAccount: string;
    inviteeAccount: string;
    status: "pending" | "rejected";
  }

  interface ReceivedInvite {
    id: number; // invite request RPC ID
    message: string; // character limit is 200.
    inviterAccount: string;
    inviteeAccount: string;
    inviterPublicKey: string;
    inviteePublicKey: string;
  }

  interface Media {
    type: string;
    data: string; // character limit is 500.
  }

  interface Message {
    topic: string;
    message: string;
    authorAccount: string;
    timestamp: number;
    media?: Media;
  }

  interface Thread {
    topic: string;
    selfAccount: string;
    peerAccount: string;
  }

  interface PendingThread {
    topic: string | null;
    selfAccount: string;
    peerAccount: string;
  }

  interface Contact {
    accountId: string;
    publicKey: string;
    displayName?: string;
  }

  interface ChatKey {
    _key: string;
    account: string | null;
    publicKey: string | null;
  }
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

export abstract class IChatClient {
  public abstract readonly name: string;

  public abstract core: ICore;
  public abstract events: EventEmitter;
  public abstract logger: Logger;
  public abstract chatReceivedInvites: IStore<
    number,
    ChatClientTypes.ReceivedInvite
  >;
  public abstract chatSentInvites: IStore<number, ChatClientTypes.SentInvite>;
  public abstract chatContacts: IStore<string, ChatClientTypes.Contact>;
  public abstract chatThreads: IStore<string, ChatClientTypes.Thread>;
  public abstract chatThreadsPending: IStore<
    string,
    ChatClientTypes.PendingThread
  >;
  public abstract chatMessages: IStore<
    string,
    { messages: ChatClientTypes.Message[]; topic: string }
  >;
  public abstract chatKeys: IStore<
    string,
    {
      identityKeyPub: string;
      identityKeyPriv: string;
      inviteKeyPub: string;
      inviteKeyPriv: string;
    }
  >;
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
