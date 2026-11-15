/** Creates an element with a class name, optionally appended to `parent`. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
}

/** Creates a `div` holding the given SVG markup, optionally appended to `parent`. */
export function svgBox(className: string, markup: string, parent?: HTMLElement): HTMLDivElement {
  const box = el('div', className, parent);
  box.innerHTML = markup;
  return box;
}

/** Restarts a CSS animation class on `node` so it plays again from the start. */
export function replay(node: Element, className: string): void {
  node.classList.remove(className);
  void (node as HTMLElement).offsetWidth;
  node.classList.add(className);
}

/** A mounted screen; `dispose` removes it and its listeners. */
export interface Screen {
  dispose(): void;
}
