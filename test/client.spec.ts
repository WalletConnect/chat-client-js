import { ChatClient } from "../src/client";

describe("ChatClient", () => {
  let client: ChatClient;

  beforeAll(async () => {
    client = await ChatClient.init({ logger: "debug" });
  });

  it("can be instantiated", async () => {
    expect(client instanceof ChatClient).toBe(true);
    expect(client.core).toBeDefined();
    expect(client.events).toBeDefined();
    expect(client.logger).toBeDefined();
    expect(client.chatMessages).toBeDefined();
  });

  it("can register an account on the keyserver", async () => {
    const publicKey = await client.register({
      account: "eip:1:0xf07A0e1454771826472AE22A212575296f309c8C",
    });

    expect(publicKey.length).toBeGreaterThan(0);
  });

  it("can resolve an account on the keyserver", async () => {
    const publicKey = await client.resolve({
      account: "eip:1:0xf07A0e1454771826472AE22A212575296f309c8C",
    });

    expect(publicKey.length).toBeGreaterThan(0);
  });

  it.skip("can send messages", async () => {
    client.on("chat_message", async (args) => {
      console.log("chat_message event:", args);
    });

    await client.message({
      topic: "123abc",
      payload: {
        message: "some message",
        authorAccount: "0xabc",
        timestamp: 123,
      },
    });
  });
});
