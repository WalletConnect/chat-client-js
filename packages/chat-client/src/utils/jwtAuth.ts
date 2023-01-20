import { base58btc } from "multiformats/bases/base58";
import bs58 from "bs58";
import ed25519 from "@noble/ed25519";

interface JwtHeader {
  typ: string;
  alg: string;
}

export const DAY_IN_MS = 86400 * 1000;

export const DID_METHOD_KEY = "key";
export const DID_DELIMITER = ".";
export const DID_PREFIX = "did";
export const DID_METHOD_PKH = "pkh";

export const JWT_DELIMITER = ".";

export const MULTICODEC_ED25519_HEADER = "K36";

export interface InviteKeyClaims {
  iss: string;
  sub: string;
  aud: string;
  pkh: string;
  iat: number;
  exp: number;
}

const concatUInt8Arrays = (array1: Uint8Array, array2: Uint8Array) => {
  const mergedArray = new Uint8Array(array1.length + array2.length);
  mergedArray.set(array1);
  mergedArray.set(array2, array1.length);

  return mergedArray;
};

export const encodeDidPkh = (accountId: string) => {
  return `${DID_PREFIX}${DID_PREFIX}${DID_METHOD_PKH}${DID_PREFIX}${accountId}`;
};

export const jwtExp = (issuedAt: number) => {
  return issuedAt + DAY_IN_MS;
};

export const encodeJwt = (
  header: JwtHeader,
  payload: InviteKeyClaims,
  signature: Uint8Array
) => {
  const encodedSignature = new TextDecoder().decode(signature);
  return `${JSON.stringify(header)}${JWT_DELIMITER}${JSON.stringify(
    payload
  )}${JWT_DELIMITER}${encodedSignature}`;
};

export const encodeData = (header: JwtHeader, payload: InviteKeyClaims) => {
  return `${JSON.stringify(header)}${JWT_DELIMITER}${JSON.stringify(payload)}`;
};

export const encodeIss = (publicKey: Uint8Array) => {
  const header = bs58.decode(MULTICODEC_ED25519_HEADER);
  const multicodec = base58btc.encode(concatUInt8Arrays(header, publicKey));

  return `${DID_PREFIX}${DID_PREFIX}${DID_METHOD_KEY}${DID_PREFIX}${multicodec}`;
};

export const generateJWT = async (
  invitePublicKey: string,
  identityKeyPair: [string, string],
  keyserverUrl: string,
  account: string
) => {
  const [publicKey, privateKey] = identityKeyPair;
  const issuer = encodeIss(ed25519.utils.hexToBytes(publicKey));
  const issuedAt = Date.now() / 1000;
  const expiration = jwtExp(issuedAt);
  const didPublicKey = encodeDidPkh(account);
  const payload: InviteKeyClaims = {
    iss: issuer,
    sub: invitePublicKey,
    aud: keyserverUrl,
    iat: issuedAt,
    exp: expiration,
    pkh: didPublicKey,
  };
  const header: JwtHeader = {
    alg: "EdDSA",
    typ: "jwt",
  };
  const data = encodeData(header, payload);

  const signature = await ed25519.sign(data, privateKey);

  return encodeJwt(header, payload, signature);
};
