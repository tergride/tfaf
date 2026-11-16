// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import regexp from 'eslint-plugin-regexp';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

const regexpErrors = Object.fromEntries(
  Object.entries(regexp.rules)
    .filter(([, rule]) => rule.meta.docs?.category === 'Possible Errors' && !rule.meta.deprecated)
    .map(([name]) => [`regexp/${name}`, 'error']),
);

const bareBuiltins = builtinModules.filter((name) => !name.startsWith('node:')).join('|');
const NO_NODE_IMPORTS = {
  regex: `^(electron(/.*)?|node:.+|(${bareBuiltins})(/.*)?)$`,
  message: 'Renderer and shared code reach Electron and Node only through main over IPC.',
};
const NO_MAIN_IMPORTS = { regex: '/main/', message: 'Renderer and shared code do not import main; share types through src/shared.' };
const NO_RENDERER_IMPORTS = { regex: '/renderer/', message: 'Only the renderer imports renderer code; share it through src/shared.' };
const NETWORK_APIS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
const NO_NETWORK = 'The renderer does not go to the network: main does it and answers over IPC.';

export default defineConfig([
  globalIgnores(['out/', 'dist/', 'resources/', 'build/']),

  {
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' },
  },

  js.configs.recommended,
  {
    plugins: { regexp },
    rules: {
      ...regexpErrors,
      // The code strips control characters from chat, names and files on purpose.
      'regexp/no-control-character': 'off',
      'no-control-regex': 'off',
      // Quadratic only on long inputs without a match; the patterns run on short lines and names.
      'regexp/no-super-linear-move': 'off',
      'array-callback-return': 'error',
      'default-case-last': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-alert': 'error',
      'no-caller': 'error',
      'no-constructor-return': 'error',
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-iterator': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-object-constructor': 'error',
      'no-octal-escape': 'error',
      'no-proto': 'error',
      'no-return-assign': 'error',
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-unsafe-optional-chaining': ['error', { disallowArithmeticOperators: true }],
      'no-useless-call': 'error',
    },
  },

  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['**/*.{ts,vue}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        // vue-eslint-parser hands the <script> blocks of .vue files to this parser.
        parser: tseslint.parser,
        projectService: true,
        extraFileExtensions: ['.vue'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The preset turns off the core rules TypeScript checks itself (no-undef and others) only for .ts files.
      ...tseslint.configs.eslintRecommended.rules,
      // describe/it/test return promises that node:test awaits itself.
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['describe', 'it', 'suite', 'test'] }] },
      ],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true, ignoreVoidOperator: true }],
      // Options replace the preset's, and the rule's own defaults allow nullish and `any`: every one is spelled out.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowAny: false, allowBoolean: true, allowNever: false, allowNullish: false, allowNumber: true, allowRegExp: false },
      ],
      '@typescript-eslint/no-misused-spread': ['error', { allow: ['string'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: true }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unnecessary-parameter-property-assignment': 'error',
      // TypeScript keeps a narrowing across `await` and callbacks, so a check of state that changed meanwhile
      // (`signal.aborted`, `this.shuttingDown`) looks always false here. Removing such a check is a bug.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Style rules of the strict set that find no mistakes; noUncheckedIndexedAccess makes `!` routine.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      // `async` methods without `await` keep interfaces uniform; forgotten awaits are no-floating-promises.
      '@typescript-eslint/require-await': 'off',
    },
  },

  {
    files: ['**/*.vue'],
    extends: [vue.configs['flat/essential']],
    rules: {
      'vue/multi-word-component-names': 'off',
      // LobbySlotRow takes a lobby slot as its `slot` prop, not the Vue 2 slot attribute.
      'vue/no-deprecated-slot-attribute': ['error', { ignore: ['LobbySlotRow'] }],
      'vue/no-template-shadow': 'error',
      'vue/require-explicit-emits': 'error',
      'vue/no-required-prop-with-default': 'error',
      'vue/no-multiple-slot-args': 'error',
      'vue/no-v-html': 'error',
      'vue/no-duplicate-attr-inheritance': 'error',
      'vue/no-undef-components': 'error',
      'vue/no-unused-properties': 'error',
      'vue/no-unused-refs': 'error',
      'vue/no-unused-emit-declarations': 'error',
      'vue/no-use-v-else-with-v-for': 'error',
      'vue/no-template-target-blank': 'error',
      'vue/require-typed-ref': 'error',
      'vue/no-import-compiler-macros': 'error',
      'vue/no-props-shadow': 'error',
      'vue/no-duplicate-class-names': 'error',
      'vue/html-button-has-type': 'error',
      'vue/eqeqeq': ['error', 'always', { null: 'ignore' }],
      'vue/no-constant-condition': 'error',
      'vue/no-empty-pattern': 'error',
      'vue/no-irregular-whitespace': 'error',
      'vue/no-loss-of-precision': 'error',
      'vue/no-sparse-arrays': 'error',
    },
  },

  // typescript-eslint cannot read .vue modules, so imported components and their instance types are unresolved.
  {
    files: ['**/*.vue'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },

  // The renderer reaches Electron, Node and the network only through main over IPC; shared code runs on both sides.
  // A later block replaces a rule's options instead of adding to them, so each part lists all of its patterns.
  {
    files: ['src/main/**', 'src/preload/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_RENDERER_IMPORTS] }] },
  },
  {
    files: ['src/renderer/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_NODE_IMPORTS, NO_MAIN_IMPORTS] }] },
  },
  {
    files: ['src/shared/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_NODE_IMPORTS, NO_MAIN_IMPORTS, NO_RENDERER_IMPORTS] }] },
  },
  {
    files: ['src/renderer/**'],
    rules: {
      'no-restricted-globals': ['error', ...NETWORK_APIS.map((name) => ({ name, message: NO_NETWORK }))],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) => NETWORK_APIS.map((property) => ({ object, property, message: NO_NETWORK }))),
        { object: 'navigator', property: 'sendBeacon', message: NO_NETWORK },
      ],
      // Composables return plain objects whose functions never use `this`, and views destructure them.
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  {
    files: ['test/**'],
    rules: {
      // Tests feed `javascript:` links to the code that must refuse them.
      'no-script-url': 'off',
    },
  },
]);
