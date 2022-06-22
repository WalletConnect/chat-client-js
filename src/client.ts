import { Core } from "@walletconnect/core";
import {
  generateChildLogger,
  getDefaultLoggerOptions,
} from "@walletconnect/logger";
import { ICore } from "@walletconnect/types";
import EventEmitter from "events";
import pino from "pino";

import { IChatClient } from "./types/client";

// @ts-expect-error - still missing some method implementations
export class ChatClient extends IChatClient {
  public readonly name = "chatClient";

  public core: ICore;
  public events = new EventEmitter();
  public logger;

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

    this.core = new Core();
    this.logger = generateChildLogger(logger, this.name);
  }

  // ---------- Public Methods ----------------------------------------------- //

  // TODO: Implement
  // initializes the client with persisted storage and a network connection
  public init() {
    return Promise.resolve();
  }

  // TODO: Implement
  // register a blockchain account with a public key / returns the public key
  public register() {
    return Promise.resolve("");
  }

  // TODO: Implement
  // sends a chat invite to peer account / returns an invite id
  public invite() {
    return Promise.resolve(-1);
  }

  // accepts a chat invite by id / returns thread topic
  public accept() {
    return Promise.resolve("");
  }

  // rejects a chat invite by id
  public reject() {
    return Promise.resolve();
  }

  // ---------- Events ----------------------------------------------- //

  // TODO: use stronger typing to restrict listeners to known events
  public on = this.events.on;
  public once = this.events.once;
  public off = this.events.off;
  public removeListener = this.events.removeListener;
}
