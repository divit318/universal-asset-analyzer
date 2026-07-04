import type { Metadata } from "next";
import { UploadForm } from "./_components/upload-form";

export const metadata: Metadata = {
  title: "Analyze",
};

export default function AnalyzePage() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Analyze</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Upload an asset to get a structured breakdown of its type and size.
        </p>
      </div>

      <UploadForm />
    </div>
  );
}
