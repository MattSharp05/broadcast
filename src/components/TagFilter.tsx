"use client";

import { ALL_TAGS } from "@/lib/domain/tags";
import { Select } from "./Select";

interface TagFilterProps {
  /** The tags to offer (see tagsOf). */
  tags: readonly string[];
  /** The selected tag, or ALL_TAGS. */
  value: string;
  onChange: (tag: string) => void;
  /** The first option's words (Workflow: "All accounts", Accounts: "All tags"). */
  allLabel?: string;
  /** Accounts per tag, shown as "Tech (2)" (see tagCounts). */
  counts?: ReadonlyMap<string, number>;
}

/** The top bar's "Tag" select: "All accounts" plus every tag in use (Workflow and Accounts). */
export function TagFilter({
  tags,
  value,
  onChange,
  allLabel = "All accounts",
  counts,
}: TagFilterProps) {
  return (
    <Select
      label="Tag"
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    >
      <option value={ALL_TAGS}>{allLabel}</option>
      {tags.map((t) => (
        <option key={t} value={t}>
          {counts ? `${t} (${counts.get(t) ?? 0})` : t}
        </option>
      ))}
    </Select>
  );
}
