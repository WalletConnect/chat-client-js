// TODO: @walletconnect/utils engineEvent is typed to SignClient Events only
// -> make typing generic and remove this duplicate.
export function engineEvent(event: string, id?: number | string | undefined) {
  return `${event}${id ? `:${id}` : ""}`;
}
