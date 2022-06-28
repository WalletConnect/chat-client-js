import { Core } from "@walletconnect/core";
import {
  generateChildLogger,
  getDefaultLoggerOptions,
} from "@walletconnect/logger";
import { ICore } from "@walletconnect/types";
import EventEmitter from "events";
import pino from "pino";

import {
  ChatMessages,
  ChatEngine,
  JsonRpcHistory,
  ChatInvites,
  ChatThreads,
} from "./controllers";
import { IChatClient } from "./types";

// @ts-expect-error - still missing some method implementations
export class ChatClient extends IChatClient {
  public readonly name = "chatClient";

  public core: ICore;
  public events = new EventEmitter();
  public logger: IChatClient["logger"];
  public chatInvites: IChatClient["chatInvites"];
  public chatThreads: IChatClient["chatThreads"];
  public chatMessages: IChatClient["chatMessages"];
  public engine: IChatClient["engine"];
  public history: IChatClient["history"];

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
    this.chatInvites = new ChatInvites(this.core, this.logger);
    this.chatThreads = new ChatThreads(this.core, this.logger);
    this.chatMessages = new ChatMessages(this.core, this.logger);
    this.history = new JsonRpcHistory(this.core, this.logger);
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

  // TODO: Implement
  public invite() {
    return Promise.resolve(-1);
  }

  public accept() {
    return Promise.resolve("");
  }

  public reject() {
    return Promise.resolve();
  }

  public message: IChatClient["message"] = async (params) => {
    try {
      return await this.engine.sendMessage(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
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
      await this.chatMessages.init();
      await this.history.init();
      await this.engine.init();
      this.logger.info(`ChatClient Initialization Success`);
    } catch (error: any) {
      this.logger.info(`ChatClient Initialization Failure`);
      this.logger.error(error.message);
      throw error;
    }
  }
}
