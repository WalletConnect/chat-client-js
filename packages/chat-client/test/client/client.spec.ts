import { expect, describe, it, beforeEach, afterEach, vi } from "vitest";
import { Wallet } from "@ethersproject/wallet";
import { generateRandomBytes32 } from "@walletconnect/utils";
import ChatClient from "../../src";
import { ChatClientTypes } from "../../src/types";
import { disconnectSocket } from "../helpers/ws";

if (!process.env.TEST_PROJECT_ID) {
  throw new ReferenceError("TEST_PROJECT_ID env var not set");
}
const composeChainAddress = (address: string) => `eip155:1:${address}`;

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

const opts = {
  logger: "error",
  relayUrl:
    process.env.TEST_RELAY_URL || "wss://staging.relay.walletconnect.com",
  projectId: process.env.TEST_PROJECT_ID,
  keyserverUrl: "https://staging.keys.walletconnect.com",
  storageOptions: {
    database: ":memory:",
  },
};

describe("ChatClient", () => {
  let client: ChatClient;
  let peer: ChatClient;

  beforeEach(async () => {
    client = await ChatClient.init(opts);

    peer = await ChatClient.init(opts);
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
    const walletSelf = Wallet.createRandom();
    const walletPeer = Wallet.createRandom();
    await client.register({
      account: composeChainAddress(walletSelf.address),
      onSign: (message) => walletSelf.signMessage(message),
    });

    await peer.register({
      account: composeChainAddress(walletPeer.address),
      onSign: (message) => walletPeer.signMessage(message),
    });

    const selfKeys = client.chatKeys.get(
      composeChainAddress(walletSelf.address)
    );
    const peerKeys = peer.chatKeys.get(composeChainAddress(walletPeer.address));

    expect(selfKeys.identityKeyPub.length).toBeGreaterThan(0);
    expect(selfKeys.identityKeyPriv.length).toBeGreaterThan(0);
    expect(selfKeys.inviteKeyPub.length).toBeGreaterThan(0);
    expect(selfKeys.inviteKeyPriv.length).toBeGreaterThan(0);
    expect(peerKeys.identityKeyPub.length).toBeGreaterThan(0);
    expect(peerKeys.identityKeyPriv.length).toBeGreaterThan(0);
    expect(peerKeys.inviteKeyPub.length).toBeGreaterThan(0);
    expect(peerKeys.inviteKeyPriv.length).toBeGreaterThan(0);
  });

  it("can resolve an account on the keyserver", async () => {
    const walletSelf = Wallet.createRandom();
    const walletPeer = Wallet.createRandom();

    const peerIdentityPublicKey = await peer.register({
      account: composeChainAddress(walletPeer.address),
      onSign: (message) => walletPeer.signMessage(message),
    });

    const selfIdentityPublicKey = await client.register({
      account: `eip155:1:${walletSelf.address}`,
      onSign: (message) => walletSelf.signMessage(message),
    });

    const selfIdentityCacao = await peer.engine.resolveIdentity({
      publicKey: `${selfIdentityPublicKey}`,
    });

    const peerIdentityCacao = await client.engine.resolveIdentity({
      publicKey: `${peerIdentityPublicKey}`,
    });

    expect(selfIdentityCacao.p.iss).toEqual(
      `did:pkh:eip155:1:${walletSelf.address}`
    );
    expect(peerIdentityCacao.p.iss).toEqual(
      `did:pkh:eip155:1:${walletPeer.address}`
    );
  });

  it("Can unregister an account on the keyserver", async () => {
    const walletSelf = Wallet.createRandom();
    const walletPeer = Wallet.createRandom();

    const peerIdentityPublicKey = await peer.register({
      account: composeChainAddress(walletPeer.address),
      onSign: (message) => walletPeer.signMessage(message),
    });

    const selfIdentityPublicKey = await client.register({
      account: `eip155:1:${walletSelf.address}`,
      onSign: (message) => walletSelf.signMessage(message),
    });

    const selfIdentityCacao = await peer.engine.resolveIdentity({
      publicKey: `${selfIdentityPublicKey}`,
    });

    const peerIdentityCacao = await client.engine.resolveIdentity({
      publicKey: `${peerIdentityPublicKey}`,
    });

    expect(selfIdentityCacao.p.iss).toEqual(
      `did:pkh:eip155:1:${walletSelf.address}`
    );
    expect(peerIdentityCacao.p.iss).toEqual(
      `did:pkh:eip155:1:${walletPeer.address}`
    );

    await peer.unregister({
      account: composeChainAddress(walletPeer.address),
    });
    expect(async () => {
      await client.engine.resolveIdentity({
        publicKey: `${peerIdentityPublicKey}`,
      });
    }).rejects.toThrowError();
  });

  it("can send & receive invites", async () => {
    let peerReceivedInvite = false;
    let peerJoinedChat = false;

    const walletSelf = Wallet.createRandom();
    const walletPeer = Wallet.createRandom();

    await peer.register({
      account: composeChainAddress(walletPeer.address),
      onSign: (message) => walletPeer.signMessage(message),
    });

    await client.register({
      account: composeChainAddress(walletSelf.address),
      onSign: (message) => walletSelf.signMessage(message),
    });

    peer.on("chat_invite", async (args) => {
      const { id } = args;
      console.log("chat_invite:", args);
      const chatThreadTopic = await peer.accept({ id });
      expect(chatThreadTopic).toBeDefined();
      peerReceivedInvite = true;
    });

    client.on("chat_invite_accepted", async (args) => {
      const { topic } = args;
      console.log("chat_invite_accepted:", args);
      expect(topic).toBeDefined();
      peerJoinedChat = true;
    });

    const invite: ChatClientTypes.Invite = {
      message: "hey let's chat",
      inviterAccount: composeChainAddress(walletSelf.address),
      inviteeAccount: composeChainAddress(walletPeer.address),
      inviteePublicKey: await client.resolve({
        account: composeChainAddress(walletPeer.address),
      }),
    };

    const inviteId = await client.invite(invite);

    await waitForEvent(() => peerReceivedInvite && peerJoinedChat);

    expect(inviteId).toBeDefined();
  });

  it("can send & receive messages", async () => {
    let peerReceivedInvite = false;
    let peerJoinedChat = false;
    let eventCount = 0;

    const walletSelf = Wallet.createRandom();
    const walletPeer = Wallet.createRandom();

    const payloadTimestamp = Date.now();

    await peer.register({
      account: composeChainAddress(walletPeer.address),
      onSign: (message) => walletPeer.signMessage(message),
    });

    await client.register({
      account: composeChainAddress(walletSelf.address),
      onSign: (message) => walletSelf.signMessage(message),
    });

    peer.on("chat_invite", async (args) => {
      const { id } = args;
      console.log("chat_invite:", args);
      const chatThreadTopic = await peer.accept({ id });
      expect(chatThreadTopic).toBeDefined();
      peerReceivedInvite = true;
    });

    client.on("chat_invite_accepted", async (args) => {
      const { topic } = args;
      console.log("chat_invite_accepted:", args);
      expect(topic).toBeDefined();
      peerJoinedChat = true;
    });

    const invite: ChatClientTypes.Invite = {
      message: "hey let's chat",
      inviterAccount: composeChainAddress(walletSelf.address),
      inviteeAccount: composeChainAddress(walletPeer.address),
      inviteePublicKey: await client.resolve({
        account: composeChainAddress(walletPeer.address),
      }),
    };

    await client.invite(invite);

    peer.on("chat_message", async () => {
      eventCount++;
    });

    await waitForEvent(() => peerReceivedInvite && peerJoinedChat);

    const thread = client.chatThreads.getAll()[0];
    const { topic } = thread;

    const payload = {
      topic,
      message: "some message",
      authorAccount: composeChainAddress(walletSelf.address),
      timestamp: payloadTimestamp,
    };

    await client.message({
      ...payload,
    });

    await waitForEvent(() => Boolean(eventCount));

    const messagesMatch = (
      m1: ChatClientTypes.Message,
      m2: ChatClientTypes.Message
    ) => {
      console.log({ m1, m2 });
      return (
        m1.authorAccount === m2.authorAccount &&
        m1.message === m2.message &&
        m1.timestamp === m2.timestamp
      );
    };

    expect(client.chatMessages.keys.length).toBe(1);
    const clientMessage = client.chatMessages.get(topic).messages[0];
    expect(messagesMatch(clientMessage, payload)).toBeTruthy();
    expect(peer.chatMessages.keys.length).toBe(1);
    const peerMessage = peer.chatMessages.get(topic).messages[0];
    expect(messagesMatch(peerMessage, payload)).toBeTruthy();

    await client.message({
      ...payload,
    });

    await waitForEvent(() => eventCount === 2);

    expect(client.chatMessages.keys.length).toBe(1);
    const clientMessages = client.chatMessages.get(topic).messages;
    expect(
      clientMessages.every((message) => messagesMatch(message, payload))
    ).toBeTruthy();
    expect(peer.chatMessages.keys.length).toBe(1);
    const peerMessages = peer.chatMessages.get(topic).messages;
    expect(
      peerMessages.every((message) => messagesMatch(message, payload))
    ).toBeTruthy();

    const receivedInvites = peer.chatReceivedInvites.getAll();

    expect(receivedInvites.length).toBe(1);

    const receivedInvite = receivedInvites[0];

    expect(receivedInvite.status).toBe("approved");

    expect(eventCount).toBe(2);
  });

  describe("ping", () => {
    it("can ping a known chat peer", async () => {
      const walletSelf = Wallet.createRandom();
      const walletPeer = Wallet.createRandom();
      // TODO: abstract this step, it duplicates the invite test above.
      // Set up an acknowledged chat thread
      let chatThreadTopic = "";
      let peerReceivedInvite = false;
      let peerJoinedChat = false;

      await peer.register({
        account: composeChainAddress(walletPeer.address),
        onSign: (message) => walletPeer.signMessage(message),
      });

      await client.register({
        account: composeChainAddress(walletSelf.address),
        onSign: (message) => walletSelf.signMessage(message),
      });

      peer.on("chat_invite", async (args) => {
        const { id } = args;
        console.log("chat_invite:", args);
        chatThreadTopic = await peer.accept({ id });
        expect(chatThreadTopic).toBeDefined();
        peerReceivedInvite = true;
      });

      client.on("chat_invite_accepted", async (args) => {
        const { topic } = args;
        console.log("chat_joined:", args);
        expect(topic).toBeDefined();
        peerJoinedChat = true;
      });

      const invite: ChatClientTypes.Invite = {
        message: "hey let's chat",
        inviterAccount: composeChainAddress(walletSelf.address),
        inviteeAccount: composeChainAddress(walletPeer.address),
        inviteePublicKey: await client.resolve({
          account: composeChainAddress(walletPeer.address),
        }),
      };

      await client.invite(invite);

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
      const account = "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5881F";
      const peerAccount = account.replace("81F", "81D");
      const mockInvite: ChatClientTypes.ReceivedInvite = {
        status: "pending",
        message: "hey let's chat",
        inviterAccount: peerAccount,
        timestamp: Date.now(),
        inviteeAccount: account,
        id: mockInviteId,
        inviterPublicKey:
          "511dc223dcf4b4a0148009785fe5c247d4e9ece7e8bd83db3082d6f1cdc07e26",
        inviteePublicKey:
          "511dc223dcf4b4a0148009785fe5c247d4e9ece7e8bd83db3082d6f1cdc07e16",
      };
      await client.chatReceivedInvites.set(mockInviteId.toString(), mockInvite);

      expect(client.getReceivedInvites({ account }).length).toBe(1);
      expect(client.chatReceivedInvites.get(mockInviteId.toString())).toEqual(
        mockInvite
      );
      expect(client.getReceivedInvites({ account })).toEqual([mockInvite]);
    });
  });

  describe("getThreads", () => {
    it("returns all currently active chat threads", async () => {
      const selfAccount = "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5881F";
      const topic = generateRandomBytes32();
      const mockChatThread = {
        topic,
        selfAccount,
        symKey: "",
        peerAccount: "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5FFFF",
      };

      // Init chat threads here since SyncStores were not initialized due to
      // register not being called.
      await client.chatThreads.init();
      await client.chatThreads.set(mockChatThread.topic, mockChatThread);

      expect(client.getThreads().size).toBe(1);
      expect(client.getThreads().get(mockChatThread.topic)).toEqual(
        mockChatThread
      );
      expect(client.getThreads({ account: selfAccount })).toEqual(
        new Map(
          Object.entries({
            [topic]: mockChatThread,
          })
        )
      );
    });
  });

  describe("getMessages", () => {
    it("returns all messages for a given thread topic", async () => {
      const topic = generateRandomBytes32();
      const mockChatMessages = [
        {
          topic,
          message: "eyo",
          authorAccount: "eip155:3:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb",
          timestamp: 1666697158617,
        },
        {
          topic,
          message: "sup",
          authorAccount: "eip155:1:0xb09a878797c4406085fA7108A3b84bbed3b5881F",
          timestamp: 1666697164166,
        },
      ];
      await client.chatMessages.set(topic, {
        topic,
        messages: mockChatMessages,
      });

      expect(client.getMessages({ topic }).length).toBe(
        mockChatMessages.length
      );
      expect(client.getMessages({ topic })).toEqual(mockChatMessages);
    });
  });

  describe("Multi account storage", () => {
    it("Can register different accounts", async () => {
      const walletSelf1 = Wallet.createRandom();
      const walletSelf2 = Wallet.createRandom();

      const identityKey1 = await client.register({
        account: composeChainAddress(walletSelf1.address),
        onSign: (message) => walletSelf1.signMessage(message),
      });

      const identityKey2 = await client.register({
        account: composeChainAddress(walletSelf2.address),
        onSign: (message) => walletSelf2.signMessage(message),
      });

      expect(identityKey1).toBeTruthy();
      expect(identityKey2).toBeTruthy();

      console.table({ identityKey1, identityKey2 });

      expect(identityKey1).to.not.eq(identityKey2);
    });
  });

  describe("Sync capability", () => {
    it("Can sync sentInvites", async () => {
      const clientSyncPeer = await ChatClient.init(opts);
      const walletSelf = Wallet.createRandom();
      const walletPeer = Wallet.createRandom();

      let peerReceivedInvite = false;
      let peerJoinedChat = false;
      let selfSyncPeerReceivedUpdate = false;

      await client.register({
        account: composeChainAddress(walletSelf.address),
        onSign: (message) => walletSelf.signMessage(message),
      });

      await peer.register({
        account: composeChainAddress(walletPeer.address),
        onSign: (message) => walletPeer.signMessage(message),
      });

      await clientSyncPeer.register({
        account: composeChainAddress(walletSelf.address),
        onSign: (message) => walletSelf.signMessage(message),
      });

      expect(clientSyncPeer.syncClient).toBeDefined();

      clientSyncPeer.syncClient?.on("sync_update", () => {
        selfSyncPeerReceivedUpdate = true;
      });

      peer.on("chat_invite", async (args) => {
        const { id } = args;
        console.log("chat_invite:", args);
        const chatThreadTopic = await peer.accept({ id });
        expect(chatThreadTopic).toBeDefined();
        peerReceivedInvite = true;
      });

      client.on("chat_invite_accepted", async (args) => {
        const { topic } = args;
        console.log("chat_invite_accepted:", args);
        expect(topic).toBeDefined();
        peerJoinedChat = true;
      });

      const invite: ChatClientTypes.Invite = {
        message: "hey let's chat",
        inviterAccount: composeChainAddress(walletSelf.address),
        inviteeAccount: composeChainAddress(walletPeer.address),
        inviteePublicKey: await client.resolve({
          account: composeChainAddress(walletPeer.address),
        }),
      };

      const inviteId = await client.invite(invite);

      await waitForEvent(() => peerReceivedInvite && peerJoinedChat);

      await waitForEvent(() => selfSyncPeerReceivedUpdate);

      expect(
        client.getSentInvites({
          account: composeChainAddress(walletSelf.address),
        })
      ).toEqual(
        clientSyncPeer.getSentInvites({
          account: composeChainAddress(walletSelf.address),
        })
      );

      expect(inviteId).toBeDefined();
    });
    it("Can sync threads and message", async () => {
      const clientSyncPeer = await ChatClient.init(opts);
      const walletSelf = Wallet.createRandom();
      const walletPeer = Wallet.createRandom();

      let peerReceivedInvite = false;
      let peerJoinedChat = false;
      let selfSyncPeerReceivedUpdate = false;
      let threadTopic = "";

      await client.register({
        account: composeChainAddress(walletSelf.address),
        onSign: (message) => walletSelf.signMessage(message),
      });

      await peer.register({
        account: composeChainAddress(walletPeer.address),
        onSign: (message) => walletPeer.signMessage(message),
      });

      await clientSyncPeer.register({
        account: composeChainAddress(walletSelf.address),
        onSign: (message) => walletSelf.signMessage(message),
      });

      expect(clientSyncPeer.syncClient).toBeDefined();

      clientSyncPeer.syncClient?.on("sync_update", () => {
        selfSyncPeerReceivedUpdate = true;
      });

      peer.on("chat_invite", async (args) => {
        const { id } = args;
        console.log("chat_invite:", args);
        const chatThreadTopic = await peer.accept({ id });
        expect(chatThreadTopic).toBeDefined();
        threadTopic = chatThreadTopic;
        peerReceivedInvite = true;
      });

      client.on("chat_invite_accepted", async (args) => {
        const { topic } = args;
        console.log("chat_invite_accepted:", args);
        expect(topic).toBeDefined();
        peerJoinedChat = true;
      });

      const invite: ChatClientTypes.Invite = {
        message: "hey let's chat",
        inviterAccount: composeChainAddress(walletSelf.address),
        inviteeAccount: composeChainAddress(walletPeer.address),
        inviteePublicKey: await client.resolve({
          account: composeChainAddress(walletPeer.address),
        }),
      };

      const inviteId = await client.invite(invite);

      await waitForEvent(() => peerReceivedInvite && peerJoinedChat);

      await waitForEvent(() => selfSyncPeerReceivedUpdate);

      expect(
        client.getSentInvites({
          account: composeChainAddress(walletSelf.address),
        })
      ).toEqual(
        clientSyncPeer.getSentInvites({
          account: composeChainAddress(walletSelf.address),
        })
      );

      await waitForEvent(
        () =>
          client.chatThreads.keys.length +
            clientSyncPeer.chatThreads.keys.length ===
          2
      );

      const payload = {
        topic: threadTopic,
        authorAccount: composeChainAddress(walletSelf.address),
      };

      expect(inviteId).toBeDefined();

      await client.message({
        ...payload,
        message: "messageA",
        timestamp: Date.now(),
      });

      waitForEvent(() => clientSyncPeer.core.crypto.keychain.has(threadTopic));

      await clientSyncPeer.message({
        ...payload,
        message: "messageB",
        timestamp: Date.now(),
      });

      console.log(
        "threads",
        peer.getThreads({ account: composeChainAddress(walletPeer.address) })
      );

      await waitForEvent(
        () => peer.chatMessages.get(threadTopic).messages.length > 1
      );

      await peer.message({
        topic: threadTopic,
        authorAccount: composeChainAddress(walletPeer.address),
        message: "messageC",
        timestamp: Date.now(),
      });

      await waitForEvent(
        () => peer.chatMessages.get(threadTopic).messages.length === 3
      );

      await waitForEvent(
        () => client.chatMessages.get(threadTopic).messages.length === 3
      );

      await waitForEvent(
        () => clientSyncPeer.chatMessages.get(threadTopic).messages.length === 3
      );

      expect(
        client
          .getMessages({ topic: threadTopic })
          .find((m) => m.message === "messageA")
      ).toEqual(
        clientSyncPeer
          .getMessages({ topic: threadTopic })
          .find((m) => m.message === "messageA")
      );
    }, 15000);
  });
});
