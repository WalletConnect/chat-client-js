import { ICore } from "@walletconnect/types";
import EventEmitter from "events";

/**
 * Data Types
 */
export declare namespace ChatClientTypes {
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
}

/**
 * Abstract Classes
 */
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

  // ---------- Public Events ----------------------------------------------- //

  //  // subscribe to new chat invites received
  //  public abstract on("chat_invite", ({ id: number, invite: Invite }) => {}): void;

  //  // subscribe to new chat thread joined
  //  public abstract on("chat_joined",  ({ topic: string }) => {}): void;

  //  // subscribe to new chat messages received
  //  public abstract on("chat_message", ({ topic: string, message: string }) => {}): void;

  //  // subscribe to new chat thread left
  //  public abstract on("chat_left", ({ topic: string }) => {}): void;
}
