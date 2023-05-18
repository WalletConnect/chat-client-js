import * as ed25519 from "@noble/ed25519";
import { verifySignature } from "@walletconnect/cacao";
import { RELAYER_EVENTS } from "@walletconnect/core";
import {
  formatJsonRpcError,
  formatJsonRpcRequest,
  formatJsonRpcResult,
  isJsonRpcError,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcResult,
} from "@walletconnect/jsonrpc-utils";
import { RelayerTypes } from "@walletconnect/types";
import {
  TYPE_1,
  createDelayedPromise,
  formatMessage,
  getRelayProtocolApi,
  getRelayProtocolName,
  getSdkError,
  hashKey,
  hashMessage,
} from "@walletconnect/utils";

import {
  JwtPayload,
  composeDidPkh,
  decodeX25519Key,
  encodeEd25519Key,
  encodeX25519Key,
  jwtExp,
} from "@walletconnect/did-jwt";

import axios from "axios";
import EventEmitter from "events";
import jwt from "jsonwebtoken";
import { ENGINE_RPC_OPTS } from "../constants";
import {
  ChatClientTypes,
  IChatClient,
  IChatEngine,
  JsonRpcTypes,
  ZAccount,
  ZInvite,
  ZMessage,
} from "../types";
import { engineEvent } from "../utils/engineUtil";

export class ChatEngine extends IChatEngine {
  private initialized = false;
  private currentAccount = "";
  private events = new EventEmitter();
  private keyserverUrl = this.client.keyserverUrl;

  constructor(client: IChatClient) {
    super(client);
  }

  public init: IChatEngine["init"] = async () => {
    if (!this.initialized) {
      // await this.cleanup();
      if (this.client.chatKeys.keys.includes(this.currentAccount)) {
        await this.subscribeToSelfInviteTopic();
      }
      this.registerRelayerEvents();
      this.client.core.pairing.register({
        methods: Object.keys(ENGINE_RPC_OPTS),
      });
      // this.registerExpirerEvents();
      this.initialized = true;
    }
  };

  private registerIdentity = async (
    accountId: string,
    onSign: (message: string) => Promise<string>
  ): Promise<string> => {
    return this.client.identityKeys.registerIdentity({ accountId, onSign });
  };

  public unregisterIdentity: IChatEngine["unregisterIdentity"] = async ({
    account,
  }) => {
    return this.client.identityKeys.unregisterIdentity({ account });
  };

  private generateIdAuth = async (accountId: string, payload: JwtPayload) => {
    return this.client.identityKeys.generateIdAuth(accountId, payload);
  };

  // Needs to be called after identity key has been created.
  private generateAndStoreInviteKey = async (accountId: string) => {
    const pubKeyHex = await this.client.core.crypto.generateKeyPair();
    const privKeyHex = this.client.core.crypto.keychain.get(pubKeyHex);
    await this.client.chatKeys.set(accountId, {
      account: accountId,
      publicKey: pubKeyHex,
      privateKey: privKeyHex,
    });
    return pubKeyHex;
  };

  public resolveIdentity: IChatEngine["resolveIdentity"] = async ({
    publicKey,
  }) => {
    return this.client.identityKeys.resolveIdentity({ publicKey });
  };

  private registerInvite = async (accountId: string, priv = false) => {
    try {
      const storedKeyPair = this.client.chatKeys.get(accountId);
      if (storedKeyPair.publicKey) return storedKeyPair.publicKey;

      throw new Error("Invite key not registered");
    } catch {
      const pubKeyHex = await this.generateAndStoreInviteKey(accountId);

      await this.registerInviteOnKeyserver(accountId, pubKeyHex, priv);
      return pubKeyHex;
    }
  };

  private registerInviteOnKeyserver = async (
    accountId: string,
    pubKeyHex: string,
    priv: boolean
  ) => {
    const identityKeyPub = await this.client.identityKeys.getIdentity({
      account: accountId,
    });
    const issuedAt = Math.round(Date.now() / 1000);
    const expiration = jwtExp(issuedAt);
    const didPublicKey = composeDidPkh(accountId);
    const payload = {
      iss: encodeEd25519Key(identityKeyPub),
      sub: encodeX25519Key(pubKeyHex),
      aud: this.keyserverUrl,
      act: "register_invite",
      iat: issuedAt,
      exp: expiration,
      pkh: didPublicKey,
    };

    const idAuth = await this.generateIdAuth(accountId, payload);

    if (!priv) {
      const url = `${this.keyserverUrl}/invite`;
      await axios.post(url, { idAuth }).catch((e) => console.error(e.toJSON()));
    }
  };

  public goPrivate: IChatEngine["goPrivate"] = async ({ account }) => {
    await this.unregisterInvite(account);
  };

  public goPublic: IChatEngine["goPublic"] = async ({ account }) => {
    const key = await this.registerInvite(account);
    return key;
  };

  private unregisterInvite = async (accountId: string) => {
    const { publicKey } = this.client.chatKeys.get(accountId);

    const identityKeyPub = await this.client.identityKeys.getIdentity({
      account: accountId,
    });

    const issuedAt = Math.round(Date.now() / 1000);
    const expiration = jwtExp(issuedAt);
    const didPublicKey = composeDidPkh(accountId);
    const payload = {
      iss: encodeEd25519Key(identityKeyPub),
      sub: encodeX25519Key(publicKey),
      aud: this.keyserverUrl,
      iat: issuedAt,
      exp: expiration,
      act: "unregister_invite",
      pkh: didPublicKey,
    };

    const idAuth = await this.generateIdAuth(accountId, payload);

    const url = `${this.keyserverUrl}/invite`;
    await axios
      .delete(url, { data: { idAuth } })
      .catch((e) => console.error(e.toJSON()));
  };

  public register: IChatEngine["register"] = async ({ account, onSign }) => {
    ZAccount.parse(account);

    const identityKey = await this.registerIdentity(account, onSign);

    this.currentAccount = account;

    if (this.client.syncClient) {
      if (this.client.syncClient.signatures.keys.includes(account)) {
        const { signature } = this.client.syncClient.signatures.get(account);
        await this.client.initSyncStores({ account, signature });
      } else {
        const syncMessage = await this.client.syncClient.getMessage({
          account,
        });
        const signedSyncMessage = await onSign(syncMessage);
        console.log("Registering sync", account, signedSyncMessage);
        await this.client.syncClient.register({
          account,
          signature: signedSyncMessage,
        });
        await this.client.initSyncStores({
          account,
          signature: signedSyncMessage,
        });
      }
    }

    await this.registerInvite(account, false);
    await this.subscribeToSelfInviteTopic();

    return identityKey;
  };

  public resolveInvite: IChatEngine["resolveInvite"] = async ({ account }) => {
    const url = `${this.keyserverUrl}/invite?account=${account}`;

    try {
      const { data } = await axios.get<{ value: { inviteKey: string } }>(url);
      return ed25519.utils.bytesToHex(decodeX25519Key(data.value.inviteKey));
    } catch {
      throw new Error("No invite key found");
    }
  };

  public invite: IChatEngine["invite"] = async (invite) => {
    const { inviteePublicKey, inviterAccount, inviteeAccount, message } =
      ZInvite.parse(invite);

    const alreadyInvited = this.client.chatSentInvites
      .getAll()
      .some((inv) => inv.inviteeAccount === invite.inviteeAccount);

    const alreadyHasThread = this.client.chatThreads
      .getAll()
      .some((thread) => thread.peerAccount === invite.inviteeAccount);

    if (alreadyHasThread) {
      throw new Error(
        `Address ${invite.inviteeAccount} already has established thread`
      );
    }

    if (alreadyInvited) {
      throw new Error(`Address ${invite.inviteeAccount} already invited`);
    }

    // generate a keyPair Y to encrypt the invite with derived DH symKey I.
    const pubkeyY = await this.client.core.crypto.generateKeyPair();
    const privKeyY = this.client.core.crypto.keychain.get(pubkeyY);

    console.log("invite > responderInvitePublicKey: ", inviteePublicKey);

    const identityKeyPub = await this.client.identityKeys.getIdentity({
      account: inviterAccount,
    });

    const pubkeyX = inviteePublicKey;

    // invite topic is derived as the hash of the publicKey X.
    const inviteTopic = hashKey(pubkeyX);
    this.client.core.crypto.keychain.set(inviteTopic, pubkeyY);

    console.log("invite > inviteTopic: ", inviteTopic);

    const iat = Date.now();
    const inviteProposalPayload = {
      iat,
      exp: jwtExp(iat),
      iss: encodeEd25519Key(identityKeyPub),
      pke: encodeX25519Key(pubkeyY),
      ksu: this.keyserverUrl,
      sub: message,
      act: "invite_proposal",
      aud: composeDidPkh(inviteeAccount),
    };

    const idAuth = await this.generateIdAuth(
      this.currentAccount,
      inviteProposalPayload
    );

    // subscribe to response topic: topic R (response) = hash(symKey I)
    // TODO: abstract this responseTopic derivation here and in onIncoming into reusable helper
    const topicSymKeyI = await this.client.core.crypto.generateSharedKey(
      pubkeyY,
      pubkeyX
    );
    const symKeyI = this.client.core.crypto.keychain.get(topicSymKeyI);
    const responseTopic = hashKey(symKeyI);
    console.log("invite > symKeyI", symKeyI);
    console.log("invite > subscribe > responseTopic:", responseTopic);

    // set the key for retrieval in `onInviteResponse`
    this.client.core.crypto.keychain.set(`${responseTopic}-pubkeyY`, pubkeyY);

    await this.client.core.relayer.subscribe(responseTopic);

    // TODO: needed? persist invite
    // await this.client.chatInvites.set(inviteId, completeInvite);
    // send invite encrypted with type 1 envelope to the invite topic including publicKey Y.
    const inviteId = await this.sendRequest(
      inviteTopic,
      "wc_chatInvite",
      { inviteAuth: idAuth },
      {
        type: TYPE_1,
        senderPublicKey: pubkeyY,
        receiverPublicKey: pubkeyX,
      }
    );

    await this.client.chatSentInvites.set(responseTopic, {
      inviteeAccount,
      id: inviteId,
      responseTopic,
      status: "pending",
      inviterAccount,
      symKey: symKeyI,
      inviterPubKeyY: pubkeyY,
      inviterPrivKeyY: privKeyY,
      timestamp: Date.now(),
      message,
    });

    return inviteId;
  };

  public accept: IChatEngine["accept"] = async ({ id }) => {
    const invite = this.client.chatReceivedInvites.get(id.toString());

    if (!this.currentAccount) {
      throw new Error("No account registered");
    }
    // NOTE: This is a very roundabout way to get back to symKey I by re-deriving,
    // since crypto.decode doesn't expose it.
    // Can we simplify this?
    const keys = this.client.chatKeys.get(this.currentAccount);

    const identityKeyPub = await this.client.identityKeys.getIdentity({
      account: this.currentAccount,
    });
    console.log(
      "accept > this.client.chatKeys.get('invitePublicKey'): ",
      keys.publicKey
    );

    const decodedInvitePubKey = invite.inviterPublicKey;

    const topicSymKeyI = await this.client.core.crypto.generateSharedKey(
      keys.publicKey,
      decodedInvitePubKey
    );
    const symKeyI = this.client.core.crypto.keychain.get(topicSymKeyI);
    const responseTopic = hashKey(symKeyI);
    console.log("accept > symKeyI", symKeyI);
    console.log("accept > responseTopic:", responseTopic);

    // accepts the invite and generates a keyPair Z for chat thread.
    const publicKeyZ = await this.client.core.crypto.generateKeyPair();

    // B derives symKey T using publicKey Y and privKey Z.
    const topicSymKeyT = await this.client.core.crypto.generateSharedKey(
      publicKeyZ,
      decodedInvitePubKey
    );

    const symKeyT = this.client.core.crypto.keychain.get(topicSymKeyT);
    console.log("accept > symKeyT:", symKeyT);

    // Thread topic is derived as the hash of the symKey T.
    const chatThreadTopic = hashKey(symKeyT);

    const iat = Date.now();
    const inviteApprovalPayload = {
      iat,
      exp: jwtExp(iat),
      iss: encodeEd25519Key(identityKeyPub),
      sub: encodeX25519Key(publicKeyZ),
      aud: composeDidPkh(invite.inviterAccount),
      ksu: this.keyserverUrl,
      act: "invite_approval",
    };

    const idAuth = await this.generateIdAuth(
      this.currentAccount,
      inviteApprovalPayload
    );

    // B sends response with publicKey Z on response topic encrypted with type 0 envelope.
    await this.sendResult<"wc_chatInvite">(id, responseTopic, {
      responseAuth: idAuth,
    });

    // Subscribe to the chat thread topic.
    await this.client.core.relayer.subscribe(chatThreadTopic);

    console.log("accept > chatThreadTopic:", chatThreadTopic);

    await this.client.chatThreads.set(chatThreadTopic, {
      topic: chatThreadTopic,
      selfAccount: this.currentAccount,
      peerAccount: invite.inviterAccount,
      symKey: symKeyT,
    });

    if (!this.client.chatMessages.keys.includes(chatThreadTopic)) {
      await this.client.chatMessages.set(chatThreadTopic, {
        topic: chatThreadTopic,
        messages: [],
      });
    }

    console.log("accept > chatThreads.set:", chatThreadTopic, {
      topic: chatThreadTopic,
      selfAccount: this.currentAccount,
      peerAccount: invite.inviterAccount,
    });

    await this.client.chatReceivedInvites.update(id.toString(), {
      status: "approved",
    });

    console.log("accept > chatInvites.delete:", id);

    return chatThreadTopic;
  };

  public reject: IChatEngine["reject"] = async ({ id }) => {
    if (!this.currentAccount) {
      throw new Error("No account registered");
    }

    const invite = this.client.chatReceivedInvites.get(id.toString());
    const { publicKey } = this.client.chatKeys.get(this.currentAccount);

    const topicSymKeyI = await this.client.core.crypto.generateSharedKey(
      publicKey,
      invite.inviterPublicKey
    );
    const symKeyI = this.client.core.crypto.keychain.get(topicSymKeyI);
    const responseTopic = hashKey(symKeyI);
    console.log("reject > symKeyI", symKeyI);
    console.log("reject > responseTopic:", responseTopic);

    await this.sendError(id, responseTopic, getSdkError("USER_REJECTED"));

    await this.client.chatReceivedInvites.update(id.toString(), {
      status: "rejected",
    });

    console.log("reject > chatInvites.delete:", id);
  };

  public sendMessage: IChatEngine["sendMessage"] = async (payload) => {
    const messagePayload = ZMessage.parse(payload);
    const identityKeyPub = await this.client.identityKeys.getIdentity({
      account: this.currentAccount,
    });
    const iat = messagePayload.timestamp;
    const messageKeyClaims = {
      iat,
      exp: jwtExp(iat),
      iss: encodeEd25519Key(identityKeyPub),
      sub: messagePayload.message,
      ksu: this.keyserverUrl,
      aud: composeDidPkh(
        this.client.chatThreads.get(messagePayload.topic).peerAccount
      ),
      act: "chat_message",
    };

    const jsonRpcPayload = formatJsonRpcRequest("wc_chatMessage", {
      messageAuth: await this.generateIdAuth(
        this.currentAccount,
        messageKeyClaims
      ),
    });

    const encodedMessage = await this.client.core.crypto.encode(
      messagePayload.topic,
      jsonRpcPayload
    );

    await this.client.core.relayer.provider.request({
      method: getRelayProtocolApi(getRelayProtocolName().protocol).publish,
      params: {
        ...ENGINE_RPC_OPTS["wc_chatMessage"].req,
        message: encodedMessage,
        topic: messagePayload.topic,
      },
    });
    this.client.core.history.set(messagePayload.topic, jsonRpcPayload);

    console.log("----- SEND MSG");

    // Set message in ChatMessages store, keyed by thread topic T.
    this.setMessage(messagePayload.topic, messagePayload);
  };

  public ping: IChatEngine["ping"] = async ({ topic }) => {
    // this.isInitialized();
    // await this.isValidPing(params);
    if (this.client.chatThreads.keys.includes(topic)) {
      const id = await this.sendRequest(topic, "wc_chatPing", {});
      const { done, resolve, reject } = createDelayedPromise<void>();
      this.events.once(engineEvent("chat_ping", id), ({ error }) => {
        if (error) reject(error);
        else resolve();
      });
      await done();
    }
  };

  public leave: IChatEngine["leave"] = async ({ topic }) => {
    // this.isInitialized();
    if (this.client.chatThreads.keys.includes(topic)) {
      await this.sendRequest(topic, "wc_chatLeave", {});
      await this.leaveChat(topic);
    }
  };

  // ---------- Protected Helpers --------------------------------------- //

  protected sendRequest: IChatEngine["sendRequest"] = async (
    topic,
    method,
    params,
    opts
  ) => {
    const payload = formatJsonRpcRequest(method, params);
    const message = await this.client.core.crypto.encode(topic, payload, opts);
    const rpcOpts = ENGINE_RPC_OPTS[method].req;
    await this.client.core.relayer.publish(topic, message, rpcOpts);
    this.client.core.history.set(topic, payload);

    return payload.id;
  };

  protected sendResult: IChatEngine["sendResult"] = async (
    id,
    topic,
    result,
    opts
  ) => {
    const payload = formatJsonRpcResult(id, result);
    const message = await this.client.core.crypto.encode(topic, payload, opts);
    const record = await this.client.core.history.get(topic, id);
    const rpcOpts =
      ENGINE_RPC_OPTS[record.request.method as JsonRpcTypes.WcMethod].res;
    await this.client.core.relayer.publish(topic, message, rpcOpts);
    await this.client.core.history.resolve(payload);
  };

  protected sendError: IChatEngine["sendError"] = async (
    id,
    topic,
    error,
    opts
  ) => {
    const payload = formatJsonRpcError(id, error);
    const message = await this.client.core.crypto.encode(topic, payload, opts);
    const record = await this.client.core.history.get(topic, id);
    const rpcOpts =
      ENGINE_RPC_OPTS[record.request.method as JsonRpcTypes.WcMethod].res;
    await this.client.core.relayer.publish(topic, message, rpcOpts);
    await this.client.core.history.resolve(payload);
  };

  public subscribeToSelfInviteTopic = async (account?: string) => {
    if (!account && !this.currentAccount) {
      throw new Error("No account registered");
    }

    const { publicKey } = this.client.chatKeys.get(
      account ?? this.currentAccount
    );

    console.log(">>>>>>>>> selfInvitePublicKey:", publicKey);

    const selfInviteTopic = hashKey(publicKey);
    console.log(">>>>>>>>> selfInviteTopic:", selfInviteTopic);
    await this.client.core.relayer.subscribe(selfInviteTopic);
  };

  protected setMessage: IChatEngine["setMessage"] = async (topic, item) => {
    if (this.client.chatMessages.keys.includes(topic)) {
      const current = this.client.chatMessages.get(topic);
      const messages = [...current.messages, item];
      await this.client.chatMessages.update(topic, { messages, topic });
    } else {
      await this.client.chatMessages.set(topic, { messages: [item], topic });
    }
  };

  protected leaveChat: IChatEngine["leaveChat"] = async (topic) => {
    // Await the unsubscribe first to avoid deleting the symKey too early below.
    await this.client.core.relayer.unsubscribe(topic);
    await Promise.all([
      this.client.chatThreads.delete(topic, getSdkError("USER_DISCONNECTED")),
      this.client.chatMessages.delete(topic, getSdkError("USER_DISCONNECTED")),
      this.client.core.crypto.deleteSymKey(topic),
    ]);
  };

  // ---------- Relay Event Routing ----------------------------------- //

  private registerRelayerEvents() {
    this.client.core.relayer.on(
      RELAYER_EVENTS.message,
      async (event: RelayerTypes.MessageEvent) => {
        const { topic, message, publishedAt } = event;
        if (!this.client.chatKeys.keys.includes(this.currentAccount)) {
          return;
        }
        const selfKeys = this.client.chatKeys.get(this.currentAccount);

        const payload = await this.client.core.crypto.decode(topic, message, {
          receiverPublicKey: selfKeys.publicKey,
        });

        if (isJsonRpcRequest(payload)) {
          this.client.core.history.set(topic, payload);
          this.onRelayEventRequest({ topic, payload }, publishedAt);
        } else if (isJsonRpcResponse(payload)) {
          await this.client.core.history.resolve(payload);
          this.onRelayEventResponse({ topic, payload }, publishedAt);
        }
      }
    );
  }

  protected onRelayEventRequest: IChatEngine["onRelayEventRequest"] = (
    event,
    publishedAt
  ) => {
    const { topic, payload } = event;
    const reqMethod = payload.method as JsonRpcTypes.WcMethod;

    switch (reqMethod) {
      case "wc_chatInvite":
        return this.onIncomingInvite(topic, payload, publishedAt);
      case "wc_chatMessage":
        return this.onIncomingMessage(topic, payload);
      case "wc_chatPing":
        return this.onChatPingRequest(topic, payload);
      case "wc_chatLeave":
        return this.onChatLeaveRequest(topic, payload);
      default:
        this.client.logger.info(`Unsupported request method ${reqMethod}`);
        return;
    }
  };

  protected onRelayEventResponse: IChatEngine["onRelayEventResponse"] = async (
    event
  ) => {
    const { topic, payload } = event;
    const record = await this.client.core.history.get(topic, payload.id);
    const resMethod = record.request.method as JsonRpcTypes.WcMethod;

    switch (resMethod) {
      case "wc_chatInvite":
        return this.onInviteResponse(topic, payload);
      case "wc_chatMessage":
        return this.onSendMessageResponse(topic, payload);
      case "wc_chatPing":
        return this.onChatPingResponse(topic, payload);

      default:
        this.client.logger.info(`Unsupported response method ${resMethod}`);
        return;
    }
  };

  // ---------- Relay Event Handlers ----------------------------------- //

  // TODO (post-MVP): Peer rejects invite
  protected onIncomingInvite: IChatEngine["onIncomingInvite"] = async (
    inviteTopic,
    payload,
    publishedAt
  ) => {
    try {
      const { id, params } = payload;

      const decodedPayload = jwt.decode(params.inviteAuth, {
        json: true,
      }) as Record<string, string>;

      if (!decodedPayload) throw new Error("Empty ID Auth payload");

      const { publicKey } = this.client.chatKeys.get(
        decodedPayload.aud.split(":").slice(2).join(":")
      );

      const invitePayload: ChatClientTypes.ReceivedInvite = {
        id,
        inviteeAccount: decodedPayload.aud.split(":").slice(2).join(":"),
        status: "pending",
        timestamp: publishedAt,
        message: decodedPayload.sub,
        inviterAccount: (
          await this.resolveIdentity({
            publicKey: decodedPayload.iss,
          })
        ).p.iss
          .split(":")
          .slice(2)
          .join(":"),
        inviteePublicKey: publicKey,
        inviterPublicKey: ed25519.utils.bytesToHex(
          decodeX25519Key(decodedPayload.pke)
        ),
      };

      await this.client.chatReceivedInvites.set(id.toString(), {
        ...invitePayload,
        id,
      });

      this.client.emit("chat_invite", {
        id,
        topic: inviteTopic,
        params: invitePayload,
      });
    } catch (err: any) {
      console.log({ err });
      await this.sendError(payload.id, inviteTopic, err);
      this.client.logger.error(err);
    }
  };

  protected onInviteResponse: IChatEngine["onInviteResponse"] = async (
    topic,
    payload
  ) => {
    if (isJsonRpcResult(payload)) {
      const pubkeyY = this.client.core.crypto.keychain.get(`${topic}-pubkeyY`);
      const decodedPayload = jwt.decode(payload.result.responseAuth, {
        json: true,
      }) as Record<string, string>;

      if (!decodedPayload) throw new Error("Empty ID Auth payload");

      const topicSymKeyT = await this.client.core.crypto.generateSharedKey(
        pubkeyY,
        ed25519.utils.bytesToHex(decodeX25519Key(decodedPayload.sub))
      );

      const symKeyT = this.client.core.crypto.keychain.get(topicSymKeyT);

      // Thread topic is derived as the hash of the symKey T.
      const chatThreadTopic = hashKey(symKeyT);
      console.log("onInviteResponse > symKeyT:", symKeyT);
      console.log("onInviteResponse > chatThreadTopic: ", chatThreadTopic);

      // Subscribe to the chat thread topic.
      await this.client.core.relayer.subscribe(chatThreadTopic);

      const { inviteeAccount, inviterAccount } =
        this.client.chatSentInvites.get(topic);

      await this.client.chatThreads.set(chatThreadTopic, {
        topic: chatThreadTopic,
        selfAccount: inviterAccount,
        peerAccount: inviteeAccount,
        symKey: symKeyT,
      });

      if (!this.client.chatMessages.keys.includes(chatThreadTopic)) {
        await this.client.chatMessages.set(chatThreadTopic, {
          topic: chatThreadTopic,
          messages: [],
        });
      }

      console.log("onInviteResponse > chatThreads.set: ", chatThreadTopic, {
        topic: chatThreadTopic,
        selfAccount: inviterAccount,
        peerAccount: inviteeAccount,
      });

      //TODO: Delete after 3 settled invites
      await this.client.chatSentInvites.update(topic, {
        status: "approved",
      });

      this.client.emit("chat_invite_accepted", {
        id: payload.id,
        topic,
        invite: this.client.chatSentInvites.get(topic),
      });
    } else if (isJsonRpcError(payload)) {
      this.client.logger.error(payload.error);
      if (payload.error.message === getSdkError("USER_REJECTED").message) {
        this.onRejectedChatInvite({ topic, id: payload.id });
      }
    }
  };

  protected onRejectedChatInvite: IChatEngine["onRejectedChatInvite"] = async ({
    id,
    topic,
  }) => {
    await this.client.chatSentInvites.update(topic, {
      status: "rejected",
    });

    this.client.emit("chat_invite_rejected", {
      id,
      topic,
      invite: this.client.chatSentInvites.get(topic),
    });
  };

  protected onIncomingMessage: IChatEngine["onIncomingMessage"] = async (
    topic,
    payload
  ) => {
    const { params, id } = payload;
    const { selfAccount, peerAccount } = this.client.chatThreads.get(topic);
    try {
      const decodedPayload = jwt.decode(params.messageAuth, {
        json: true,
      }) as Record<string, string>;

      const cacao = await this.resolveIdentity({
        publicKey: decodedPayload.iss,
      });

      const authorAccount = cacao.p.iss.split(":").slice(2).join(":");
      const receipientAccount = cacao.p.aud.split(":").slice(2).join(":");
      const chainId = authorAccount.split(":")[1];

      const cacaoAuthor = cacao.p.iss;

      const validSignature = await verifySignature(
        authorAccount.split(":")[2],
        formatMessage(cacao.p, cacaoAuthor),
        cacao.s,
        chainId,
        this.client.projectId
      );

      if (!validSignature) {
        throw new Error(
          `Invalid signature for incoming message from address ${authorAccount}`
        );
      }

      const message: ChatClientTypes.Message = {
        topic,
        message: decodedPayload.sub,
        authorAccount,
        timestamp: new Date(decodedPayload.iat).getTime(),
      };

      const identityKeyPub = await this.client.identityKeys.getIdentity({
        account: selfAccount,
      });

      const iat = Date.now();
      const receiptKeyClaims = {
        iat,
        exp: jwtExp(iat),
        iss: encodeEd25519Key(identityKeyPub),
        sub: hashMessage(message.message),
        ksu: this.keyserverUrl,
        aud: composeDidPkh(message.authorAccount),
        act: "chat_receipt",
      };

      this.setMessage(topic, message);
      this.client.emit("chat_message", { id, topic, params: message });

      // If the author is a registered account,
      // and the peer is not, then there is no reason to respond to the message
      if (authorAccount === selfAccount) {
        try {
          await this.client.identityKeys.getIdentity({
            account: receipientAccount,
          });
        } catch (e) {
          return;
        }
      }

      await this.sendResult<"wc_chatMessage">(payload.id, topic, {
        receiptAuth: await this.generateIdAuth(
          this.currentAccount,
          receiptKeyClaims
        ),
      });
    } catch (err: any) {
      await this.sendError(id, topic, err);
      this.client.logger.error(err);
    }
  };

  protected onSendMessageResponse: IChatEngine["onSendMessageResponse"] =
    async (_topic, payload) => {
      const { id } = payload;
      if (isJsonRpcResult(payload)) {
        this.events.emit(engineEvent("chat_message", id), {});
      } else if (isJsonRpcError(payload)) {
        this.events.emit(engineEvent("chat_message", id), {
          error: payload.error,
        });
      }
    };

  protected onChatPingRequest: IChatEngine["onChatPingRequest"] = async (
    topic,
    payload
  ) => {
    const { id } = payload;
    try {
      // this.isValidPing({ topic });
      await this.sendResult<"wc_chatPing">(id, topic, true);
      this.client.emit("chat_ping", { id, topic });
    } catch (err: any) {
      await this.sendError(id, topic, err);
      this.client.logger.error(err);
    }
  };

  protected onChatPingResponse: IChatEngine["onChatPingResponse"] = (
    _topic,
    payload
  ) => {
    const { id } = payload;
    // put at the end of the stack to avoid a race condition
    // where chat_ping listener is not yet initialized
    setTimeout(() => {
      if (isJsonRpcResult(payload)) {
        this.events.emit(engineEvent("chat_ping", id), {});
      } else if (isJsonRpcError(payload)) {
        this.events.emit(engineEvent("chat_ping", id), {
          error: payload.error,
        });
      }
    }, 500);
  };

  protected onChatLeaveRequest: IChatEngine["onChatLeaveRequest"] = async (
    topic,
    payload
  ) => {
    const { id } = payload;
    try {
      // RPC response needs to happen before deletion as it utilises encryption.
      await this.sendResult<"wc_chatLeave">(id, topic, true);
      await this.leaveChat(topic);
      this.client.emit("chat_left", { id, topic });
    } catch (err: any) {
      await this.sendError(id, topic, err);
      this.client.logger.error(err);
    }
  };
}
