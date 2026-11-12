"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { newVideo } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { Toast } from "@/components/Toast";

/** Creates a draft video and opens it. */
export function NewVideoButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="primary"
        disabled={pending}
        onClick={() => {
          start(async () => {
            const res = await newVideo({});
            if (res.ok) router.push(`/factory/${res.value}`);
            else setError(res.error);
          });
        }}
      >
        <Plus aria-hidden="true" />
        New video
      </Button>
      <Toast
        message={error}
        tone="error"
        onDone={() => {
          setError(null);
        }}
      />
    </>
  );
}
