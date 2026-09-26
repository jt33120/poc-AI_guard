import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // The Next 16 preset enables React Compiler advisory rules. This codebase
    // still targets React 18 and keeps its existing effect/ref behavior until
    // the dedicated Astra frontend pass can refactor it with visual coverage.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
