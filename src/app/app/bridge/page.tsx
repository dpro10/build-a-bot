import { redirect } from "next/navigation";

/**
 * The Bridge page became the Desktop app page (the Bridge is gone since 2026-10-20). Older
 * desktop apps still open /app/bridge#desktop to pair; the browser keeps the #desktop.
 */
export default function BridgePage() {
  redirect("/app/desktop");
}
