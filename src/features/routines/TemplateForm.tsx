"use client";

import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTemplateAction, saveTemplateAction } from "@/app/(app)/routines/actions";
import { Button, ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Toast } from "@/components/Toast";
import type { RoutineConfig } from "@/lib/domain/routines";
import type { FormOptions } from "@/lib/routines/page";
import { ConfigEditor } from "./ConfigEditor";
import styles from "./routines.module.css";

/** A routine template: the reusable rules, without dates or accounts. */
export function TemplateForm({
  initial,
  options,
}: {
  initial: { id: string | null; name: string; description: string; config: RoutineConfig };
  options: FormOptions;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ message: string; id: number; tone?: "error" } | null>(null);
  const fail = (message: string) => {
    setToast({ message, id: Date.now(), tone: "error" });
  };

  return (
    <>
      <PageHeader
        title={v.id ? initial.name : "New template"}
        actions={
          <ButtonLink href="/routines" variant="ghost">
            <ArrowLeft aria-hidden="true" />
            Routines
          </ButtonLink>
        }
      />
      <div className={`${styles.page} ${styles.narrow}`}>
        <section className={styles.section} aria-labelledby="tname-h">
          <div className={styles.sectionHead}>
            <h2 id="tname-h">Template</h2>
          </div>
          <label className={styles.field}>
            Name
            <input
              className={styles.input}
              value={v.name}
              maxLength={80}
              placeholder="Trip campaign"
              onChange={(e) => {
                setV({ ...v, name: e.target.value });
              }}
            />
          </label>
          <label className={styles.field}>
            Description
            <input
              className={styles.input}
              value={v.description}
              maxLength={500}
              onChange={(e) => {
                setV({ ...v, description: e.target.value });
              }}
            />
          </label>
        </section>
        <ConfigEditor
          value={v.config}
          onChange={(config) => {
            setV({ ...v, config });
          }}
          options={options}
        />
        <section className={styles.section}>
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => {
                start(async () => {
                  const res = await saveTemplateAction(v.id, v);
                  if (!res.ok) fail(res.error);
                  else router.push("/routines");
                });
              }}
            >
              <Save aria-hidden="true" />
              Save template
            </Button>
            {v.id ? (
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => {
                  const templateId = v.id;
                  if (!templateId) return;
                  if (
                    !window.confirm("Delete this template? Routines made from it keep their rules.")
                  )
                    return;
                  start(async () => {
                    const res = await deleteTemplateAction(templateId);
                    if (!res.ok) fail(res.error);
                    else router.push("/routines");
                  });
                }}
              >
                <Trash2 aria-hidden="true" />
                Delete template
              </Button>
            ) : null}
          </div>
        </section>
      </div>
      <Toast
        message={toast?.message ?? null}
        id={toast?.id}
        tone={toast?.tone}
        onDone={() => {
          setToast(null);
        }}
      />
    </>
  );
}
