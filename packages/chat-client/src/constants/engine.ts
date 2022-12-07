import { ONE_DAY, THIRTY_SECONDS } from "@walletconnect/time";
import { RelayerTypes } from "@walletconnect/types";
import { JsonRpcTypes } from "../types";

export const KEYSERVER_URL = "https://keys.walletconnect.com";

export const ENGINE_RPC_OPTS: Record<
  JsonRpcTypes.WcMethod,
  { req: RelayerTypes.PublishOptions; res: RelayerTypes.PublishOptions }
> = {
  wc_chatInvite: {
    req: {
      tag: 2000,
      prompt: true,
      ttl: ONE_DAY,
    },
    res: {
      tag: 2001,
      prompt: false,
      ttl: ONE_DAY,
    },
  },
  wc_chatMessage: {
    req: {
      tag: 2002,
      prompt: true,
      ttl: ONE_DAY,
    },
    res: {
      tag: 2003,
      prompt: false,
      ttl: ONE_DAY,
    },
  },
  wc_chatLeave: {
    req: {
      tag: 2004,
      prompt: true,
      ttl: ONE_DAY,
    },
    res: {
      tag: 2005,
      prompt: false,
      ttl: ONE_DAY,
    },
  },
  wc_chatPing: {
    req: {
      tag: 2006,
      prompt: false,
      ttl: THIRTY_SECONDS,
    },
    res: {
      tag: 2007,
      prompt: false,
      ttl: THIRTY_SECONDS,
    },
  },
};
