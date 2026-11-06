"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { BrandRef } from "@/lib/domain/accounts";
import {
  LAST_STEP,
  NEW_BRAND,
  WIZARD_STEPS,
  addedMessage,
  emptyDraft,
  stepComplete,
  type ConnectedAccount,
  type WizardDraft,
  type WizardStep,
} from "@/lib/domain/add-account";
import { CONNECT_ERRORS, isConnectErrorCode } from "@/lib/domain/connect";
import {
  CONNECT_CHANNEL,
  CONNECT_RETURN_KEY,
  CONNECT_WINDOW_NAME,
  isConnectMessage,
  type ConnectMessage,
} from "../connect-message";
import type { AccountsActions } from "../table/actions";
import { ConnectStep, type ConnectState } from "./ConnectStep";
import { clearDraft, loadDraft, saveDraft, takeConnectResult } from "./draft-storage";
import { LoginStep, PlatformStep, PostingStep, SignupStep } from "./steps";
import styles from "./wizard.module.css";

export type WizardActions = Pick<
  AccountsActions,
  "addBrand" | "readConnectedAccount" | "finishAddAccount"
>;

export interface AddAccountWizardProps {
  workspace: { id: string; kind: "live" | "sandbox" };
  brands: readonly BrandRef[];
  /** Every tag in use (suggestions). */
  allTags: readonly string[];
  actions: WizardActions;
  onClose: () => void;
  /** After Finish, with the toast's words. */
  onAdded: (message: string) => void;
}

/** Where the same-tab connect (pop-up blocked) comes back to; the page reopens the wizard. */
const RETURN_PATH = "/accounts";
const POPUP_FEATURES = "popup,width=520,height=760";

/**
 * The Add account wizard (Accounts → Add account): platform and brand, the Instagram sign-up
 * checklist, the password-manager link, connecting, and posting setup. The draft survives closing
 * the wizard (sessionStorage) until the account is added.
 */
export function AddAccountWizard({
  workspace,
  brands: brandsProp,
  allTags,
  actions,
  onClose,
  onAdded,
}: AddAccountWizardProps) {
  // Brands created on step 1 show before the page's data refreshes.
  const [created, setCreated] = useState<BrandRef[]>([]);
  const brands = [...brandsProp, ...created.filter((c) => !brandsProp.some((b) => b.id === c.id))];
  const [draft, setDraft] = useState<WizardDraft>(
    () => loadDraft(workspace.id, brandsProp) ?? emptyDraft(brandsProp),
  );
  const [connected, setConnected] = useState<ConnectedAccount | null>(null);
  const [connect, setConnect] = useState<ConnectState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const popup = useRef<Window | null>(null);

  const update = useCallback((patch: Partial<WizardDraft>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  useEffect(() => {
    saveDraft(workspace.id, draft);
  }, [workspace.id, draft]);

  // ── connecting ──
  const readAccount = useCallback(
    async (accountId: string, fromConnect: boolean) => {
      setConnect({ kind: "reading" });
      const res = await actions.readConnectedAccount(accountId);
      if (!res.ok) {
        setConnected(null);
        setDraft((d) => ({
          ...d,
          accountId: null,
          step: d.step > 3 ? 3 : d.step,
        }));
        setConnect(fromConnect ? { kind: "error", message: res.error } : { kind: "idle" });
        return;
      }
      const account = res.value;
      setConnected(account);
      setConnect({ kind: "idle" });
      setDraft((d) => {
        if (!fromConnect && d.accountId === account.id) return d;
        // A reconnected account keeps the setup it already has.
        return {
          ...d,
          accountId: account.id,
          tags: account.tags.length > 0 ? account.tags : d.tags,
          description: account.description || d.description,
          slots: account.slots.length > 0 ? account.slots : d.slots,
        };
      });
    },
    [actions],
  );

  const onMessage = useCallback(
    (msg: ConnectMessage) => {
      popup.current?.close();
      popup.current = null;
      if (msg.accountId) {
        void readAccount(msg.accountId, true);
      } else {
        const code = isConnectErrorCode(msg.error) ? msg.error : "failed";
        setConnect({ kind: "error", message: CONNECT_ERRORS[code] });
      }
    },
    [readAccount],
  );

  // Only a connect this wizard started is listened to (BroadcastChannel reaches every tab).
  const waiting = connect.kind === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const onWindowMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !isConnectMessage(e.data)) return;
      onMessage(e.data);
    };
    window.addEventListener("message", onWindowMessage);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CONNECT_CHANNEL);
      channel.onmessage = (e: MessageEvent) => {
        if (isConnectMessage(e.data)) onMessage(e.data);
      };
    } catch {
      // No BroadcastChannel: the opener message still arrives.
    }
    return () => {
      window.removeEventListener("message", onWindowMessage);
      channel?.close();
    };
  }, [waiting, onMessage]);

  // On opening: a same-tab connect's result, else the draft's account read back.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const result = takeConnectResult();
    if (result) {
      setDraft((d) => ({ ...d, step: 3 }));
      onMessage(result);
    } else if (draft.accountId) {
      void readAccount(draft.accountId, false);
    }
  }, [draft.accountId, onMessage, readAccount]);

  const startConnect = () => {
    if (draft.brandId === NEW_BRAND) return;
    const url = `/api/connect/instagram/start?brand=${encodeURIComponent(draft.brandId)}`;
    setConnect({ kind: "waiting" });
    const win = window.open(url, CONNECT_WINDOW_NAME, POPUP_FEATURES);
    if (win) {
      popup.current = win;
      win.focus();
      return;
    }
    // Pop-up blocked: connect in this tab; the done page brings the result back here.
    saveDraft(workspace.id, { ...draft, step: 3 });
    try {
      sessionStorage.setItem(CONNECT_RETURN_KEY, RETURN_PATH);
    } catch {
      // Without storage the done page goes to Accounts and the wizard reopens at Connect.
    }
    window.location.assign(url);
  };

  // ── navigation ──
  const step = draft.step;
  const complete = stepComplete(draft, step, connected);

  const goTo = (next: WizardStep) => {
    setError(null);
    setDraft((d) => ({ ...d, step: next }));
  };

  const onContinue = () => {
    if (!complete || pending) return;
    if (step === 0 && draft.brandId === NEW_BRAND) {
      startTransition(async () => {
        const res = await actions.addBrand(draft.newBrand);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setCreated((c) => [...c, res.value]);
        setDraft((d) => ({ ...d, brandId: res.value.id, newBrand: "", step: 1 }));
      });
      return;
    }
    if (step < LAST_STEP) {
      goTo((step + 1) as WizardStep);
      return;
    }
    const accountId = draft.accountId;
    if (!accountId) return;
    startTransition(async () => {
      const res = await actions.finishAddAccount(accountId, {
        tags: draft.tags,
        description: draft.description,
        slots: draft.slots,
        vaultUrl: draft.vaultUrl,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      clearDraft(workspace.id);
      onAdded(addedMessage(res.value.handle, res.value.slots));
      onClose();
    });
  };

  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? null;

  let body: React.ReactNode;
  switch (step) {
    case 0:
      body = <PlatformStep draft={draft} update={update} brands={brands} brandError={error} />;
      break;
    case 1:
      body = <SignupStep draft={draft} update={update} />;
      break;
    case 2:
      body = <LoginStep draft={draft} update={update} />;
      break;
    case 3:
      body = (
        <ConnectStep
          username={draft.username}
          sandbox={workspace.kind === "sandbox"}
          state={connect}
          connected={connected?.id === draft.accountId ? connected : null}
          brandId={draft.brandId}
          brandName={brandName}
          onConnect={startConnect}
          onCancel={() => {
            popup.current?.close();
            popup.current = null;
            setConnect({ kind: "idle" });
          }}
        />
      );
      break;
    case 4:
      body = <PostingStep draft={draft} update={update} allTags={allTags} />;
      break;
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add an account"
      subtitle={`Step ${step + 1} of ${WIZARD_STEPS.length}`}
      data-testid="add-account-wizard"
      footer={
        <>
          {step > 0 ? (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                goTo((step - 1) as WizardStep);
              }}
            >
              Back
            </Button>
          ) : null}
          <div data-grow />
          {error && step !== 0 ? (
            <span className={styles.footError} role="alert">
              {error}
            </span>
          ) : null}
          <Button variant="primary" disabled={!complete || pending} onClick={onContinue}>
            {step === LAST_STEP ? "Add account" : "Continue"}
          </Button>
        </>
      }
    >
      <div className={styles.wiz}>
        <ol className={styles.stepper} aria-label="Steps">
          {WIZARD_STEPS.map((name, i) => {
            const state = i < step ? "done" : i === step ? "current" : "todo";
            return (
              <li key={name} data-state={state} aria-current={i === step ? "step" : undefined}>
                <span className={styles.n} aria-hidden="true">
                  {i < step ? <Check /> : i + 1}
                </span>
                <span className={styles.stepName}>{name}</span>
              </li>
            );
          })}
        </ol>
        <div className={styles.body} data-step={step}>
          {body}
        </div>
      </div>
    </Modal>
  );
}
