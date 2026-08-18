import { adminProcedure, router } from "../_core/trpc";

export const terminalRouter = router({
  authorize: adminProcedure.query(({ ctx }) => {
    return {
      permitted: true,
      socketPath: "/api/terminal/socket" as const,
    } as const;
  }),
});
