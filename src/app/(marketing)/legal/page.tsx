import { permanentRedirect } from "next/navigation";

/** /legal on its own: the terms, which link to the privacy policy. */
export default function LegalPage() {
  permanentRedirect("/legal/terms");
}
