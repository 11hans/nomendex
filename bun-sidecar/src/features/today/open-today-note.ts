import { notesAPI } from "@/hooks/useNotesAPI";
import { notesPluginSerial } from "@/features/notes";
import type { useWorkspace } from "@/hooks/useWorkspace";

type OpenTab = ReturnType<typeof useWorkspace>["openTab"];

/** Open today's daily note in an editor tab, creating it from the vault's daily template if missing. */
export async function openTodayNoteTab(openTab: OpenTab): Promise<void> {
    const { fileName } = await notesAPI.openDailyNote();
    openTab({ pluginMeta: notesPluginSerial, view: "editor", props: { noteFileName: fileName } });
}
