import { redirect } from "next/navigation";

// The real marketing page now lives at /welcome (see app/welcome/page.tsx) —
// this repo's exported output only ships out/welcome + out/_next into
// legacy-app's own site (legacy-app/index.html stays the real app's root).
// This root route only exists so `npm run dev` at localhost:3100/ doesn't
// 404 while developing; it's never part of what gets copied/deployed.
export default function RootDevRedirect() {
  redirect("/welcome");
}
