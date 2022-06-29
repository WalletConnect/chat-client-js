import { generateRandomBytes32 } from "@walletconnect/utils";
import { ChatClient } from "../src/client";

const TEST_ACCOUNT = "eip:1:0xf07A0e1454771826472AE22A212575296f309c8C";

describe("ChatClient", () => {
  let client: ChatClient;
  let peer: ChatClient;

  beforeAll(async () => {
    client = await ChatClient.init({
      logger: "error",
      relayUrl: "ws://0.0.0.0:5555",
      projectId: undefined,
      storageOptions: {
        database: ":memory:",
      },
    });

    peer = await ChatClient.init({
      logger: "error",
      relayUrl: "ws://0.0.0.0:5555",
      projectId: undefined,
      storageOptions: {
        database: ":memory:",
      },
    });
  });

  it("can be instantiated", async () => {
    expect(client instanceof ChatClient).toBe(true);
    expect(client.core).toBeDefined();
    expect(client.events).toBeDefined();
    expect(client.logger).toBeDefined();
    expect(client.chatMessages).toBeDefined();
  });

  it.skip("can register an account on the keyserver", async () => {
    const publicKey = await client.register({
      account: TEST_ACCOUNT,
    });

    expect(publicKey.length).toBeGreaterThan(0);
  });

  it.skip("can resolve an account on the keyserver", async () => {
    const publicKey = await client.resolve({
      account: TEST_ACCOUNT,
    });

    expect(publicKey.length).toBeGreaterThan(0);
  });

  it("can send & receive messages", async () => {
    const symKey = generateRandomBytes32();
    const payload = {
      message: "some message",
      authorAccount: "0xabc",
      timestamp: 123,
    };

    await client.core.crypto.setSymKey(symKey);
    const topic = await peer.core.crypto.setSymKey(symKey);

    // Manually subscribe to the fake thread topic for now.
    await client.core.relayer.subscribe(topic);
    await peer.core.relayer.subscribe(topic);

    peer.on("chat_message", async (args) => {
      console.log("chat_message event:", args);
    });

    await client.message({
      topic,
      payload,
    });

    expect(client.chatMessages.keys.length).toBe(1);
    expect(client.chatMessages.get(topic)).toEqual({ messages: [payload] });
    expect(peer.chatMessages.keys.length).toBe(1);
    expect(peer.chatMessages.get(topic)).toEqual({ messages: [payload] });

    await client.message({
      topic,
      payload,
    });

    expect(client.chatMessages.keys.length).toBe(1);
    expect(client.chatMessages.get(topic)).toEqual({
      messages: [payload, payload],
    });
    expect(peer.chatMessages.keys.length).toBe(1);
    expect(peer.chatMessages.get(topic)).toEqual({
      messages: [payload, payload],
    });
  });
});
