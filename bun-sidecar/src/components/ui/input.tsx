import * as React from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";

function Input({ className, type, autoComplete, autoCorrect, autoCapitalize, spellCheck, style, ...props }: React.ComponentProps<"input">) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <input
      type={type}
      data-slot="input"
      data-form-type="other"
      data-1p-ignore
      data-lpignore="true"
      autoComplete={autoComplete ?? "off"}
      autoCorrect={autoCorrect ?? "off"}
      autoCapitalize={autoCapitalize ?? "off"}
      spellCheck={spellCheck ?? false}
      className={cn(
        "flex h-8 w-full min-w-0 border px-2.5 py-1 text-[11px] transition-all file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-[10px] file:font-medium focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 placeholder:text-[var(--input-placeholder)]",
        className,
      )}
      style={{
        "--input-placeholder": styles.contentTertiary,
        backgroundColor: "transparent",
        color: styles.contentPrimary,
        borderColor: styles.borderDefault,
        borderRadius: styles.borderRadius,
        boxShadow: styles.shadowSm,
        ...style,
      } as React.CSSProperties}
      {...props}
    />
  );
}

export { Input };
