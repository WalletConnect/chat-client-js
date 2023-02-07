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
  getSdkError,
  hashKey,
  TYPE_1,
} from "@walletconnect/utils";
import axios from "axios";
import EventEmitter from "events";
import { ENGINE_RPC_OPTS, KEYSERVER_URL } from "../constants";
import * as ed25519 from "@noble/ed25519";
import {
  ChatClientTypes,
  IChatClient,
  IChatEngine,
  JsonRpcTypes,
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
import { isAddress } from "@ethersproject/address";

export class ChatEngine extends IChatEngine {
  private initialized = false;
  private currentAccount = "";
  private events = new EventEmitter();
  private keyserverUrl = KEYSERVER_URL;

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

  // type invite has to be called after type identity
  private generateAndStoreKeyserverKeys = async (
    accountId: string,
    type: "invite" | "identity"
  ) => {
    if (type === "invite") {
      const pubKeyHex = await this.client.core.crypto.generateKeyPair();
      const privKeyHex = this.client.core.crypto.keychain.get(pubKeyHex);
      this.client.chatKeys.update(accountId, {
        inviteKeyPriv: privKeyHex,
        inviteKeyPub: pubKeyHex,
      });
      return pubKeyHex;
    } else if (type === "identity") {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = await ed25519.getPublicKey(privateKey);

      const pubKeyHex = ed25519.utils.bytesToHex(publicKey).toLowerCase();
      const privKeyHex = ed25519.utils.bytesToHex(privateKey).toLowerCase();
      this.client.core.crypto.keychain.set(pubKeyHex, privKeyHex);
      this.client.chatKeys.set(accountId, {
        identityKeyPriv: privKeyHex,
        identityKeyPub: pubKeyHex,
        inviteKeyPriv: "",
        inviteKeyPub: "",
      });
      return pubKeyHex;
    }

    throw new Error("Invalid type provided");
  };

  private generateIdAuth = (accountId: string, payload: InviteKeyClaims) => {
    const { identityKeyPub, identityKeyPriv } =
      this.client.chatKeys.get(accountId);

    return generateJWT([identityKeyPub, identityKeyPriv], payload);
  };

  private registerIdentity = async (
    accountId: string,
    onSign: (message: string) => Promise<string>,
    priv = false
  ): Promise<string> => {
    try {
      const storedKeyPair = this.client.chatKeys.get(accountId);
      return storedKeyPair.identityKeyPub;
    } catch {
      const pubKeyHex = await this.generateAndStoreKeyserverKeys(
        accountId,
        "identity"
      );
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
      const pubKeyHex = await this.generateAndStoreKeyserverKeys(
        accountId,
        "invite"
      );

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
    const identityKey = await this.registerIdentity(account, onSign);
    await this.registerInvite(account, false);

    this.currentAccount = account;

    await this.subscribeToSelfInviteTopic();

    return identityKey;
  };

  public resolveIdentity: IChatEngine["resolveIdentity"] = async ({
    publicKey,
  }) => {
    console.log("RESOLVEIDENTITY >>", { publicKey });
    const url = `${KEYSERVER_URL}/identity?publicKey=${
      publicKey.split(":")[2]
    }`;

    try {
      const { data } = await axios.get<{ value: { cacao: Cacao } }>(url);
      return data.value.cacao;
    } catch (e: any) {
      console.error(e.toJSON());
      throw new Error("Failed");
    }
  };

  public resolveInvite: IChatEngine["resolveInvite"] = async ({ account }) => {
    const url = `${KEYSERVER_URL}/invite?account=${account}`;

    console.log("Fetching invite acc", url);

    try {
      const { data } = await axios.get<{ value: { inviteKey: string } }>(url);
      return ed25519.utils.bytesToHex(decodeX25519Key(data.value.inviteKey));
    } catch {
      throw new Error("No invite key found");
    }
  };

  public invite: IChatEngine["invite"] = async ({
    inviteeAccount,
    inviteePublicKey,
    inviterAccount,
    message,
  }) => {
    // resolve peer account pubKey X

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
      aud: inviteeAccount,
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
      { idAuth },
      {
        type: TYPE_1,
        senderPublicKey: pubkeyY,
        receiverPublicKey: pubkeyX,
      }
    );

    this.client.chatSentInvites.set(inviteId, {
      inviteeAccount,
      id: inviteId,
      status: "pending",
      inviterAccount,
      message,
    });

    await this.client.chatThreadsPending.set(responseTopic, {
      topic: responseTopic,
      selfAccount: inviterAccount,
      peerAccount: inviteeAccount,
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

    const decodedInvitePubKey = ed25519.utils.bytesToHex(
      decodeX25519Key(invite.inviterPublicKey)
    );

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
      idAuth,
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

    // TODO (post-mvp): decide on a code to use for this.
    await this.client.chatReceivedInvites.delete(id, {
      code: -1,
      message: "Invite accepted.",
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

    await this.client.chatReceivedInvites.delete(id, {
      code: -1,
      message: "Invite rejected.",
    });

    console.log("reject > chatInvites.delete:", id);
  };

  public sendMessage: IChatEngine["sendMessage"] = async (payload) => {
    // TODO (post-MVP): preflight validation (is valid message, ...)
    const keys = this.client.chatKeys.get(this.currentAccount);
    const iat = payload.timestamp;
    const messagePayload: InviteKeyClaims = {
      iat,
      exp: jwtExp(iat),
      iss: encodeEd25519Key(keys.identityKeyPub),
      sub: payload.message,
      ksu: this.keyserverUrl,
      aud: composeDidPkh(
        this.client.chatThreads.get(payload.topic).peerAccount
      ),
    };

    await this.sendRequest(payload.topic, "wc_chatMessage", {
      idAuth: await this.generateIdAuth(this.currentAccount, messagePayload),
    });

    console.log("----- SEND MSG");

    // const {
    //   done: acknowledged,
    //   resolve,
    //   reject,
    // } = createDelayedPromise<void>();
    // this.events.once(engineEvent("chat_message", id), ({ error }) => {
    //   if (error) reject(error);
    //   else resolve();
    // });
    // await acknowledged();

    console.log("SEND MSG ACK --------");

    // Set message in ChatMessages store, keyed by thread topic T.
    this.setMessage(payload.topic, payload);
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
        const { topic, message } = event;
        if (!this.client.chatKeys.keys.includes(this.currentAccount)) {
          return;
        }
        const selfKeys = this.client.chatKeys.get(this.currentAccount);

        const payload = await this.client.core.crypto.decode(topic, message, {
          receiverPublicKey: selfKeys.inviteKeyPub,
        });
        if (isJsonRpcRequest(payload)) {
          this.client.core.history.set(topic, payload);
          this.onRelayEventRequest({ topic, payload });
        } else if (isJsonRpcResponse(payload)) {
          await this.client.core.history.resolve(payload);
          this.onRelayEventResponse({ topic, payload });
        }
      }
    );
  }

  protected onRelayEventRequest: IChatEngine["onRelayEventRequest"] = (
    event
  ) => {
    const { topic, payload } = event;
    const reqMethod = payload.method as JsonRpcTypes.WcMethod;

    switch (reqMethod) {
      case "wc_chatInvite":
        return this.onIncomingInvite(topic, payload);
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
    payload
  ) => {
    try {
      const { id, params } = payload;

      const decodedPayload = jwt.decode(params.idAuth, {
        json: true,
      }) as Record<string, string>;

      if (!decodedPayload) throw new Error("Empty ID Auth payload");

      const { inviteKeyPub } = this.client.chatKeys.get(decodedPayload.aud);

      const invitePayload: ChatClientTypes.ReceivedInvite = {
        id,
        inviteeAccount: decodedPayload.aud,
        message: decodedPayload.sub,
        inviterAccount: (
          await this.resolveIdentity({
            publicKey: decodedPayload.iss,
          })
        ).p.iss,
        inviteePublicKey: inviteKeyPub,
        inviterPublicKey: decodedPayload.pke,
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
    console.log("onInviteResponse:", topic, payload);
    // TODO (post-MVP): input validation
    if (isJsonRpcResult(payload)) {
      const pubkeyY = this.client.core.crypto.keychain.get(`${topic}-pubkeyY`);
      const decodedPayload = jwt.decode(payload.result.idAuth, {
        json: true,
      }) as Record<string, string>;

      if (!decodedPayload) throw new Error("Empty ID Auth payload");

      const topicSymKeyT = await this.client.core.crypto.generateSharedKey(
        pubkeyY,
        ed25519.utils.bytesToHex(decodeX25519Key(decodedPayload.sub))
      );

      console.log("INVITE_RESPONSE >>>>>>>>>>> ", {
        topicSymKeyT,
      });

      const symKeyT = this.client.core.crypto.keychain.get(topicSymKeyT);

      // Thread topic is derived as the hash of the symKey T.
      const chatThreadTopic = hashKey(symKeyT);
      console.log("onInviteResponse > symKeyT:", symKeyT);
      console.log("onInviteResponse > chatThreadTopic: ", chatThreadTopic);

      // Subscribe to the chat thread topic.
      await this.client.core.relayer.subscribe(chatThreadTopic);

      const { selfAccount, peerAccount } =
        this.client.chatThreadsPending.get(topic);

      await this.client.chatThreads.set(chatThreadTopic, {
        topic: chatThreadTopic,
        selfAccount,
        peerAccount,
      });

      console.log("onInviteResponse > chatThreads.set: ", chatThreadTopic, {
        topic: chatThreadTopic,
        selfAccount,
        peerAccount,
      });

      // TODO (post-mvp): decide on a code to use for this.
      await this.client.chatThreadsPending.delete(topic, {
        code: -1,
        message: "Peer accepted invite.",
      });
      console.log("onInviteResponse > chatThreadsPending.delete: ", topic);

      this.client.emit("chat_joined", {
        id: payload.id,
        topic: chatThreadTopic,
      });
    } else if (isJsonRpcError(payload)) {
      this.client.logger.error(payload.error);
      if (payload.error.message === getSdkError("USER_REJECTED").message) {
        console.log("rejected invite... deleting", payload);
        this.onRejectedChatInvite({ topic });
      }
    }
  };

  protected onRejectedChatInvite: IChatEngine["onRejectedChatInvite"] = async ({
    topic,
  }) => {
    await this.client.chatThreadsPending.delete(topic, {
      code: -1,
      message: "Invite rejected.",
    });

    console.log("reject > chatThreadsPending.delete:", topic);
  };

  protected onIncomingMessage: IChatEngine["onIncomingMessage"] = async (
    topic,
    payload
  ) => {
    const { params, id } = payload;
    try {
      // TODO (post-MVP): input validation
      console.log("GOT MESSAGE >>", { params });
      const decodedPayload = jwt.decode(params.idAuth, {
        json: true,
      }) as Record<string, string>;

      console.log("MESSAGE DECODED", decodedPayload);

      const cacao = await this.resolveIdentity({
        publicKey: decodedPayload.iss,
      });

      console.log("GOT MESSAGE CACAO", cacao);

      const message: ChatClientTypes.Message = {
        topic,
        message: decodedPayload.sub,
        authorAccount: cacao.p.iss.split(":").slice(2).join(":"),
        timestamp: new Date(decodedPayload.iat).getTime(),
      };

      console.log("MESSAGE IS >>>", message);
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
