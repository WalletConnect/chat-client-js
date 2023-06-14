import { HistoryClient } from "@walletconnect/history";

export const fetchAndInjectHistory = async (
  topic: string,
  name: string,
  historyClient: HistoryClient
) => {
  try {
    const messages = await historyClient.getMessages({
      topic,
      direction: "backward",
      messageCount: 200,
    });
    await messages.injectIntoRelayer();
  } catch (e: any) {
    throw new Error(
      `Failed to fetch and inject history for ${name}: ${e.message}`
    );
  }
};
