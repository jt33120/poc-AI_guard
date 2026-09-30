declare const __XSOM_RUNNER_VERSION__: string | undefined;

/**
 * This extension's version, compiled into the extension and the hook by
 * build.mjs: what a managed policy's minRunnerVersion is compared with. The
 * installed hook runs outside VS Code and cannot read the manifest. Unbuilt,
 * no policy with a version floor is accepted (fail closed).
 */
export const RUNNER_VERSION: string =
  typeof __XSOM_RUNNER_VERSION__ === "string"
    ? __XSOM_RUNNER_VERSION__
    : "0.0.0";
