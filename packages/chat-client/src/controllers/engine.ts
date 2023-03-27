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
  Cacao,
  createDelayedPromise,
  formatMessage,
  generateRandomBytes32,
  getRelayProtocolApi,
  getRelayProtocolName,
  getSdkError,
  hashKey,
  TYPE_1,
} from "@walletconnect/utils";
import axios from "axios";
import EventEmitter from "events";
import { ENGINE_RPC_OPTS } from "../constants";
import * as ed25519 from "@noble/ed25519";
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
import {
  composeDidPkh,
  decodeX25519Key,
  encodeEd25519Key,
  encodeX25519Key,
  generateJWT,
  InviteKeyClaims,
  jwtExp,
} from "../utils/jwtAuth";
import jwt from "jsonwebtoken";

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

  // Needs to be called after identity key has been created.
  private generateAndStoreInviteKey = async (accountId: string) => {
    const pubKeyHex = await this.client.core.crypto.generateKeyPair();
    const privKeyHex = this.client.core.crypto.keychain.get(pubKeyHex);
    this.client.chatKeys.update(accountId, {
      inviteKeyPriv: privKeyHex,
      inviteKeyPub: pubKeyHex,
    });
    return pubKeyHex;
  };

  private generateIdentityKey = async () => {
    const privateKey = ed25519.utils.randomPrivateKey();
    const publicKey = await ed25519.getPublicKey(privateKey);

    const pubKeyHex = ed25519.utils.bytesToHex(publicKey).toLowerCase();
    const privKeyHex = ed25519.utils.bytesToHex(privateKey).toLowerCase();
    this.client.core.crypto.keychain.set(pubKeyHex, privKeyHex);
    return [pubKeyHex, privKeyHex];
  };

  private generateIdAuth = (accountId: string, payload: InviteKeyClaims) => {
    const { identityKeyPub, identityKeyPriv } =
      this.client.chatKeys.get(accountId);

    return generateJWT([identityKeyPub, identityKeyPriv], payload);
  };

  private registerIdentity = async (
    accountId: string,
    onSign: (message: string) => Promise<string>
  ): Promise<string> => {
    try {
      const storedKeyPair = this.client.chatKeys.get(accountId);
      return storedKeyPair.identityKeyPub;
    } catch {
      const [pubKeyHex, privKeyHex] = await this.generateIdentityKey();
      const didKey = encodeEd25519Key(pubKeyHex);

      const cacao: Cacao = {
        h: {
          t: "eip4361",
        },
        p: {
          aud: this.keyserverUrl,
          statement: "Test",
          domain: this.keyserverUrl,
          iss: composeDidPkh(accountId),
          nonce: generateRandomBytes32(),
          iat: new Date().toISOString(),
          version: "1",
          resources: [didKey],
        },
        s: {
          t: "eip191",
          s: "",
        },
      };

      const cacaoMessage = formatMessage(cacao.p, composeDidPkh(accountId));

      const signature = await onSign(cacaoMessage);

      // Storing keys after signature creation to prevent having false statement
      // Eg, onSign failing / never resolving but having identity keys stored.
      this.client.chatKeys.set(accountId, {
        identityKeyPriv: privKeyHex,
        identityKeyPub: pubKeyHex,
        accountId,
        inviteKeyPriv: "",
        inviteKeyPub: "",
      });

      const url = `${this.keyserverUrl}/identity`;

      const response = await axios.post(url, {
        cacao: {
          ...cacao,
          s: {
            ...cacao.s,
            s: signature,
          },
        },
      });

      if (response.status === 200) {
        return didKey;
      }
      throw new Error(`Failed to register on keyserver ${response.status}`);
    }
  };

  private registerInvite = async (accountId: string, priv = false) => {
    try {
      const storedKeyPair = this.client.chatKeys.get(accountId);
      if (storedKeyPair.inviteKeyPub) return storedKeyPair.inviteKeyPub;

      throw new Error("Invite key not registered");
    } catch {
      const pubKeyHex = await this.generateAndStoreInviteKey(accountId);

      const { identityKeyPub } = this.client.chatKeys.get(accountId);

      const issuedAt = Math.round(Date.now() / 1000);
      const expiration = jwtExp(issuedAt);
      const didPublicKey = composeDidPkh(accountId);
      const payload: InviteKeyClaims = {
        iss: encodeEd25519Key(identityKeyPub),
        sub: encodeX25519Key(pubKeyHex),
        aud: this.keyserverUrl,
        iat: issuedAt,
        exp: expiration,
        pkh: didPublicKey,
      };

      const idAuth = await this.generateIdAuth(accountId, payload);

      if (!priv) {
        const url = `${this.keyserverUrl}/invite`;
        await axios
          .post(url, { idAuth })
          .catch((e) => console.error(e.toJSON()));
      }

      return pubKeyHex;
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
    const { inviteKeyPub } = this.client.chatKeys.get(accountId);

    const { identityKeyPub } = this.client.chatKeys.get(accountId);

    const issuedAt = Math.round(Date.now() / 1000);
    const expiration = jwtExp(issuedAt);
    const didPublicKey = composeDidPkh(accountId);
    const payload: InviteKeyClaims = {
      iss: encodeEd25519Key(identityKeyPub),
      sub: encodeX25519Key(inviteKeyPub),
      aud: this.keyserverUrl,
      iat: issuedAt,
      exp: expiration,
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
    await this.registerInvite(account, false);

    this.currentAccount = account;

    await this.subscribeToSelfInviteTopic();

    return identityKey;
  };

  public resolveIdentity: IChatEngine["resolveIdentity"] = async ({
    publicKey,
  }) => {
    const url = `${this.keyserverUrl}/identity?publicKey=${
      publicKey.split(":")[2]
    }`;

    try {
      const { data } = await axios.get<{ value: { cacao: Cacao } }>(url);
      return data.value.cacao;
    } catch (e: any) {
      console.error(e.toJSON());
      throw new Error("Failed to resolve identity key");
    }
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
    // resolve peer account pubKey X

    const { inviteePublicKey, inviterAccount, inviteeAccount, message } =
      ZInvite.parse(invite);

    // generate a keyPair Y to encrypt the invite with derived DH symKey I.
    const pubkeyY = await this.client.core.crypto.generateKeyPair();

    console.log("invite > responderInvitePublicKey: ", inviteePublicKey);

    const keys = this.client.chatKeys.get(inviterAccount);

    const pubkeyX = inviteePublicKey;

    // invite topic is derived as the hash of the publicKey X.
    const inviteTopic = hashKey(pubkeyX);
    this.client.core.crypto.keychain.set(inviteTopic, pubkeyY);

    console.log("invite > inviteTopic: ", inviteTopic);

    const iat = Date.now();
    const inviteProposalPayload: InviteKeyClaims = {
      iat,
      exp: jwtExp(iat),
      iss: encodeEd25519Key(keys.identityKeyPub),
      pke: encodeX25519Key(pubkeyY),
      ksu: this.keyserverUrl,
      sub: message,
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

    this.client.chatSentInvites.set(responseTopic, {
      inviteeAccount,
      id: inviteId,
      responseTopic,
      status: "pending",
      inviterAccount,
      message,
    });

    return inviteId;
  };

  public accept: IChatEngine["accept"] = async ({ id }) => {
    const invite = this.client.chatReceivedInvites.get(id);

    if (!this.currentAccount) {
      throw new Error("No account registered");
    }
    // NOTE: This is a very roundabout way to get back to symKey I by re-deriving,
    // since crypto.decode doesn't expose it.
    // Can we simplify this?
    const keys = this.client.chatKeys.get(this.currentAccount);
    console.log(
      "accept > this.client.chatKeys.get('invitePublicKey'): ",
      keys.inviteKeyPub
    );

    const decodedInvitePubKey = invite.inviterPublicKey;

    const topicSymKeyI = await this.client.core.crypto.generateSharedKey(
      keys.inviteKeyPub,
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
    const inviteApprovalPayload: InviteKeyClaims = {
      iat,
      exp: jwtExp(iat),
      iss: encodeEd25519Key(keys.identityKeyPub),
      sub: encodeX25519Key(publicKeyZ),
      aud: invite.inviterAccount,
      ksu: this.keyserverUrl,
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
    });

    console.log("accept > chatThreads.set:", chatThreadTopic, {
      topic: chatThreadTopic,
      selfAccount: this.currentAccount,
      peerAccount: invite.inviterAccount,
    });

    await this.client.chatReceivedInvites.update(id, {
      status: "approved",
    });

    console.log("accept > chatInvites.delete:", id);

    return chatThreadTopic;
  };

  public reject: IChatEngine["reject"] = async ({ id }) => {
    if (!this.currentAccount) {
      throw new Error("No account registered");
    }

    const invite = this.client.chatReceivedInvites.get(id);
    const { inviteKeyPub } = this.client.chatKeys.get(this.currentAccount);

    const topicSymKeyI = await this.client.core.crypto.generateSharedKey(
      inviteKeyPub,
      invite.inviterPublicKey
    );
    const symKeyI = this.client.core.crypto.keychain.get(topicSymKeyI);
    const responseTopic = hashKey(symKeyI);
    console.log("reject > symKeyI", symKeyI);
    console.log("reject > responseTopic:", responseTopic);

    await this.sendError(id, responseTopic, getSdkError("USER_REJECTED"));

    await this.client.chatReceivedInvites.update(id, {
      status: "rejected",
    });

    console.log("reject > chatInvites.delete:", id);
  };

  public sendMessage: IChatEngine["sendMessage"] = async (payload) => {
    const messagePayload = ZMessage.parse(payload);
    const keys = this.client.chatKeys.get(this.currentAccount);
    const iat = messagePayload.timestamp;
    const messageKeyClaims: InviteKeyClaims = {
      iat,
      exp: jwtExp(iat),
      iss: encodeEd25519Key(keys.identityKeyPub),
      sub: messagePayload.message,
      ksu: this.keyserverUrl,
      aud: composeDidPkh(
        this.client.chatThreads.get(messagePayload.topic).peerAccount
      ),
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

  protected subscribeToSelfInviteTopic = async () => {
    if (!this.currentAccount) {
      throw new Error("No account registered");
    }

    const { inviteKeyPub } = this.client.chatKeys.get(this.currentAccount);

    console.log(">>>>>>>>> selfInvitePublicKey:", inviteKeyPub);

    const selfInviteTopic = hashKey(inviteKeyPub);
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
          receiverPublicKey: selfKeys.inviteKeyPub,
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

      const { inviteKeyPub } = this.client.chatKeys.get(
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
        inviteePublicKey: inviteKeyPub,
        inviterPublicKey: ed25519.utils.bytesToHex(
          decodeX25519Key(decodedPayload.pke)
        ),
      };

      await this.client.chatReceivedInvites.set(id, { ...invitePayload, id });

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
      });

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
    try {
      const decodedPayload = jwt.decode(params.messageAuth, {
        json: true,
      }) as Record<string, string>;

      const cacao = await this.resolveIdentity({
        publicKey: decodedPayload.iss,
      });

      const message: ChatClientTypes.Message = {
        topic,
        message: decodedPayload.sub,
        authorAccount: cacao.p.iss.split(":").slice(2).join(":"),
        timestamp: new Date(decodedPayload.iat).getTime(),
      };

      this.setMessage(topic, message);
      await this.sendResult<"wc_chatMessage">(payload.id, topic, true);
      this.client.emit("chat_message", { id, topic, params: message });
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
