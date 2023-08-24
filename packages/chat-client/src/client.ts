import { Core, RELAYER_DEFAULT_RELAY_URL, Store } from "@walletconnect/core";
import {
  generateChildLogger,
  getDefaultLoggerOptions,
} from "@walletconnect/logger";
import { ICore } from "@walletconnect/types";
import EventEmitter from "events";
import pino from "pino";
import {
  CHAT_CLIENT_STORAGE_PREFIX,
  CHAT_CONTACTS_CONTEXT,
  CHAT_KEYS_CONTEXT,
  CHAT_MESSAGES_CONTEXT,
  CHAT_RECEIVED_INVITES_CONTEXT,
  CHAT_RECEIVED_INVITES_STATUS_CONTEXT,
  CHAT_SENT_INVITES_CONTEXT,
  CHAT_THREADS_CONTEXT,
  KEYSERVER_URL,
} from "./constants";

import { HistoryClient } from "@walletconnect/history";
import { IdentityKeys } from "@walletconnect/identity-keys";
import type {
  ISyncClient,
  SyncStore as TSyncStore,
} from "@walletconnect/sync-client";
import { hashKey } from "@walletconnect/utils";
import { ChatEngine } from "./controllers";
import { ChatClientTypes, IChatClient, InviteKeychain } from "./types";
import { fetchAndInjectHistory } from "./utils/historyUtil";

export class ChatClient extends IChatClient {
  public readonly name = "chatClient";
  public readonly keyserverUrl;

  public projectId: string;

  public core: ICore;
  public syncClient: ISyncClient | undefined;
  public historyClient: HistoryClient;
  public events = new EventEmitter();
  public logger: IChatClient["logger"];
  public chatSentInvites: IChatClient["chatSentInvites"];
  public chatReceivedInvites: IChatClient["chatReceivedInvites"];
  public chatReceivedInvitesStatus: IChatClient["chatReceivedInvitesStatus"];
  public chatThreads: IChatClient["chatThreads"];
  public chatMessages: IChatClient["chatMessages"];
  public chatContacts: IChatClient["chatContacts"];
  public chatKeys: IChatClient["chatKeys"];
  public identityKeys: IChatClient["identityKeys"];
  public engine: IChatClient["engine"];
  private SyncStoreController: typeof TSyncStore;

  static async init(opts: ChatClientTypes.Options) {
    const client = new ChatClient(opts);
    await client.initialize();

    return client;
  }

  constructor(opts: ChatClientTypes.Options) {
    super(opts);

    this.projectId = opts.projectId;

    this.syncClient = opts.syncClient;

    this.SyncStoreController = opts.SyncStoreController;

    const logger =
      typeof opts?.logger !== "undefined" && typeof opts?.logger !== "string"
        ? opts.logger
        : pino(
            getDefaultLoggerOptions({
              level: opts?.logger || "error",
            })
          );
    this.keyserverUrl = opts?.keyserverUrl ?? KEYSERVER_URL;

    this.core = opts?.core || new Core(opts);
    this.historyClient = new HistoryClient(this.core);

    this.logger = generateChildLogger(logger, this.name);
    this.chatSentInvites = new Store(
      this.core,
      this.logger,
      CHAT_SENT_INVITES_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX,
      (invite: ChatClientTypes.SentInvite) => invite.responseTopic
    );
    this.chatReceivedInvites = new Store(
      this.core,
      this.logger,
      CHAT_RECEIVED_INVITES_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX,
      (invite: ChatClientTypes.ReceivedInvite) => invite.id.toString()
    );
    this.chatThreads = new Store(
      this.core,
      this.logger,
      CHAT_THREADS_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
    this.chatMessages = new Store(
      this.core,
      this.logger,
      CHAT_MESSAGES_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
    this.chatKeys = new Store(
      this.core,
      this.logger,
      CHAT_KEYS_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX,
      (keys: InviteKeychain) => keys.account
    );
    this.chatContacts = new Store(
      this.core,
      this.logger,
      CHAT_CONTACTS_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
    this.chatReceivedInvitesStatus = new Store(
      this.core,
      this.logger,
      CHAT_RECEIVED_INVITES_STATUS_CONTEXT,
      CHAT_CLIENT_STORAGE_PREFIX
    );
    this.identityKeys = opts?.identityKeys ?? new IdentityKeys(this.core);
    this.engine = new ChatEngine(this);
  }

  // ---------- Public Methods ----------------------------------------------- //

  public register: IChatClient["register"] = async (params) => {
    try {
      return await this.engine.register(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public resolve: IChatClient["resolve"] = async (params) => {
    try {
      return await this.engine.resolveInvite(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public invite: IChatClient["invite"] = async (params) => {
    try {
      return await this.engine.invite(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public accept: IChatClient["accept"] = async (params) => {
    try {
      return await this.engine.accept(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public reject: IChatClient["reject"] = async (params) => {
    try {
      await this.engine.reject(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };
  public message: IChatClient["message"] = async (params) => {
    try {
      return await this.engine.sendMessage(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public ping: IChatClient["ping"] = async (params) => {
    try {
      return await this.engine.ping(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public leave: IChatClient["leave"] = async (params) => {
    try {
      return await this.engine.leave(params);
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public getSentInvites: IChatClient["getSentInvites"] = ({ account }) => {
    return this.chatSentInvites.getAll({ inviterAccount: account });
  };

  public getReceivedInvites: IChatClient["getReceivedInvites"] = ({
    account,
  }) => {
    return this.chatReceivedInvites.getAll({ inviteeAccount: account });
  };

  public getThreads: IChatClient["getThreads"] = (params) => {
    try {
      return this.chatThreads
        .getAll(
          params?.account
            ? {
                selfAccount: params.account,
              }
            : undefined
        )
        .reduce<Map<string, ChatClientTypes.Thread>>((threadMap, thread) => {
          threadMap.set(thread.topic.toString(), thread);
          return threadMap;
        }, new Map());
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public getMessages: IChatClient["getMessages"] = ({ topic }) => {
    try {
      return this.chatMessages.get(topic).messages;
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public goPublic: IChatClient["goPublic"] = async ({ account }) => {
    try {
      return this.engine.goPublic({ account });
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public goPrivate: IChatClient["goPrivate"] = async ({ account }) => {
    try {
      return this.engine.goPrivate({ account });
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  public unregister: IChatClient["unregister"] = async ({ account }) => {
    try {
      return this.engine.unregisterIdentity({ account });
    } catch (error: any) {
      this.logger.error(error.message);
      throw error;
    }
  };

  // ---------- Events ----------------------------------------------- //

  public emit: IChatClient["emit"] = (name, listener) => {
    return this.events.emit(name, listener);
  };

  public on: IChatClient["on"] = (name, listener) => {
    return this.events.on(name, listener);
  };

  public once: IChatClient["once"] = (name, listener) => {
    return this.events.once(name, listener);
  };

  public off: IChatClient["off"] = (name, listener) => {
    return this.events.off(name, listener);
  };

  public removeListener: IChatClient["removeListener"] = (name, listener) => {
    return this.events.removeListener(name, listener);
  };

  public initSyncStores: IChatClient["initSyncStores"] = async ({
    account,
    signature,
  }) => {
    if (!this.syncClient) return;

    this.chatKeys = new this.SyncStoreController(
      CHAT_KEYS_CONTEXT,
      this.syncClient,
      account,
      signature,
      (_, newKeyChain) => {
        if (!newKeyChain) return;

        this.core.crypto.keychain.set(
          newKeyChain.publicKey,
          newKeyChain.privateKey
        );

        const inviteTopic = hashKey(newKeyChain.publicKey);
        if (!this.core.relayer.subscriber.topics.includes(inviteTopic)) {
          this.core.relayer.subscribe(inviteTopic);
        }
      }
    );

    this.chatReceivedInvitesStatus = new this.SyncStoreController(
      CHAT_RECEIVED_INVITES_STATUS_CONTEXT,
      this.syncClient,
      account,
      signature,
      (_, invite) => {
        if (!invite) return;

        this.chatReceivedInvites.update(invite.id.toString(), {
          status: invite.status,
        });
      }
    );

    this.chatSentInvites = new this.SyncStoreController(
      CHAT_SENT_INVITES_CONTEXT,
      this.syncClient,
      account,
      signature,
      (_, invite) => {
        if (!invite) {
          return;
        }

        this.core.crypto.keychain.set(
          invite.inviterPubKeyY,
          invite.inviterPrivKeyY
        );

        if (
          this.core.relayer.subscriber.topics.includes(invite.responseTopic)
        ) {
          return;
        }

        // Accepting an invite will trigger a call for `core.history.resolve`. Create fake history entry so that sync peer can handle
        // accepting the invite
        this.core.history.set(invite.responseTopic, {
          id: invite.id,
          jsonrpc: "2.0",
          method: "chat_invite",
          params: {},
        });
        this.core.crypto.setSymKey(invite.symKey, invite.responseTopic);
        this.core.relayer.subscribe(invite.responseTopic);
      }
    );

    this.chatThreads = new this.SyncStoreController(
      CHAT_THREADS_CONTEXT,
      this.syncClient,
      account,
      signature,
      (_, thread) => {
        if (!thread) return;
        this.core.crypto.setSymKey(thread.symKey, thread.topic);

        new Promise((resolve) => {
          if (!this.chatMessages.getAll({ topic: thread.topic }).length) {
            fetchAndInjectHistory(thread.topic, "thread", this.historyClient)
              .catch((e) => this.logger.error(e.message))
              .then(resolve);
          }
        });

        if (this.core.relayer.subscriber.topics.includes(thread.topic)) {
          return;
        }

        this.core.relayer.subscribe(thread.topic);

        const invites = this.chatReceivedInvites.getAll({
          inviterAccount: thread?.peerAccount,
        });

        if (invites.length === 0) return;

        const { id } = invites[0];

        this.chatReceivedInvites.update(id.toString(), { status: "approved" });
      }
    );

    const historyFetchedStores = [
      CHAT_THREADS_CONTEXT,
      CHAT_SENT_INVITES_CONTEXT,
    ];

    const stores = this.syncClient.storeMap
      .getAll({ account })
      .filter((store) => {
        return historyFetchedStores.includes(store.key);
      });

    stores.forEach((store) => {
      fetchAndInjectHistory(store.topic, store.key, this.historyClient).catch(
        (e) => this.logger.error(e.message)
      );
    });

    await this.chatSentInvites.init();
    await this.chatReceivedInvitesStatus.init();
    await this.chatThreads.init();
    await this.chatKeys.init();

    // JS Implementation event
    this.emit("sync_stores_initialized", {});
  };

  // ---------- Private ----------------------------------------------- //

  private async initialize() {
    this.logger.trace(`Initialized`);

    try {
      // Use active account to init stores
      if (this.syncClient && this.syncClient.signatures.length > 0) {
        const signatureEntry = this.syncClient.signatures.getAll({
          active: true,
        })[0];
        await this.initSyncStores({
          account: signatureEntry.account,
          signature: signatureEntry.signature,
        });
      }

      await this.historyClient.registerTags({
        relayUrl: this.core.relayUrl || RELAYER_DEFAULT_RELAY_URL,
        tags: ["2000", "2001", "2002", "2003", "2004", "2005"],
      });

      await this.core.start();
      await this.chatMessages.init();
      await this.chatReceivedInvites.init();
      await this.chatReceivedInvitesStatus.init();
      await this.chatKeys.init();
      await this.chatContacts.init();
      await this.identityKeys.init();
      await this.engine.init();

      this.logger.info(`ChatClient Initialization Success`);
    } catch (error: any) {
      this.logger.info(`ChatClient Initialization Failure`);
      this.logger.error(error.message);
      throw error;
    }
  }
}
