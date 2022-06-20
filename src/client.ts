import { Core } from "@walletconnect/core";
import { ICore } from "@walletconnect/types";
import EventEmitter from "events";

export class ChatClient {
  public core: ICore;
  public events = new EventEmitter();

  constructor() {
    this.core = new Core();
  }

  // ---------- Events ----------------------------------------------- //

  public on: EventEmitter["on"] = (name, listener) => {
    return this.events.on(name, listener);
  };

  public once: EventEmitter["once"] = (name, listener) => {
    return this.events.once(name, listener);
  };

  public off: EventEmitter["off"] = (name, listener) => {
    return this.events.off(name, listener);
  };

  public removeListener: EventEmitter["removeListener"] = (name, listener) => {
    return this.events.removeListener(name, listener);
  };
}
