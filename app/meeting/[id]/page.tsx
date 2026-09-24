import { notFound } from "next/navigation";
import { MeetingDetail } from "@/components/meeting-detail";
import { getMeeting } from "@/lib/meeting/store";

export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) notFound();
  const previous = meeting.previousMeetingId ? getMeeting(meeting.previousMeetingId) : undefined;
  return <MeetingDetail initialMeeting={meeting} previousMeeting={previous} />;
}

