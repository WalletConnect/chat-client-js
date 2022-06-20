import { Core } from "@walletconnect/core";

export class ChatClient {
  public core: any;

  constructor() {
    this.core = new Core();
  }
}
