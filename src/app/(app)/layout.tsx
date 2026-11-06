import type { ReactNode } from "react";
import { AppRail } from "@/components/AppRail";
import styles from "./layout.module.css";

/** The app shell: navy rail + work area. Every tab renders its PageHeader inside main. */
export default function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className={styles.app}>
      <AppRail />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
