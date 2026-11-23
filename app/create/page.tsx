import type { Metadata } from "next";
import { CreateStudioClient } from "./create-client";

export const metadata: Metadata = {
  title: "Create Your TalkCV",
  description:
    "Paste your resume, pick a theme, and generate a bilingual Agent-native portfolio config in seconds.",
};

export default function CreatePage() {
  return <CreateStudioClient />;
}
