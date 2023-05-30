/* eslint-disable no-async-promise-executor */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { expect, describe, it } from "vitest";
import { uploadCanaryResultsToCloudWatch } from "../utils";
import { Wallet } from "@ethersproject/wallet";
import ChatClient from "../../src";
import { ChatClientTypes } from "./../../src/types";
import { disconnectSocket } from "./../helpers/ws";
import { SyncClient, SyncStore } from "@walletconnect/sync-client";
import { Core } from "@walletconnect/core";

const composeChainAddress = (address: string) => `eip155:1:${address}`;

const TEST_CLIENT_ACCOUNT = Wallet.createRandom();
const TEST_PEER_ACCOUNT = Wallet.createRandom();
const environment = process.env.ENVIRONMENT || "dev";
const region = process.env.REGION || "unknown";
const TEST_RELAY_URL =
  process.env.TEST_RELAY_URL || "wss://relay.walletconnect.com";
const metricsPrefix = "HappyPath.chat";

const projectId = process.env.TEST_PROJECT_ID;

if (!projectId) {
  throw new Error("TEST_PROJECT_ID needs to be supplied");
}

const opts = {
  logger: "error",
  relayUrl: process.env.TEST_RELAY_URL || "wss://relay.walletconnect.com",
  projectId,
  keyserverUrl: "https://keys.walletconnect.com",
  storageOptions: {
    database: ":memory:",
  },
};

describe("ChatClient Canary", () => {
  let registerAddressLatencyMs = 0;
  let resolveAddressLatencyMs = 0;
  let chatInviteLatencyMs = 0;
  let chatJoinedLatencyMs = 0;
  let chatMessageLatencyMs = 0;
  let chatLeaveLatencyMs = 0;

  it("should register -> resolve -> send message -> leave chat", async () => {
    const start = Date.now();
    const core = new Core({ projectId: opts.projectId });
    const syncClient = await SyncClient.init({
      projectId: opts.projectId,
      core,
    });

    const core2 = new Core({ projectId: opts.projectId });
    const syncClient2 = await SyncClient.init({
      projectId: opts.projectId,
      core: core2,
    });

    const client = await ChatClient.init({
      ...opts,
      core,
      syncClient,
      SyncStoreController: SyncStore,
    });

    const peer = await ChatClient.init({
      ...opts,
      syncClient: syncClient2,
      SyncStoreController: SyncStore,
      core: core2,
    });

    const publicKey = await client.register({
      account: composeChainAddress(TEST_PEER_ACCOUNT.address),
      onSign: TEST_CLIENT_ACCOUNT.signMessage,
    });
    const peerPublicKey = await peer.register({
      account: composeChainAddress(TEST_PEER_ACCOUNT.address),
      onSign: TEST_PEER_ACCOUNT.signMessage,
    });
    registerAddressLatencyMs = Date.now() - start;
    expect(publicKey.length).toBeGreaterThan(0);
    expect(peerPublicKey.length).toBeGreaterThan(0);

    const resolvedPublicKey = await peer.resolve({
      account: composeChainAddress(TEST_CLIENT_ACCOUNT.address),
    });
    const resolvedPeerPublicKey = await client.resolve({
      account: composeChainAddress(TEST_PEER_ACCOUNT.address),
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
        client.on("chat_invite_accepted", async (args) => {
          chatJoinedLatencyMs = Date.now() - start;
          topic = args.topic;
          expect(args.topic).toBeDefined();
          resolve();
        });
      }),
      new Promise<void>(async (resolve) => {
        const invite: ChatClientTypes.Invite = {
          message: "hey let's chat",
          inviterAccount: composeChainAddress(TEST_CLIENT_ACCOUNT.address),
          inviteeAccount: composeChainAddress(TEST_PEER_ACCOUNT.address),
          inviteePublicKey: await client.resolve({
            account: composeChainAddress(TEST_PEER_ACCOUNT.address),
          }),
        };

        await client.invite({
          ...invite,
        });
        resolve();
      }),
    ]);

    const clientMessagePayload = {
      message: "Hey there peer!",
      authorAccount: composeChainAddress(TEST_CLIENT_ACCOUNT.address),
      timestamp: Date.now(),
    };

    const peerMessagePayload = {
      message: "Hey there client!",
      authorAccount: composeChainAddress(TEST_PEER_ACCOUNT.address),
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
      new Promise<void>(async (resolve) => {
        await client.message({
          topic,
          ...clientMessagePayload,
        });
        await peer.message({ topic, ...peerMessagePayload });
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
      new Promise<void>(async (resolve) => {
        await client.leave({ topic });
        resolve();
      }),
    ]);

    await disconnectSocket(client.core);
    await disconnectSocket(peer.core);

    console.log({
      registerAddressLatencyMs,
      resolveAddressLatencyMs,
      chatInviteLatencyMs,
      chatJoinedLatencyMs,
      chatMessageLatencyMs,
      chatLeaveLatencyMs,
    });

    if (environment !== "dev") {
      const successful = true;
      const latencyMs = Date.now() - start;

      await uploadCanaryResultsToCloudWatch(
        environment,
        region,
        TEST_RELAY_URL,
        metricsPrefix,
        successful,
        latencyMs,
        [
          { registerAddressLatency: registerAddressLatencyMs },
          { resolveAddressLatency: resolveAddressLatencyMs },
          { chatInviteLatency: chatInviteLatencyMs },
          { chatJoinedLatency: chatJoinedLatencyMs },
          { chatMessageLatency: chatMessageLatencyMs },
          { chatLeaveLatency: chatLeaveLatencyMs },
        ]
      );
    }
  });
});
