// Button class recipe, shared by server markup and the client Button.
const BTN = {
  primary: "bg-brand text-on-dark hover:bg-brand-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(6_26_54/0.25)]",
  secondary: "bg-card text-ink shadow-[0_0_0_1px_var(--color-field),0_1px_2px_rgb(10_22_40/0.05)] hover:bg-muted",
  danger: "bg-tint-red text-danger ring-1 ring-inset ring-danger/20 hover:bg-danger hover:text-on-dark",
  ghost: "text-brand hover:bg-brand-soft",
};
const SIZE = { md: "h-10 px-4 text-[0.875rem]", sm: "h-8 px-3 text-[0.8125rem]" };
export const btn = (v: keyof typeof BTN = "primary", s: keyof typeof SIZE = "md") =>
  `inline-flex items-center justify-center gap-1.5 rounded-xl font-medium whitespace-nowrap transition-[background-color,color,transform,box-shadow] duration-200 ease-(--ease-out-expo) active:translate-y-px active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none ${BTN[v]} ${SIZE[s]}`;

export type BtnVariant = keyof typeof BTN;
export type BtnSize = keyof typeof SIZE;
