/**
 * Job status for async AI analyses (ai-migration/03-architecture.md §4).
 * Pending→ready UIs poll this; when the job has succeeded the caller re-hits
 * its feature route, which now serves from the ai_result cache.
 */
import { NextResponse } from "next/server";
import { getAiJob } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB_ID_RE = /^[a-z0-9:_.-]{1,128}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || !JOB_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }
  const job = getAiJob(id);
  if (!job) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    taskType: job.taskType,
    subjectKey: job.subjectKey,
    provider: job.provider,
    error: job.error,
    sessionUrl: job.sessionUrl,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  });
}
