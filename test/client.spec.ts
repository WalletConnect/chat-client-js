import { ChatClient } from "../src/client";

describe("ChatClient", () => {
  it("can be instantiated", async () => {
    const client = await ChatClient.init({ logger: "debug" });
    expect(client instanceof ChatClient).toBe(true);
    expect(client.core).toBeDefined();
    expect(client.events).toBeDefined();
    expect(client.logger).toBeDefined();

    client.on("chat_message", (args) => {
      console.log("chat_message args were:", args);
    });
    client.emit("chat_message", {
      id: 123,
      topic: "123abc",
      params: {
        payload: { message: "", authorAccount: "0xabc", timestamp: 123 },
      },
    });
  });
});
