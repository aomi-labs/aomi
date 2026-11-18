import { SettingsNav } from "./settings-nav";

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-4 pb-16 pt-8 sm:px-8 lg:flex-row lg:items-start lg:gap-10">
      <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-56">
        <SettingsNav />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
