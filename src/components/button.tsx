"use client";
import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { btn, type BtnVariant, type BtnSize } from "./btn";

// Form button: while its form's server action runs, every button in the form is disabled (no double payments)
// and the one that was pressed shows a spinner. `confirm` asks first, for destructive actions.
export function Button({ variant = "primary", size = "md", className = "", confirm: ask, children, onClick, ...p }: ComponentProps<"button"> & { variant?: BtnVariant; size?: BtnSize; confirm?: string }) {
  const { pending, data } = useFormStatus();
  const mine = pending && (!p.name || data?.get(String(p.name)) === String(p.value ?? ""));
  return (
    <button {...p} disabled={p.disabled || pending} aria-busy={mine || undefined} className={`${btn(variant, size)} ${className}`}
      onClick={(e) => { if (ask && !window.confirm(ask)) e.preventDefault(); onClick?.(e); }}>
      {mine && <LoaderCircle aria-hidden size={15} className="animate-spin" />}
      {children}
    </button>
  );
}
