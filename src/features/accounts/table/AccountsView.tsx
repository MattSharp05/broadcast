"use client";

import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { Select } from "@/components/Select";
import { TagFilter } from "@/components/TagFilter";
import {
  DEFAULT_SORT,
  NO_FILTERS,
  STATUS_LABELS,
  accountStats,
  filterAccounts,
  groupByBrand,
  hasFilters,
  nextSort,
  sortAccounts,
  type AccountFilters,
  type AccountRow,
  type AccountSort,
  type BrandRef,
  type SortKey,
  type StatusFilter,
} from "@/lib/domain/accounts";
import { ALL_TAGS, tagCounts, tagsOf } from "@/lib/domain/tags";
import { AddAccountWizard } from "../wizard/AddAccountWizard";
import { hasConnectResult } from "../wizard/draft-storage";
import { DetailDrawer } from "@/features/drawers/DetailDrawer";
import type { AccountDetail } from "@/lib/domain/details";
import { AccountRowView } from "./AccountRowView";
import styles from "./accounts.module.css";
import type { AccountsActions } from "./actions";
import { BrandGroupRow } from "./BrandGroupRow";
import { NewBrand } from "./NewBrand";
import { accountsStats } from "./stats";

export interface AccountsViewProps {
  accounts: AccountRow[];
  brands: BrandRef[];
  /** The workspace shown (the wizard keeps one draft per workspace). */
  workspace: { id: string; kind: "live" | "sandbox" };
  actions: AccountsActions;
  /** The account drawer's data (BC-15). Without it, Details is disabled. */
  details?: AccountsDetails;
  /** The Status filter to start with (`/accounts?status=…`, the rail's attention link). */
  initialStatus?: StatusFilter;
}

export interface AccountsDetails {
  accounts: AccountDetail[];
  /** The workspace clock (ISO). */
  now: string;
  timezone: string;
}

const COLUMNS = 8;
const STATUS_OPTIONS: StatusFilter[] = ["all", "ready", "needs_attention", "not_connected"];
const NOTICE_MS = 5000;

function AddAccountButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" onClick={onClick}>
      <Plus aria-hidden="true" />
      Add account
    </Button>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  numeric,
}: {
  label: string;
  sortKey: SortKey;
  sort: AccountSort;
  onSort: (key: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey ? sort.dir : 0;
  const Icon = active === 1 ? ArrowUp : active === -1 ? ArrowDown : ChevronsUpDown;
  return (
    <th
      className={numeric ? styles.num : undefined}
      aria-sort={active === 1 ? "ascending" : active === -1 ? "descending" : "none"}
    >
      <button
        type="button"
        className={styles.sort}
        data-active={active ? "" : undefined}
        onClick={() => {
          onSort(sortKey);
        }}
      >
        {label}
        <Icon aria-hidden="true" />
      </button>
    </th>
  );
}

interface TagEdit {
  accountId: string;
  tags: string[];
}

/** The Accounts tab: top bar, toolbar (search, Tag, Status, New brand) and the grouped table. */
export function AccountsView({
  accounts,
  brands,
  workspace,
  actions,
  details,
  initialStatus = "all",
}: AccountsViewProps) {
  const [opened, setOpened] = useState<{ id: string; opener: HTMLElement } | null>(null);
  const openedAccount = opened ? details?.accounts.find((a) => a.id === opened.id) : undefined;
  const detailClock = useMemo(
    () => ({ now: new Date(details?.now ?? 0), timezone: details?.timezone ?? "UTC" }),
    [details?.now, details?.timezone],
  );
  const onDetails = useCallback((id: string, opener: HTMLElement) => {
    setOpened({ id, opener });
  }, []);
  const [optimistic, setOptimisticTags] = useOptimistic(accounts, (rows, edit: TagEdit) =>
    rows.map((a) => (a.id === edit.accountId ? { ...a, tags: edit.tags } : a)),
  );
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState<AccountFilters>({
    ...NO_FILTERS,
    status: initialStatus,
  });
  const [sort, setSort] = useState<AccountSort>(DEFAULT_SORT);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const tags = useMemo(() => tagsOf(optimistic), [optimistic]);
  const counts = useMemo(() => tagCounts(optimistic), [optimistic]);
  // A filtered tag that no account carries any more falls back to All tags (for good: it doesn't
  // switch itself back on if the tag returns).
  if (filters.tag !== ALL_TAGS && !tags.includes(filters.tag)) {
    setFilters((f) => ({ ...f, tag: ALL_TAGS }));
  }
  const activeTag = tags.includes(filters.tag) ? filters.tag : ALL_TAGS;
  const active = useMemo(() => ({ ...filters, tag: activeTag }), [filters, activeTag]);
  const shown = useMemo(() => filterAccounts(optimistic, active), [optimistic, active]);
  const filtered = hasFilters(active);

  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showError = useCallback((message: string) => {
    setError(message);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => {
      setError(null);
    }, 5000);
  }, []);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(errorTimer.current);
      clearTimeout(noticeTimer.current);
    },
    [],
  );

  // Back from connecting in this tab (the wizard's pop-up was blocked): reopen the wizard.
  useEffect(() => {
    if (hasConnectResult()) setWizardOpen(true);
  }, []);
  const openWizard = useCallback(() => {
    setWizardOpen(true);
  }, []);

  const saveTags = useCallback(
    (accountId: string, next: string[]) => {
      startTransition(async () => {
        setOptimisticTags({ accountId, tags: next });
        const res = await actions.updateAccountTags(accountId, next);
        if (!res.ok) showError(res.error);
      });
    },
    [actions, setOptimisticTags, showError],
  );

  const onSort = (key: SortKey) => {
    setSort((s) => nextSort(s, key));
  };
  const clearFilters = () => {
    setFilters(NO_FILTERS);
  };

  let body: React.ReactNode;
  if (shown.length === 0 && filtered) {
    body = (
      <tr>
        <td colSpan={COLUMNS} className={styles.none}>
          No accounts match these filters.{" "}
          <button type="button" className={styles.link} onClick={clearFilters}>
            Clear filters
          </button>
        </td>
      </tr>
    );
  } else if (sort.key === "brand") {
    // Without filters, brands with no accounts yet still get their group row.
    body = groupByBrand(shown, filtered ? [] : brands).map((g) => (
      <BrandGroupRow
        key={g.brand.id}
        brand={g.brand}
        count={g.accounts.length}
        columns={COLUMNS}
        onRename={actions.updateBrandName}
        onError={showError}
      >
        {g.accounts.map((a) => (
          <AccountRowView
            key={a.id}
            account={a}
            allTags={tags}
            onTags={saveTags}
            onDescription={actions.updateAccountDescription}
            onError={showError}
            onDetails={details ? onDetails : undefined}
          />
        ))}
      </BrandGroupRow>
    ));
  } else {
    body = sortAccounts(shown, sort).map((a) => (
      <AccountRowView
        key={a.id}
        account={a}
        allTags={tags}
        onTags={saveTags}
        onDescription={actions.updateAccountDescription}
        onError={showError}
        onDetails={details ? onDetails : undefined}
      />
    ));
  }

  const noAccounts = accounts.length === 0;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Accounts"
        stats={accountsStats(accountStats(optimistic))}
        actions={<AddAccountButton onClick={openWizard} />}
      />
      <div className={styles.toolbar} role="search" aria-label="Filter accounts">
        <label className={styles.search}>
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Search accounts"
            aria-label="Search accounts"
            value={filters.query}
            onChange={(e) => {
              setFilters((f) => ({ ...f, query: e.target.value }));
            }}
          />
        </label>
        <TagFilter
          tags={tags}
          counts={counts}
          allLabel="All tags"
          value={activeTag}
          onChange={(tag) => {
            setFilters((f) => ({ ...f, tag }));
          }}
        />
        <Select
          label="Status"
          value={filters.status}
          onChange={(e) => {
            setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }));
          }}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All" : STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <div className={styles.grow} />
        <NewBrand
          onCreate={actions.addBrand}
          onCreated={() => {
            // Show the new (empty) group: it only appears grouped and unfiltered.
            setSort(DEFAULT_SORT);
            setFilters(NO_FILTERS);
          }}
          onError={showError}
        />
      </div>
      <div className={styles.scroll}>
        {noAccounts && brands.length === 0 ? (
          <div className={styles.empty}>
            <p>No accounts yet. Add your first account to start posting.</p>
            <AddAccountButton onClick={openWizard} />
          </div>
        ) : (
          <div className={styles.tablewrap}>
            <table className={styles.table} aria-label="Accounts">
              <thead>
                <tr>
                  <SortHeader label="Account" sortKey="handle" sort={sort} onSort={onSort} />
                  <th>Status</th>
                  <th>Tags</th>
                  <th className={styles.descCol}>Description</th>
                  <SortHeader
                    label="Followers"
                    sortKey="followers"
                    sort={sort}
                    onSort={onSort}
                    numeric
                  />
                  <th className={styles.num}>Slots a day</th>
                  <th className={styles.num}>Backlog</th>
                  <th>
                    <span className={styles.srOnly}>Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>{body}</tbody>
            </table>
          </div>
        )}
        {noAccounts && brands.length > 0 ? (
          <p className={styles.hint}>No accounts yet. Add your first account to start posting.</p>
        ) : null}
      </div>
      <DetailDrawer
        target={openedAccount ? { kind: "account", account: openedAccount } : null}
        clock={detailClock}
        onClose={() => {
          setOpened(null);
        }}
        returnFocus={opened?.opener}
      />
      {error ? (
        <div className={styles.toast} role="alert">
          {error}
        </div>
      ) : notice ? (
        <div className={styles.toast} role="status">
          <Check aria-hidden="true" className={styles.toastIcon} />
          {notice}
        </div>
      ) : null}
      {wizardOpen ? (
        <AddAccountWizard
          workspace={workspace}
          brands={brands}
          allTags={tags}
          actions={actions}
          onClose={() => {
            setWizardOpen(false);
          }}
          onAdded={(message) => {
            setSort(DEFAULT_SORT);
            setFilters(NO_FILTERS);
            showNotice(message);
          }}
        />
      ) : null}
    </div>
  );
}
