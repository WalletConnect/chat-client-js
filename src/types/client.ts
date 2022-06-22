import { ICore } from "@walletconnect/types";
import EventEmitter from "events";
import { Logger } from "pino";

export declare namespace ChatClientTypes {
  // ---------- Data Types ----------------------------------------------- //
  interface Invite {
    message: string;
    account: string;
    signature?: string;
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

  // ---------- Event Types ----------------------------------------------- //

  type Event = "chat_invite" | "chat_joined" | "chat_message" | "chat_left";

  interface BaseEventArgs<T = unknown> {
    id: number;
    topic: string;
    params: T;
  }

  interface EventArguments {
    chat_invite: BaseEventArgs<{ id: number; invite: Invite }>;
    chat_joined: Omit<BaseEventArgs, "params">;
    chat_message: BaseEventArgs<{ payload: Message }>;
    chat_left: Omit<BaseEventArgs, "params">;
  }
}

export abstract class IChatClient {
  public abstract readonly name: string;

  public abstract core: ICore;
  public abstract events: EventEmitter;
  public abstract logger: Logger;

  constructor(public opts?: Record<string, any>) {}

  // ---------- Public Methods ----------------------------------------------- //

  public abstract init(): Promise<void>;

  public abstract register(params: {
    account: string;
    private?: boolean;
  }): Promise<string>;

  public abstract resolve(params: { account: string }): Promise<string>;

  // sends a chat invite to peer account / returns an invite id
  public abstract invite(params: {
    account: string;
    invite: ChatClientTypes.Invite;
  }): Promise<number>;

  // accepts a chat invite by id / returns thread topic
  public abstract accept(params: { inviteId: string }): Promise<string>;

  // rejects a chat invite by id
  public abstract reject(params: { inviteId: string }): Promise<void>;

  // sends a chat message to an active chat thread
  public abstract message(params: {
    topic: string;
    message: string;
    media?: ChatClientTypes.Media;
  }): Promise<void>;

  // ping its peer to evaluate if it's currently online
  public abstract ping(params: { topic: string }): Promise<void>;

  // leaves a chat thread and stops receiving messages
  public abstract leave(params: { topic: string }): Promise<void>;

  // adds peer account with public key
  public abstract addContact(params: {
    account: string;
    publicKey: string;
  }): Promise<void>;

  // returns all invites matching an account / returns maps of invites indexed by id
  public abstract getInvites(params: {
    account: string;
  }): Promise<Map<string, ChatClientTypes.Invite>>;

  // returns all threads matching an account / returns map of threads indexed by topic
  public abstract getThreads(params: {
    account: string;
  }): Promise<Map<string, ChatClientTypes.Thread>>;

  // returns all messages matching a thread's topic / returns array of messages
  public abstract getMessages(params: {
    topic: string;
  }): Promise<ChatClientTypes.Message[]>;

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
