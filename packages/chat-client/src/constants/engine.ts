export const KEYSERVER_URL = "https://keys.walletconnect.com";

const ONE_DAY = 86400;

interface Opts {
  tag: number;
  ttl: number;
  prompt: boolean;
}

export const ENGINE_RPC_OPTS: Record<string, { req: Opts; res: Opts }> = {
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
      prompt: true,
      ttl: ONE_DAY,
    },
    res: {
      tag: 2007,
      prompt: false,
      ttl: ONE_DAY,
    },
  },
};
