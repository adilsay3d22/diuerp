"use client";
import { Printer } from "lucide-react";
import { btn } from "@/components/ui";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={btn("secondary", "sm")}><Printer aria-hidden size={15} />Print or save as PDF</button>;
}
