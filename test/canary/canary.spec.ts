import { ChatClient } from "../../src/client";
import { ChatClientTypes } from "../../src/types";
import { disconnectSocket } from "./../helpers/ws";

const TEST_CLIENT_ACCOUNT =
  "eip155:1:0xf07A0e1454771826472AE22A212575296f309c8C";
const TEST_PEER_ACCOUNT = "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5881F";

describe("ChatClient Canary", () => {
  let client: ChatClient;
  let peer: ChatClient;
  // const environment = process.env.ENVIRONMENT || "dev";
  // const region = process.env.REGION || "unknown";

  let registerAddressLatencyMs: number,
    resolveAddressLatencyMs: number,
    chatInviteLatencyMs: number,
    chatJoinedLatencyMs: number,
    chatMessageLatencyMs: number,
    chatLeaveLatencyMs = 0;
  const start = Date.now();
  beforeEach(async () => {
    client = await ChatClient.init({
      logger: "error",
      relayUrl: process.env.TEST_RELAY_URL || "wss://relay.walletconnect.com",
      projectId: process.env.TEST_PROJECT_ID,
      storageOptions: {
        database: ":memory:",
      },
    });

    peer = await ChatClient.init({
      logger: "error",
      relayUrl: process.env.TEST_RELAY_URL || "wss://relay.walletconnect.com",
      projectId: process.env.TEST_PROJECT_ID,
      storageOptions: {
        database: ":memory:",
      },
    });
  });

  afterEach(() => {
    disconnectSocket(client.core);
    disconnectSocket(peer.core);
  });

  it("can be instantiated", async () => {
    expect(client instanceof ChatClient).toBe(true);
    expect(client.core).toBeDefined();
    expect(client.events).toBeDefined();
    expect(client.logger).toBeDefined();
    expect(client.chatMessages).toBeDefined();
  });

  it("should register -> resolve -> send message -> leave chat", async () => {
    const publicKey = await client.register({
      account: TEST_CLIENT_ACCOUNT,
    });
    const peerPublicKey = await peer.register({
      account: TEST_PEER_ACCOUNT,
    });
    registerAddressLatencyMs = Date.now() - start;
    expect(publicKey.length).toBeGreaterThan(0);
    expect(peerPublicKey.length).toBeGreaterThan(0);

    const resolvedPublicKey = await peer.resolve({
      account: TEST_CLIENT_ACCOUNT,
    });
    const resolvedPeerPublicKey = await client.resolve({
      account: TEST_PEER_ACCOUNT,
    });
    resolveAddressLatencyMs = Date.now() - start;
    expect(resolvedPublicKey.length).toBeGreaterThan(0);
    expect(resolvedPeerPublicKey.length).toBeGreaterThan(0);

    let topic = "";

    await Promise.all([
      new Promise<void>((resolve) => {
        peer.on("chat_invite", async (args) => {
          chatInviteLatencyMs = Date.now() - start;
          const { id } = args;
          const chatThreadTopic = await peer.accept({ id });
          expect(chatThreadTopic).toBeDefined();
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        client.on("chat_joined", async (args) => {
          chatJoinedLatencyMs = Date.now() - start;
          topic = args.topic;
          expect(args.topic).toBeDefined();
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        const invite: ChatClientTypes.PartialInvite = {
          message: "hey let's chat",
          account: TEST_CLIENT_ACCOUNT,
        };

        client.invite({
          account: TEST_PEER_ACCOUNT,
          invite,
        });
        resolve();
      }),
    ]);

    const clientMessagePayload = {
      message: "Hey there peer!",
      authorAccount: TEST_CLIENT_ACCOUNT,
      timestamp: Date.now(),
    };

    const peerMessagePayload = {
      message: "Hey there client!",
      authorAccount: TEST_PEER_ACCOUNT,
      timestamp: Date.now(),
    };

    await Promise.all([
      new Promise<void>((resolve) => {
        peer.on("chat_message", (event) => {
          chatMessageLatencyMs = Date.now() - start;
          expect(clientMessagePayload).toMatchObject(event.params);
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        client.on("chat_message", (event) => {
          expect(peerMessagePayload).toMatchObject(event.params);
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        client.message({ topic, payload: clientMessagePayload });
        peer.message({ topic, payload: peerMessagePayload });
        resolve();
      }),
    ]);

    expect(peer.chatThreads.getAll().length).toBeGreaterThan(0);

    await Promise.all([
      new Promise<void>((resolve) => {
        peer.on("chat_left", (event) => {
          chatLeaveLatencyMs = Date.now() - start;
          expect(event.topic).toMatch(topic);
          expect(peer.chatThreads.getAll()).toMatchObject([]);
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        client.leave({ topic });
        resolve();
      }),
    ]);

    console.log("ms delay", {
      registerAddressLatencyMs,
      resolveAddressLatencyMs,
      chatInviteLatencyMs,
      chatJoinedLatencyMs,
      chatMessageLatencyMs,
      chatLeaveLatencyMs,
    });
  });
});