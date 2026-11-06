import { FlaskConical } from "lucide-react";
import styles from "./SandboxMarker.module.css";

interface SandboxMarkerProps {
  onSwitchWorkspace: (formData: FormData) => void | Promise<void>;
}

/** Persistent strip above the top bar while the Sandbox workspace is shown (ADR 0003). */
export function SandboxMarker({ onSwitchWorkspace }: SandboxMarkerProps) {
  return (
    <div className={styles.marker} role="status" data-testid="sandbox-marker">
      <FlaskConical aria-hidden="true" />
      <span>
        <b>Sandbox: example data.</b> Nothing here is posted to real accounts.
      </span>
      <form action={onSwitchWorkspace} className={styles.form}>
        <button type="submit" name="workspace" value="live" className={styles.link}>
          Switch to Live
        </button>
      </form>
    </div>
  );
}
