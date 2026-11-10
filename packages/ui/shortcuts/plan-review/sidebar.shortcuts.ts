import { defineShortcutScope } from "../core";
import { createShortcutScopeHook } from "../runtime";

export const sidebarShortcuts = defineShortcutScope({
  id: "sidebar",
  title: "Sidebar",
  shortcuts: {
    toggleContents: {
      description: "Toggle Contents sidebar",
      bindings: ["Mod+B"],
      section: "Sidebar",
      displayOrder: 10,
      preventDefault: true,
    },
  },
});

export const useSidebarShortcuts = createShortcutScopeHook(sidebarShortcuts);
