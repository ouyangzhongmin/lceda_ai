import type { CreditsClient } from "../../services/credits/creditsClient";
import type { SessionStore } from "../../services/auth/sessionStore";
import type { AgentTool } from "./toolRegistry";

export function createAccountTools(
  sessionStore: SessionStore,
  creditsClient: CreditsClient
): AgentTool[] {
  return [
    {
      name: "account.get_session",
      description: "Read the current plugin login session from local storage",
      execute: async () => {
        const session = await sessionStore.get();
        return {
          loggedIn: Boolean(session),
          session,
        };
      },
    },
    {
      name: "credits.get_balance",
      description: "Query the current user's Credits balance from the Go server",
      execute: async () => {
        const session = await sessionStore.get();
        if (!session) {
          throw new Error("not logged in");
        }

        return creditsClient.getBalance(session.accessToken);
      },
    },
  ];
}
