import { ChatClient } from "../src/client";

describe("ChatClient", () => {
  it("can be instantiated", () => {
    const client = new ChatClient();
    expect(client instanceof ChatClient).toBe(true);
    expect(client.core).toBeDefined();
  });
});
