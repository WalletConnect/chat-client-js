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
  relayUrl: process.env.TEST_RELAY_URL || "wss://relay.walletconnect.com",
  projectId: process.env.TEST_PROJECT_ID,
  keyserverUrl: "https://keys.walletconnect.com",
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

  describe("Offline messages", () => {
    it("Can receive messages when coming online", async () => {
      const walletSelf = Wallet.createRandom();
      const walletPeer = Wallet.createRandom();

      let peerReceivedInvite = false;
      let peerJoinedChat = false;
      let threadTopic = "";

      await client.register({
        account: composeChainAddress(walletSelf.address),
        onSign: (message) => walletSelf.signMessage(message),
      });

      await peer.register({
        account: composeChainAddress(walletPeer.address),
        onSign: (message) => walletPeer.signMessage(message),
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

      await waitForEvent(() => peer.chatMessages.getAll().length > 0);

      expect(
        peer
          .getMessages({ topic: threadTopic })
          .find((m) => m.message === "messageA")
      ).toBeTruthy();

      await peer.core.relayer.transportClose();

      await client.message({
        ...payload,
        message: "messageB",
        timestamp: Date.now(),
      });

      await peer.core.relayer.transportOpen();

      await waitForEvent(() => peer.chatMessages.getAll().length > 1);

      expect(
        peer
          .getMessages({ topic: threadTopic })
          .find((m) => m.message === "messageB")
      ).toBeTruthy();
    }, 20000);
  });
});
