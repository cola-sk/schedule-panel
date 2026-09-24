import { MeetingPromptManager } from "@/components/meeting-prompt-manager";
import { listMeetingPrompts } from "@/lib/meeting/prompt-store";

export const dynamic = "force-dynamic";

export default function MeetingPromptsPage() {
  return <MeetingPromptManager initialPrompts={listMeetingPrompts()} />;
}
