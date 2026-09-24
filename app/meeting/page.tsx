import { listMeetings } from "@/lib/meeting/store";
import { listMeetingPrompts } from "@/lib/meeting/prompt-store";
import { MeetingHistory } from "@/components/meeting-history";

export const dynamic = "force-dynamic";

export default function MeetingPage() {
  return <MeetingHistory initialMeetings={listMeetings()} initialPrompts={listMeetingPrompts()} />;
}
