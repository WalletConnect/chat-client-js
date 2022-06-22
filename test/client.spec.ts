import { ChatClient } from "../src/client";

describe("ChatClient", () => {
  it("can be instantiated", () => {
    const client = new ChatClient({ logger: "debug" });
    expect(client instanceof ChatClient).toBe(true);
    expect(client.core).toBeDefined();
    expect(client.events).toBeDefined();
    expect(client.logger).toBeDefined();

    client.events.on("chat_message", () => {
      console.log("yo");
    });
    client.events.emit("chat_message");

    client.logger.info("logger error");
  });
});
