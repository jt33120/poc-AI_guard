import { runHookCheck } from "./hook-check.js";
import { hookTeam } from "./team/hook.js";

// The official hook: the Local check with the Équipe edition plugged in. The
// open source build starts from local-hook.ts instead.
void runHookCheck(hookTeam);
