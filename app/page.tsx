import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import GeneratorApp from "@/components/GeneratorApp";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token)) redirect("/login");
  return <GeneratorApp />;
}
