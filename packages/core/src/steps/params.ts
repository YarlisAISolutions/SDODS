import { defineParameterType } from 'playwright-bdd';
import type { HttpMethod } from '../api/client.js';

let defined = false;

/** Cucumber parameter types shared by all step libraries: {method} and {role}. */
export function defineCoreParameterTypes() {
  if (defined) return;
  defined = true;
  defineParameterType({
    name: 'method',
    regexp: /GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS/,
    transformer: (s: string) => s as HttpMethod,
  });
  defineParameterType({
    name: 'role',
    regexp:
      /button|link|textbox|checkbox|radio|combobox|option|menuitem|tab|heading|dialog|listbox|switch|slider|spinbutton|searchbox|cell|row|img|list|listitem|navigation|banner|main|region|alert|status|form|table|grid|gridcell|tooltip|progressbar|menu|menubar|toolbar|tree|treeitem|article|separator|group/,
    transformer: (s: string) => s,
  });
}

defineCoreParameterTypes();
