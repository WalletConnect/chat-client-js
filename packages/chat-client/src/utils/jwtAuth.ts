import { base58btc } from "multiformats/bases/base58";
import bs58 from "bs58";
import * as ed25519 from "@noble/ed25519";
import { isValidObject } from "@walletconnect/utils";

interface JwtHeader {
  typ: string;
  alg: string;
}

export interface InviteKeyClaims {
  iss: string;
  sub: string;
  aud?: string;
  ksu?: string;
  pkh?: string;
  iat: number;
  exp: number;
}

export const DAY_IN_MS = 86400 * 1000;

export const DID_METHOD_KEY = "key";
export const DID_DELIMITER = ":";
export const DID_PREFIX = "did";
export const DID_METHOD_PKH = "pkh";

export const JWT_DELIMITER = ".";

export const MULTICODEC_ED25519_HEADER = "K36";

const concatUInt8Arrays = (array1: Uint8Array, array2: Uint8Array) => {
  const mergedArray = new Uint8Array(array1.length + array2.length);
  mergedArray.set(array1);
  mergedArray.set(array2, array1.length);

  return mergedArray;
};

export const composeDidPkh = (accountId: string) => {
  return `${DID_PREFIX}${DID_DELIMITER}${DID_METHOD_PKH}${DID_DELIMITER}${accountId}`;
};

export const jwtExp = (issuedAt: number) => {
  return issuedAt + DAY_IN_MS;
};

const objectToHex = (obj: unknown) => {
  if (!isValidObject(obj)) {
    throw new Error(`Supplied object is not valid ${JSON.stringify(obj)}`);
  }
  return Buffer.from(new TextEncoder().encode(JSON.stringify(obj))).toString(
    "base64url"
  );
};

export const encodeJwt = (
  header: JwtHeader,
  payload: InviteKeyClaims,
  signature: Uint8Array
) => {
  const encodedSignature = Buffer.from(signature).toString("base64url");

  return `${objectToHex(header)}${JWT_DELIMITER}${objectToHex(
    payload
  )}${JWT_DELIMITER}${encodedSignature}`;
};

export const encodeData = (header: JwtHeader, payload: InviteKeyClaims) => {
  const headerByteArray = objectToHex(header);
  const payloadByteArray = objectToHex(payload);
  return `${headerByteArray}${JWT_DELIMITER}${payloadByteArray}`;
};

export const encodeIss = (keyHex: string) => {
  const header = bs58.decode(MULTICODEC_ED25519_HEADER);
  const publicKey = ed25519.utils.hexToBytes(keyHex);
  const multicodec = base58btc.encode(concatUInt8Arrays(header, publicKey));

  return `${DID_PREFIX}${DID_DELIMITER}${DID_METHOD_KEY}${DID_DELIMITER}${multicodec}`;
};

export const generateJWT = async (
  invitePublicKey: string,
  identityKeyPair: [string, string],
  keyserverUrl: string,
  account: string,
  payload: InviteKeyClaims
) => {
  const [publicKey, privateKey] = identityKeyPair;

  const header: JwtHeader = {
    alg: "EdDSA",
    typ: "JWT",
  };
  const data = new TextEncoder().encode(encodeData(header, payload));

  const signature = await ed25519.sign(data, privateKey);

  return encodeJwt(header, payload, signature);
};
