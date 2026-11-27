import * as React from "react";

import { cn } from "@/lib/utils";

/*
 * Controlled tab strip in the style of shadcn/ui Tabs (variants "default" and "line").
 * Only the list and triggers: the caller decides what to render for the selected value,
 * which lets the selection live in the URL. Arrow keys, Home and End move between triggers.
 */

const TabsContext = React.createContext({ value: undefined, onValueChange: () => {}, variant: "default" });

function TabsList({ value, onValueChange, variant = "default", className, children, ...props }) {
  const onKeyDown = (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const triggers = Array.from(event.currentTarget.querySelectorAll('[role="tab"]:not([disabled])'));
    const index = triggers.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? triggers.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + triggers.length) % triggers.length;
    triggers[next].focus();
    triggers[next].click();
  };

  return (
    <TabsContext.Provider value={{ value, onValueChange, variant }}>
      <div
        role="tablist"
        data-variant={variant}
        onKeyDown={onKeyDown}
        className={cn(
          "inline-flex items-center text-muted-foreground",
          variant === "line"
            ? "w-full gap-1 border-b"
            : "h-auto flex-wrap gap-1 rounded-lg bg-muted p-1",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function TabsTrigger({ value, className, tone, children, ...props }) {
  const context = React.useContext(TabsContext);
  const active = context.value === value;
  const danger = tone === "danger";

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-state={active ? "active" : "inactive"}
      onClick={() => context.onValueChange?.(value)}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        context.variant === "line"
          ? cn(
              "relative -mb-px border-b-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.08em]",
              active
                ? "border-primary text-foreground"
                : "border-transparent hover:text-foreground",
            )
          : cn(
              "rounded-md px-3 py-1.5",
              active
                ? danger
                  ? "bg-background text-destructive shadow-sm"
                  : "bg-background text-foreground shadow-sm"
                : danger
                  ? "text-destructive/80 hover:text-destructive"
                  : "hover:text-foreground",
            ),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export { TabsList, TabsTrigger };
