import { generateRandomBytes32 } from "@walletconnect/utils";
import { ChatClient } from "../src/client";
import { ChatClientTypes } from "../src/types";
import { disconnectSocket } from "./helpers/ws";

const TEST_CLIENT_ACCOUNT =
  "eip155:1:0xf07A0e1454771826472AE22A212575296f309c8C";
const TEST_PEER_ACCOUNT = "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5881F";

// Polls boolean value every interval to check for an event callback having been triggered.
const waitForEvent = async (checkForEvent: (...args: any[]) => boolean) => {
  await new Promise((resolve) => {
    const intervalId = setInterval(() => {
      if (checkForEvent()) {
        clearInterval(intervalId);
        resolve({});
      }
    }, 100);
  });
};

describe("ChatClient", () => {
  let client: ChatClient;
  let peer: ChatClient;

  beforeEach(async () => {
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

  afterEach(async () => {
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
    let peerReceivedInvite = false;
    let peerJoinedChat = false;

    const peerInvitePublicKey = await peer.register({
      account: TEST_PEER_ACCOUNT,
    });

    client.resolve = jest.fn(() => Promise.resolve(peerInvitePublicKey));

    peer.on("chat_invite", async (args) => {
      const { id } = args;
      console.log("chat_invite:", args);
      const chatThreadTopic = await peer.accept({ id });
      expect(chatThreadTopic).toBeDefined();
      peerReceivedInvite = true;
    });

    client.on("chat_joined", async (args) => {
      const { topic } = args;
      console.log("chat_joined:", args);
      expect(topic).toBeDefined();
      peerJoinedChat = true;
    });

    const invite: ChatClientTypes.PartialInvite = {
      message: "hey let's chat",
      account: TEST_CLIENT_ACCOUNT,
    };

    const inviteId = await client.invite({
      account: TEST_PEER_ACCOUNT,
      invite,
    });

    await waitForEvent(() => peerReceivedInvite && peerJoinedChat);

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

    await waitForEvent(() => eventCount === 2);

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

  describe("ping", () => {
    it("can ping a known chat peer", async () => {
      // TODO: abstract this step, it duplicates the invite test above.
      // Set up an acknowledged chat thread
      let chatThreadTopic = "";
      let peerReceivedInvite = false;
      let peerJoinedChat = false;

      const peerInvitePublicKey = await peer.register({
        account: TEST_PEER_ACCOUNT,
      });

      client.resolve = jest.fn(() => Promise.resolve(peerInvitePublicKey));

      peer.on("chat_invite", async (args) => {
        const { id } = args;
        console.log("chat_invite:", args);
        chatThreadTopic = await peer.accept({ id });
        expect(chatThreadTopic).toBeDefined();
        peerReceivedInvite = true;
      });

      client.on("chat_joined", async (args) => {
        const { topic } = args;
        console.log("chat_joined:", args);
        expect(topic).toBeDefined();
        peerJoinedChat = true;
      });

      const invite: ChatClientTypes.PartialInvite = {
        message: "hey let's chat",
        account: TEST_CLIENT_ACCOUNT,
      };

      await client.invite({
        account: TEST_PEER_ACCOUNT,
        invite,
      });

      await waitForEvent(() => peerReceivedInvite && peerJoinedChat);

      // Perform the ping
      let peerGotPing = false;
      peer.on("chat_ping", ({ topic }) => {
        expect(topic).toBe(chatThreadTopic);
        peerGotPing = true;
      });

      await client.ping({ topic: chatThreadTopic });
      await waitForEvent(() => peerGotPing);
    });
  });

  describe("getInvites", () => {
    it("returns all current invites", async () => {
      const mockInviteId = 1666697147892830;
      const mockInvite = {
        message: "hey let's chat",
        account: "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5881F",
        publicKey:
          "511dc223dcf4b4a0148009785fe5c247d4e9ece7e8bd83db3082d6f1cdc07e16",
      };
      await client.chatInvites.set(mockInviteId, mockInvite);

      expect(client.getInvites().size).toBe(1);
      expect(client.getInvites().get(mockInviteId)).toEqual(mockInvite);
    });
  });

  describe("getThreads", () => {
    it("returns all currently active chat threads", async () => {
      const mockChatThread = {
        topic: generateRandomBytes32(),
        selfAccount: "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5881F",
        peerAccount: "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5FFFF",
      };
      await client.chatThreads.set(mockChatThread.topic, mockChatThread);

      expect(client.getThreads().size).toBe(1);
      expect(client.getThreads().get(mockChatThread.topic)).toEqual(
        mockChatThread
      );
    });
  });

  describe("getMessages", () => {
    it("returns all messages for a given thread topic", async () => {
      const topic = generateRandomBytes32();
      const mockChatMessages = [
        {
          message: "eyo",
          authorAccount: "eip155:3:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb",
          timestamp: 1666697158617,
        },
        {
          message: "sup",
          authorAccount: "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5881F",
          timestamp: 1666697164166,
        },
      ];
      await client.chatMessages.set(topic, {
        messages: mockChatMessages,
      });

      expect(client.getMessages({ topic }).length).toBe(
        mockChatMessages.length
      );
      expect(client.getMessages({ topic })).toEqual(mockChatMessages);
    });
  });
});
