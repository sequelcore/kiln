import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.strict,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@kilnai/core", "@kilnai/core/*"],
              importNamePattern: "^(?!type ).*",
              message:
                "Value imports from @kilnai/core are forbidden in packages/gui. Use `import type` only.",
            },
            {
              group: ["@kilnai/runtime", "@kilnai/runtime/*"],
              importNamePattern: "^(?!type ).*",
              message:
                "Value imports from @kilnai/runtime are forbidden in packages/gui. Use `import type` only.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".tanstack/**",
      "src/routeTree.gen.ts",
      ".reference/**",
    ],
  },
);
