import { ChatClient } from "../src/client";

describe("ChatClient", () => {
  it("can be instantiated", async () => {
    const client = await ChatClient.init({ logger: "debug" });
    expect(client instanceof ChatClient).toBe(true);
    expect(client.core).toBeDefined();
    expect(client.events).toBeDefined();
    expect(client.logger).toBeDefined();
    expect(client.chatMessages).toBeDefined();

    client.on("chat_message", async (args) => {
      console.log("chat_message args were:", args);
      await client.chatMessages.set(args.topic, args.params);
      const storedMessage = client.chatMessages.get(args.topic);
      console.log("storedMessage:", storedMessage);
    });

    client.emit("chat_message", {
      id: 123,
      topic: "123abc",
      params: { message: "", authorAccount: "0xabc", timestamp: 123 },
    });
  });
});
