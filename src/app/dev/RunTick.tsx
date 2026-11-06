"use client";

import { Play } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/Button";
import { runSandboxTick, type TickState } from "./actions";
import styles from "./dev.module.css";

const INITIAL: TickState = { message: "", runs: 0 };

/** "Run tick now": advances the Sandbox's due posts one step, as the cron job would. */
export function RunTick() {
  const [state, action, pending] = useActionState(runSandboxTick, INITIAL);
  return (
    <form action={action} className={styles.tick}>
      <Button type="submit" variant="primary" disabled={pending}>
        <Play aria-hidden="true" />
        Run tick now
      </Button>
      <span role="status" data-testid="tick-result" data-runs={state.runs}>
        {pending ? "Running…" : state.message}
      </span>
    </form>
  );
}
