"use client"

import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { useTheme } from "@/hooks/useTheme"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50",
        className
      )}
      style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 border p-6 duration-200 sm:max-w-lg",
          className
        )}
        style={{
          backgroundColor: styles.surfaceSecondary,
          color: styles.contentPrimary,
          borderColor: styles.borderDefault,
          borderRadius: styles.borderRadius,
          boxShadow: styles.shadowLg,
          ...style,
        }}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      style={{
        color: styles.contentPrimary,
        ...style,
      }}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm", className)}
      style={{
        color: styles.contentSecondary,
        ...style,
      }}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants(), className)}
      style={{
        backgroundColor: styles.semanticPrimary,
        color: styles.semanticPrimaryForeground,
        boxShadow: styles.shadowSm,
        borderRadius: styles.borderRadius,
        ...style,
      }}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  const { currentTheme } = useTheme();
  const { styles } = currentTheme;

  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: "outline" }), className)}
      style={{
        backgroundColor: "transparent",
        color: styles.contentPrimary,
        borderColor: styles.borderDefault,
        borderWidth: "1px",
        borderStyle: "solid",
        borderRadius: styles.borderRadius,
        ...style,
      }}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
