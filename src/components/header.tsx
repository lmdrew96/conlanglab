import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { ThemeSwitcher } from "@/components/theme-switcher";

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-4">
      <Link href="/" className="text-lg font-semibold text-text">
        CLL <span className="text-text-muted">— ConLangLab</span>
      </Link>
      <div className="flex items-center gap-3">
        <ThemeSwitcher />
        <Show
          when="signed-in"
          fallback={
            <SignInButton mode="modal">
              <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-text hover:bg-accent-hover">
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
