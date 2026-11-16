import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parse } from 'vue/compiler-sfc';
import { tooltipText } from '../src/renderer/src/lib/tooltipText.ts';

const RENDERER = path.join(import.meta.dirname, '../src/renderer/src');
const ELEMENT = 1;
const ATTRIBUTE = 6;
// Components whose `title` is a prop of their own, not a hint.
const OWN_TITLE = new Set(['DetailPanel', 'MapBrowserDialog', 'MapViewButton', 'VaultCard']);

interface TemplateNode {
  type: number;
  tag?: string;
  props?: { type: number; name: string; arg?: { content?: string } }[];
  children?: TemplateNode[];
}

function vueFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? vueFiles(full) : entry.name.endsWith('.vue') ? [full] : [];
  });
}

function nativeHints(node: TemplateNode): string[] {
  const titled =
    node.type === ELEMENT &&
    !OWN_TITLE.has(node.tag ?? '') &&
    node.props?.some((prop) => (prop.type === ATTRIBUTE ? prop.name === 'title' : prop.name === 'bind' && prop.arg?.content === 'title'));
  return [...(titled ? [node.tag ?? ''] : []), ...(node.children ?? []).flatMap(nativeHints)];
}

function element(hint: string | undefined, content: string, cut = false) {
  return { dataset: { tooltip: hint }, textContent: content, scrollWidth: cut ? 200 : 100, clientWidth: 100, scrollHeight: 20, clientHeight: 20 };
}

describe('tooltips', () => {
  it('are the only hints: nothing in the templates uses the browser\'s title', () => {
    const found = vueFiles(RENDERER).flatMap((file) => {
      const template = parse(readFileSync(file, 'utf8')).descriptor.template?.ast as TemplateNode | undefined;
      return template ? nativeHints(template).map((tag) => `${path.relative(RENDERER, file)}: <${tag}>`) : [];
    });
    assert.deepEqual(found, []);
  });

  it('add something: a text shown in full needs none', () => {
    assert.equal(tooltipText(element('Reply', '')), 'Reply');
    assert.equal(tooltipText(element('seton.v0002', "Seton's Clutch")), 'seton.v0002');
    assert.equal(tooltipText(element("Seton's Clutch", "  Seton's Clutch ")), null);
    assert.equal(tooltipText(element("Seton's Clutch", "Seton's Clutch", true)), "Seton's Clutch");
    assert.equal(tooltipText(element(undefined, 'Text')), null);
  });
});
