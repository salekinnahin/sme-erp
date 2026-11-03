import type { Metadata } from "next";
import { AuthCard } from "../_components/ui";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Sign up · SME ERP" };

export default function SignUpPage() {
  return (
    <AuthCard title="Create your account" subtitle="Get started with SME ERP.">
      <SignUpForm />
    </AuthCard>
  );
}
