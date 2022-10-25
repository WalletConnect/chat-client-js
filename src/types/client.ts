import { ICore, IJsonRpcHistory, IStore } from "@walletconnect/types";
import EventEmitter from "events";
import { Logger } from "pino";
import { IChatInvites } from "./chatInvites";
import { IChatMessages } from "./chatMessages";
import { IChatThreads } from "./chatThreads";
import { IChatThreadsPending } from "./chatThreadsPending";
import { IChatEngine } from "./engine";

export declare namespace ChatClientTypes {
  // ---------- Data Types ----------------------------------------------- //
  interface PartialInvite {
    message: string;
    account: string;
    signature?: string;
  }

  interface Invite extends PartialInvite {
    publicKey: string;
  }

  interface Media {
    type: string;
    data: string;
  }

  interface Message {
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

  // ---------- Event Types ----------------------------------------------- //

  type Event = "chat_invite" | "chat_joined" | "chat_message" | "chat_left";

  interface BaseEventArgs<T = unknown> {
    id: number;
    topic: string;
    params: T;
  }

  interface EventArguments {
    chat_invite: BaseEventArgs<Invite>;
    chat_joined: Omit<BaseEventArgs, "params">;
    chat_message: BaseEventArgs<Message>;
    chat_left: Omit<BaseEventArgs, "params">;
  }
}

export abstract class IChatClient {
  public abstract readonly name: string;

  public abstract core: ICore;
  public abstract events: EventEmitter;
  public abstract logger: Logger;
  public abstract chatInvites: IChatInvites;
  public abstract chatThreads: IChatThreads;
  public abstract chatThreadsPending: IChatThreadsPending;
  public abstract chatMessages: IChatMessages;
  public abstract chatKeys: IStore<string, any>;
  public abstract engine: IChatEngine;
  public abstract history: IJsonRpcHistory;

  constructor(public opts?: Record<string, any>) {}

  // ---------- Public Methods ----------------------------------------------- //

  // register a blockchain account with a public key / returns the public key
  public abstract register(params: {
    account: string;
    private?: boolean;
  }): Promise<string>;

  public abstract resolve(params: { account: string }): Promise<string>;

  // sends a chat invite to peer account / returns an invite id
  public abstract invite(params: {
    account: string;
    invite: ChatClientTypes.PartialInvite;
  }): Promise<number>;

  // accepts a chat invite by id / returns thread topic
  public abstract accept(params: { id: number }): Promise<string>;

  // rejects a chat invite by id
  public abstract reject(params: { id: number }): Promise<void>;

  // sends a chat message to an active chat thread
  public abstract message(params: {
    topic: string;
    payload: ChatClientTypes.Message;
  }): Promise<void>;

  // TODO: implement
  // // ping its peer to evaluate if it's currently online
  // public abstract ping(params: { topic: string }): Promise<void>;

  // // leaves a chat thread and stops receiving messages
  // public abstract leave(params: { topic: string }): Promise<void>;

  // // adds peer account with public key
  // public abstract addContact(params: {
  //   account: string;
  //   publicKey: string;
  // }): Promise<void>;

  // // returns all invites matching an account / returns maps of invites indexed by id
  public abstract getInvites(): Map<number, ChatClientTypes.Invite>;

  // // returns all threads matching an account / returns map of threads indexed by topic
  public abstract getThreads(): Map<string, ChatClientTypes.Thread>;

  // // returns all messages matching a thread's topic / returns array of messages
  public abstract getMessages(params: {
    topic: string;
  }): ChatClientTypes.Message[];

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
