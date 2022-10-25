import { generateRandomBytes32 } from "@walletconnect/utils";
import { ChatClient } from "../src/client";
import { ChatClientTypes } from "../src/types";

const TEST_CLIENT_ACCOUNT =
  "eip155:1:0xf07A0e1454771826472AE22A212575296f309c8C";
const TEST_PEER_ACCOUNT = "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5881F";

describe("ChatClient", () => {
  let client: ChatClient;
  let peer: ChatClient;

  beforeAll(async () => {
    client = await ChatClient.init({
      logger: "error",
      relayUrl:
        process.env.TEST_RELAY_URL || "wss://staging.relay.walletconnect.com",
      projectId: process.env.TEST_PROJECT_ID,
      storageOptions: {
        database: ":memory:",
      },
    });

    peer = await ChatClient.init({
      logger: "error",
      relayUrl:
        process.env.TEST_RELAY_URL || "wss://staging.relay.walletconnect.com",
      projectId: process.env.TEST_PROJECT_ID,
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

  it("can register an account on the keyserver", async () => {
    const publicKey = await client.register({
      account: TEST_CLIENT_ACCOUNT,
    });
    const peerPublicKey = await peer.register({
      account: TEST_PEER_ACCOUNT,
    });

    expect(publicKey.length).toBeGreaterThan(0);
    expect(peerPublicKey.length).toBeGreaterThan(0);
  });

  it("can resolve an account on the keyserver", async () => {
    const publicKey = await peer.resolve({
      account: TEST_CLIENT_ACCOUNT,
    });
    const peerPublicKey = await client.resolve({
      account: TEST_PEER_ACCOUNT,
    });

    expect(publicKey.length).toBeGreaterThan(0);
    expect(peerPublicKey.length).toBeGreaterThan(0);
  });

  it("can send & receive invites", async () => {
    const peerInvitePublicKey = await peer.register({
      account: TEST_PEER_ACCOUNT,
    });

    client.resolve = jest.fn(() => Promise.resolve(peerInvitePublicKey));

    peer.on("chat_invite", async (args) => {
      const { id } = args;
      console.log("chat_invite:", args);
      const chatThreadTopic = await peer.accept({ id });
      expect(chatThreadTopic).toBeDefined();
    });

    client.on("chat_joined", async (args) => {
      const { topic } = args;
      console.log("chat_joined:", args);
      expect(topic).toBeDefined();
    });

    const invite: ChatClientTypes.PartialInvite = {
      message: "hey let's chat",
      account: TEST_CLIENT_ACCOUNT,
    };

    const inviteId = await client.invite({
      account: TEST_PEER_ACCOUNT,
      invite,
    });

    expect(inviteId).toBeDefined();
  });

  it("can send & receive messages", async () => {
    const symKey = generateRandomBytes32();
    const payload = {
      message: "some message",
      authorAccount: "0xabc",
      timestamp: 123,
    };
    let eventCount = 0;

    await client.core.crypto.setSymKey(symKey);
    const topic = await peer.core.crypto.setSymKey(symKey);

    // Manually subscribe to the fake thread topic for now.
    await client.core.relayer.subscribe(topic);
    await peer.core.relayer.subscribe(topic);

    peer.on("chat_message", async () => {
      eventCount++;
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
    expect(eventCount).toBe(2);
  });
});
