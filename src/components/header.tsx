import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { RotaryTitle } from "@/components/rotary-title";

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-4 shadow-sm shadow-accent/5">
      <Link href="/" className="text-lg font-semibold text-text">
        <RotaryTitle>ConLangLab</RotaryTitle>
      </Link>
      <div className="flex items-center gap-3">
        <ThemeSwitcher />
        <Show
          when="signed-in"
          fallback={
            <SignInButton mode="modal">
              <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-text shadow-sm shadow-accent/30 hover:bg-accent-hover">
                Sign in
              </button>
            </SignInButton>
          }
        >
          <UserButton />
        </Show>
      </div>
    </header>
  );
}
