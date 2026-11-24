import { useEffect, useState } from "react";
import { useAomiRuntime } from "@aomi-labs/react";
import { useApprovalAuthority } from "./approval-authority";

/** The commit's sign page URL, fetched while `ref` is set. */
export function useSignUrl(ref: string | undefined) {
  const { commitController } = useAomiRuntime();
  const [signUrl, setSignUrl] = useState<{ ref: string; url: string }>();
  useEffect(() => {
    if (!ref || !commitController) return;
    let live = true;
    commitController
      .refView(ref)
      .then((view) => live && setSignUrl({ ref, url: view.sign_url }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [commitController, ref]);
  return signUrl && signUrl.ref === ref ? signUrl.url : undefined;
}

/** The commit's sign page from here: in place on Aomi, its URL in an embed. */
export function useSignHref(ref: string | undefined) {
  const authority = useApprovalAuthority();
  const url = useSignUrl(authority ? undefined : ref);
  return authority && ref ? `/sign/${encodeURIComponent(ref)}` : url;
}
