import { removeManagedHooks } from "./uninstall.js";

// Run by VS Code (`vscode:uninstall`) after the extension is removed, on the
// next restart. It catches the hooks no assistant triggered since: VS Code has
// by then deleted the hook file they point to.
void removeManagedHooks();
