import { adminProcedure, router } from "../_core/trpc";
import { isTerminalOwner } from "../terminal";

export const terminalRouter = router({
  authorize: adminProcedure.query(({ ctx }) => {
    return {
      permitted: isTerminalOwner(ctx.user),
      socketPath: "/api/terminal/socket" as const,
    } as const;
  }),
});
