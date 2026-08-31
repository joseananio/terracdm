"use client";

import { CaretDown } from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type WorkspaceControlOption<T extends string> = { value: T; label: string };

export function WorkspaceMenu<T extends string>({ ariaLabel, className, onChange, options, presentation = "menu", value }: { ariaLabel: string; className: string; onChange: (value: T) => void; options: WorkspaceControlOption<T>[]; presentation?: "menu" | "drawer"; value: T }) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  return <div className={className}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="workspace-compact-menu-trigger" aria-label={ariaLabel}>
          <span>{selected.label}</span><CaretDown aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-workspace-menu={presentation}>
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
            {options.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

export function WorkspaceMultiMenu<T extends string>({ ariaLabel, className, emptyLabel, onChange, options, value }: { ariaLabel: string; className?: string; emptyLabel: string; onChange: (value: T[]) => void; options: WorkspaceControlOption<T>[]; value: T[] }) {
  return <div className={className}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="workspace-compact-menu-trigger" aria-label={ariaLabel}>
          <span>{value.length ? `${value.length} selected` : emptyLabel}</span><CaretDown aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-workspace-menu="menu">
        <DropdownMenuGroup>
          {options.map((option) => <DropdownMenuCheckboxItem key={option.value} checked={value.includes(option.value)} onCheckedChange={() => onChange(value.includes(option.value) ? value.filter((item) => item !== option.value) : [...value, option.value])}>{option.label}</DropdownMenuCheckboxItem>)}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

export function WorkspaceSelect<T extends string>({ ariaLabel, disabled, onChange, options, value }: { ariaLabel: string; disabled?: boolean; onChange: (value: T) => void; options: WorkspaceControlOption<T>[]; value: T }) {
  return <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as T)}>
    <SelectTrigger aria-label={ariaLabel} data-workspace-select>
      <SelectValue />
    </SelectTrigger>
    <SelectContent position="popper" align="end" data-workspace-menu="menu">
      <SelectGroup>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectGroup>
    </SelectContent>
  </Select>;
}

export function WorkspaceSegmentedTabs<T extends string>({ ariaLabel, onChange, options, value }: { ariaLabel: string; onChange: (value: T) => void; options: WorkspaceControlOption<T>[]; value: T }) {
  return <div className="workspace-segmented-tabs" role="tablist" aria-label={ariaLabel}>
    {options.map((option, index) => <button key={option.value} type="button" role="tab" aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1} data-segment-value={option.value} onClick={() => onChange(option.value)} onKeyDown={(event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = options[(index + offset + options.length) % options.length];
      onChange(next.value);
      requestAnimationFrame(() => (event.currentTarget.parentElement?.querySelector(`[data-segment-value="${next.value}"]`) as HTMLButtonElement | null)?.focus());
    }}>{option.label}</button>)}
  </div>;
}
