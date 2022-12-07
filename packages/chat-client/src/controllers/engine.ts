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
  createDelayedPromise,
  getSdkError,
  hashKey,
  TYPE_1,
} from "@walletconnect/utils";
import axios from "axios";
import EventEmitter from "events";
import { ENGINE_RPC_OPTS, KEYSERVER_URL } from "../constants";

import { IChatClient, IChatEngine } from "../types";
import { JsonRpcTypes } from "../types/jsonrpc";
import { engineEvent } from "../utils/engineUtil";

const SELF_INVITE_PUBLIC_KEY_NAME = "selfInvitePublicKey";
const INVITE_PROPOSER_PUBLIC_KEY_NAME = "inviteProposerPublicKey";

export class ChatEngine extends IChatEngine {
  private initialized = false;
  private events = new EventEmitter();

  constructor(client: IChatClient) {
    super(client);
  }

  public init: IChatEngine["init"] = async () => {
    if (!this.initialized) {
      // await this.cleanup();
      if (this.client.chatKeys.keys.includes(SELF_INVITE_PUBLIC_KEY_NAME)) {
        await this.subscribeToSelfInviteTopic();
      }
      this.registerRelayerEvents();
      // this.registerExpirerEvents();
      this.initialized = true;
    }
  };

  public register: IChatEngine["register"] = async ({ account }) => {
    // TODO (post-MVP): preflight validation (is valid account, is account already registered, handle `private` flag param)
    let publicKey;
    try {
      const { publicKey: storedPublicKey } = this.client.chatKeys.get(
        SELF_INVITE_PUBLIC_KEY_NAME
      );
      publicKey = storedPublicKey;
    } catch (err) {
      // Generate a publicKey to be associated with this account.
      publicKey = await this.client.core.crypto.generateKeyPair();

      // Register on the keyserver via POST request.
      await axios.post(`${KEYSERVER_URL}/register`, {
        account,
        publicKey,
      });

      await this.client.chatKeys.set(SELF_INVITE_PUBLIC_KEY_NAME, {
        account,
        publicKey,
        _key: SELF_INVITE_PUBLIC_KEY_NAME,
      });
    }
    // Subscribe to the inviteTopic once we've registered on the keyserver.
    await this.subscribeToSelfInviteTopic();

    return publicKey;
  };

  public resolve: IChatEngine["resolve"] = async ({ account }) => {
    // TODO: preflight validation (is valid account, ...)

    // Resolve the publicKey for the given account via keyserver.
    const { data } = await axios.get(
      `${KEYSERVER_URL}/resolve?account=${account}`
    );
    const { publicKey } = data;

    return publicKey;
  };

  public invite: IChatEngine["invite"] = async ({ account, invite }) => {
    // resolve peer account pubKey X
    const responderInvitePublicKey = await this.client.resolve({ account });

    // generate a keyPair Y to encrypt the invite with derived DH symKey I.
    const proposerInvitePublicKey =
      await this.client.core.crypto.generateKeyPair();

    await this.client.chatKeys.set(INVITE_PROPOSER_PUBLIC_KEY_NAME, {
      publicKey: proposerInvitePublicKey,
      _key: INVITE_PROPOSER_PUBLIC_KEY_NAME,
    });

    console.log(
      "INVITE_PROPOSER_PUBLIC_KEY:",
      this.client.chatKeys.get(INVITE_PROPOSER_PUBLIC_KEY_NAME)
    );

    console.log(
      "invite > responderInvitePublicKey: ",
      responderInvitePublicKey
    );

    // invite topic is derived as the hash of the publicKey X.
    const inviteTopic = hashKey(responderInvitePublicKey);
    const completeInvite = {
      ...invite,
      publicKey: proposerInvitePublicKey,
    };

    console.log("invite > inviteTopic: ", inviteTopic);

    // send invite encrypted with type 1 envelope to the invite topic including publicKey Y.
    const inviteId = await this.sendRequest(
      inviteTopic,
      "wc_chatInvite",
      completeInvite,
      {
        type: TYPE_1,
        senderPublicKey: proposerInvitePublicKey,
        receiverPublicKey: responderInvitePublicKey,
      }
    );

    // TODO: needed? persist invite
    // await this.client.chatInvites.set(inviteId, completeInvite);

    // subscribe to response topic: topic R (response) = hash(symKey I)
    // TODO: abstract this responseTopic derivation here and in onIncoming into reusable helper
    const topicSymKeyI = await this.client.core.crypto.generateSharedKey(
      proposerInvitePublicKey,
      responderInvitePublicKey
    );
    const symKeyI = this.client.core.crypto.keychain.get(topicSymKeyI);
    const responseTopic = hashKey(symKeyI);
    console.log("invite > symKeyI", symKeyI);
    console.log("invite > subscribe > responseTopic:", responseTopic);

    await this.client.core.relayer.subscribe(responseTopic);

    await this.client.chatThreadsPending.set(responseTopic, {
      topic: responseTopic,
      selfAccount: invite.account,
      peerAccount: account,
    });

    console.log("invite > chatThreadsPending.set: ", account, {
      topic: responseTopic,
      selfAccount: invite.account,
      peerAccount: account,
    });

    return inviteId;
  };

  public accept: IChatEngine["accept"] = async ({ id }) => {
    const invite = this.client.chatInvites.get(id);

    // Response topic is derived as the hash of the symKey I.
    // NOTE: This is a very roundabout way to get back to symKey I by re-deriving,
    // since crypto.decode doesn't expose it.
    // Can we simplify this?
    const { publicKey: selfInvitePublicKey, account: selfAccount } =
      this.client.chatKeys.get(SELF_INVITE_PUBLIC_KEY_NAME);
    console.log(
      "accept > this.client.chatKeys.get('invitePublicKey'): ",
      selfInvitePublicKey
    );
    const topicSymKeyI = await this.client.core.crypto.generateSharedKey(
      selfInvitePublicKey,
      invite.publicKey
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
      invite.publicKey
    );
    const symKeyT = this.client.core.crypto.keychain.get(topicSymKeyT);
    console.log("accept > symKeyT:", symKeyT);

    // Thread topic is derived as the hash of the symKey T.
    const chatThreadTopic = hashKey(symKeyT);

    // B sends response with publicKey Z on response topic encrypted with type 0 envelope.
    await this.sendResult<"wc_chatInvite">(id, responseTopic, {
      publicKey: publicKeyZ,
    });

    // Subscribe to the chat thread topic.
    await this.client.core.relayer.subscribe(chatThreadTopic);

    console.log("accept > chatThreadTopic:", chatThreadTopic);

    await this.client.chatThreads.set(chatThreadTopic, {
      topic: chatThreadTopic,
      selfAccount,
      peerAccount: invite.account,
    });

    console.log("accept > chatThreads.set:", chatThreadTopic, {
      topic: chatThreadTopic,
      selfAccount,
      peerAccount: invite.account,
    });

    // TODO (post-mvp): decide on a code to use for this.
    await this.client.chatInvites.delete(id, {
      code: -1,
      message: "Invite accepted.",
    });

    console.log("accept > chatInvites.delete:", id);

    return chatThreadTopic;
  };

  public reject: IChatEngine["reject"] = async ({ id }) => {
    const invite = this.client.chatInvites.get(id);
    const { publicKey: selfInvitePublicKey } = this.client.chatKeys.get(
      SELF_INVITE_PUBLIC_KEY_NAME
    );

    const topicSymKeyI = await this.client.core.crypto.generateSharedKey(
      selfInvitePublicKey,
      invite.publicKey
    );
    const symKeyI = this.client.core.crypto.keychain.get(topicSymKeyI);
    const responseTopic = hashKey(symKeyI);
    console.log("reject > symKeyI", symKeyI);
    console.log("reject > responseTopic:", responseTopic);

    await this.sendError(id, responseTopic, getSdkError("USER_REJECTED"));

    await this.client.chatInvites.delete(id, {
      code: -1,
      message: "Invite rejected.",
    });

    console.log("reject > chatInvites.delete:", id);
  };

  public sendMessage: IChatEngine["sendMessage"] = async ({
    topic,
    payload,
  }) => {
    // TODO (post-MVP): preflight validation (is valid message, ...)

    await this.sendRequest(topic, "wc_chatMessage", payload);

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
    this.setMessage(topic, payload);
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
    this.client.history.set(topic, payload);

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
    const record = await this.client.history.get(topic, id);
    const rpcOpts = ENGINE_RPC_OPTS[record.request.method].res;
    await this.client.core.relayer.publish(topic, message, rpcOpts);
    await this.client.history.resolve(payload);
  };

  protected sendError: IChatEngine["sendError"] = async (
    id,
    topic,
    error,
    opts
  ) => {
    const payload = formatJsonRpcError(id, error);
    const message = await this.client.core.crypto.encode(topic, payload, opts);
    await this.client.core.relayer.publish(topic, message);
    await this.client.history.resolve(payload);
  };

  protected subscribeToSelfInviteTopic = async () => {
    const { publicKey: selfInvitePublicKey } = this.client.chatKeys.get(
      SELF_INVITE_PUBLIC_KEY_NAME
    );
    console.log(">>>>>>>>> selfInvitePublicKey:", selfInvitePublicKey);

    const selfInviteTopic = hashKey(selfInvitePublicKey);
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
        const selfInvitePublicKeyEntry = this.client.chatKeys.keys.includes(
          SELF_INVITE_PUBLIC_KEY_NAME
        )
          ? this.client.chatKeys.get(SELF_INVITE_PUBLIC_KEY_NAME)
          : {};
        console.log(
          ">>>>>>> receiverPublicKey: ",
          selfInvitePublicKeyEntry.publicKey
        );
        const payload = await this.client.core.crypto.decode(topic, message, {
          receiverPublicKey: selfInvitePublicKeyEntry.publicKey,
        });
        if (isJsonRpcRequest(payload)) {
          this.client.history.set(topic, payload);
          this.onRelayEventRequest({ topic, payload });
        } else if (isJsonRpcResponse(payload)) {
          await this.client.history.resolve(payload);
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
    const record = await this.client.history.get(topic, payload.id);
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
      console.log("payload:", payload);
      await this.client.chatInvites.set(id, { ...params, id });
      this.client.emit("chat_invite", {
        id,
        topic: inviteTopic,
        params,
      });
    } catch (err: any) {
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
      const { publicKey: inviteProposerPublicKey } = this.client.chatKeys.get(
        INVITE_PROPOSER_PUBLIC_KEY_NAME
      );
      const topicSymKeyT = await this.client.core.crypto.generateSharedKey(
        inviteProposerPublicKey,
        payload.result.publicKey
      );
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
      this.setMessage(topic, params);
      await this.sendResult<"wc_chatMessage">(payload.id, topic, true);
      this.client.emit("chat_message", { id, topic, params });
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