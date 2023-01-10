import { Core, Store } from "@walletconnect/core";
import pino from "pino";
import {
  generateChildLogger,
  getDefaultLoggerOptions,
} from "@walletconnect/logger";
import { ICore } from "@walletconnect/types";
import EventEmitter from "events";
import {
  CHAT_CLIENT_CONTEXT,
  CHAT_CLIENT_STORAGE_PREFIX,
  CHAT_MESSAGES_CONTEXT,
  CHAT_THREADS_CONTEXT,
  CHAT_THREADS_PENDING_CONTEXT,
  CHAT_CONTACTS_CONTEXT,
} from "./constants";
import { CHAT_KEYS_CONTEXT } from "./constants/chatKeys";

import { ChatEngine } from "./controllers";
import { ChatClientTypes, IChatClient } from "./types";

// FIXME: ChatClient not reading existing chatMessages from localStorage for some reason.
export class ChatClient extends IChatClient {
  public readonly name = "chatClient";

  public core: ICore;
  public events = new EventEmitter();
  public logger: IChatClient["logger"];
  public chatInvites: IChatClient["chatInvites"];
  public chatThreads: IChatClient["chatThreads"];
  public chatThreadsPending: IChatClient["chatThreadsPending"];
  public chatMessages: IChatClient["chatMessages"];
  public chatContacts: IChatClient["chatContacts"];
  public chatKeys: IChatClient["chatKeys"];
  public engine: IChatClient["engine"];

  static async init(opts?: Record<string, any>) {
    const client = new ChatClient(opts);
    await client.initialize();

    return client;
  }

  constructor(opts?: Record<string, any>) {
    super(opts);

    const logger =
      typeof opts?.logger !== "undefined" && typeof opts?.logger !== "string"
        ? opts.logger
        : pino(
            getDefaultLoggerOptions({
              level: opts?.logger || "error",
            })
          );

    this.core = new Core(opts);
    this.logger = generateChildLogger(logger, this.name);
    this.chatInvites = new Store(
      this.core,
      this.logger,
      CHAT_CLIENT_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX,
      (invite: ChatClientTypes.Invite) => invite.id
    );
    this.chatThreads = new Store(
      this.core,
      this.logger,
      CHAT_THREADS_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
    this.chatThreadsPending = new Store(
      this.core,
      this.logger,
      CHAT_THREADS_PENDING_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
    this.chatMessages = new Store(
      this.core,
      this.logger,
      CHAT_MESSAGES_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
    this.chatKeys = new Store(
      this.core,
      this.logger,
      CHAT_KEYS_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
    this.chatContacts = new Store(
      this.core,
      this.logger,
      CHAT_CONTACTS_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
    this.engine = new ChatEngine(this);
  }

  // ---------- Public Methods ----------------------------------------------- //

  public register: IChatClient["register"] = async (params) => {
    try {
      return await this.engine.register(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public resolve: IChatClient["resolve"] = async (params) => {
    try {
      return await this.engine.resolve(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public invite: IChatClient["invite"] = async (params) => {
    try {
      return await this.engine.invite(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public accept: IChatClient["accept"] = async (params) => {
    try {
      return await this.engine.accept(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public reject: IChatClient["reject"] = async (params) => {
    try {
      await this.engine.reject(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };
  public message: IChatClient["message"] = async (params) => {
    try {
      return await this.engine.sendMessage(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public ping: IChatClient["ping"] = async (params) => {
    try {
      return await this.engine.ping(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public leave: IChatClient["leave"] = async (params) => {
    try {
      return await this.engine.leave(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public getInvites: IChatClient["getInvites"] = (params) => {
    try {
      return this.chatInvites
        .getAll(
          params?.account
            ? {
                account: params.account,
              }
            : undefined
        )
        .reduce<Map<number, ChatClientTypes.Invite>>((inviteMap, invite) => {
          if (!invite.id)
            throw new Error(
              "Invites need id specified in the map values as well as the keys"
            );
          inviteMap.set(invite.id, invite);
          return inviteMap;
        }, new Map());
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public getThreads: IChatClient["getThreads"] = (params) => {
    try {
      return this.chatThreads
        .getAll(
          params?.account
            ? {
                selfAccount: params.account,
              }
            : undefined
        )
        .reduce<Map<string, ChatClientTypes.Thread>>((threadMap, thread) => {
          threadMap.set(thread.topic.toString(), thread);
          return threadMap;
        }, new Map());
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public getMessages: IChatClient["getMessages"] = ({ topic }) => {
    try {
      return this.chatMessages.get(topic).messages;
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public addContact: IChatClient["addContact"] = ({ account, publicKey }) => {
    this.chatContacts.set(account, { accountId: account, publicKey });
  };

  // ---------- Events ----------------------------------------------- //

  public emit: IChatClient["emit"] = (name, listener) => {
    return this.events.emit(name, listener);
  };

  public on: IChatClient["on"] = (name, listener) => {
    return this.events.on(name, listener);
  };

  public once: IChatClient["once"] = (name, listener) => {
    return this.events.once(name, listener);
  };

  public off: IChatClient["off"] = (name, listener) => {
    return this.events.off(name, listener);
  };

  public removeListener: IChatClient["removeListener"] = (name, listener) => {
    return this.events.removeListener(name, listener);
  };

  // ---------- Private ----------------------------------------------- //

  private async initialize() {
    this.logger.trace(`Initialized`);
    try {
      await this.core.start();
      await this.chatInvites.init();
      await this.chatThreads.init();
      await this.chatThreadsPending.init();
      await this.chatMessages.init();
      await this.chatKeys.init();
      await this.chatContacts.init();
      await this.engine.init();
      this.logger.info(`ChatClient Initialization Success`);
    } catch (error: any) {
      this.logger.info(`ChatClient Initialization Failure`);
      this.logger.error(error.message);
      throw error;
    }
  }
}
