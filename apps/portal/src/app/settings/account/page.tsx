import { redirect } from "next/navigation";

/** Settings is a popup over the chat; this link opens it on Account. */
export default function AccountSettingsRedirect() {
  redirect("/?settings=account");
}
