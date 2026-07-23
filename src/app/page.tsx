import { Show, SignInButton } from "@clerk/nextjs";
import { Header } from "@/components/header";
import { LanguageLibrary } from "@/components/language-library";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <Header />
      <Show
        when="signed-in"
        fallback={
          <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <h1 className="text-2xl font-semibold text-text">
              Generate a language from real linguistic typology.
            </h1>
            <p className="max-w-md text-text-muted">
              Phonology, morphology, lexicon, syntax, and orthography — every
              choice traceable to a rule, never a black box.
            </p>
            <SignInButton mode="modal">
              <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text hover:bg-accent-hover">
                Sign in to start
              </button>
            </SignInButton>
          </main>
        }
      >
        <LanguageLibrary />
      </Show>
    </div>
  );
}
